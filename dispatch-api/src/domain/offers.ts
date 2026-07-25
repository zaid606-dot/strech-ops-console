import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import { assertContractorFit, scoreCandidates } from './scoring.js';
import { transitionStatus } from '../status/transitions.js';

function replyToken(): string {
  return randomBytes(3).toString('hex').toUpperCase();
}

/** Insert appointment; maps exclusion/unique violations to SLOT_CONFLICT. */
async function insertExclusiveAppointment(
  client: pg.PoolClient,
  opts: { contractorId: string; slotStart: string | Date; slotEnd: string | Date },
): Promise<string> {
  await client.query('SAVEPOINT book_appt');
  try {
    const appt = await client.query(
      `INSERT INTO appointments (contractor_id, slot_start, slot_end)
       VALUES ($1, $2, $3) RETURNING id`,
      [opts.contractorId, opts.slotStart, opts.slotEnd],
    );
    await client.query('RELEASE SAVEPOINT book_appt');
    return appt.rows[0].id as string;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT book_appt');
    const err = e as { code?: string };
    if (err.code === '23P01' || err.code === '23505') {
      throw Object.assign(new Error('slot_conflict'), {
        code: 'SLOT_CONFLICT',
        status: 409,
      });
    }
    throw e;
  }
}

export async function expirePendingOffers(client: pg.Pool | pg.PoolClient) {
  await client.query(
    `UPDATE dispatch_offers
     SET status = 'expired', resolved_at = now()
     WHERE status = 'pending' AND expires_at <= now()`,
  );
}

export async function startOfferWave(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    strategy: 'sequential' | 'parallel_batch';
    batchSize?: number;
    ttlSeconds?: number;
    maxWaves?: number;
    actorRole: 'ops' | 'agent' | 'system';
    actorId: string;
  },
) {
  await expirePendingOffers(client);

  const locked = await client.query(
    `SELECT sr.*, p.zip
     FROM service_requests sr
     JOIN properties p ON p.id = sr.property_id
     WHERE sr.id = $1
     FOR UPDATE OF sr`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  const sr = locked.rows[0];
  if (sr.status !== 'dispatching') {
    throw Object.assign(new Error('not_dispatching'), { code: 'INVALID_STATUS' });
  }
  if (sr.dispatch_owner === 'ops' && opts.actorRole === 'agent') {
    throw Object.assign(new Error('owned_by_ops'), { code: 'OWNED_BY_OPS', status: 403 });
  }

  const pending = await client.query(
    `SELECT 1 FROM dispatch_offers
     WHERE service_request_id = $1 AND status = 'pending' LIMIT 1`,
    [opts.serviceRequestId],
  );
  if (pending.rowCount) {
    throw Object.assign(new Error('offers_pending'), { code: 'OFFERS_PENDING' });
  }

  const windowStart = sr.preferred_window_start
    ? new Date(sr.preferred_window_start)
    : new Date();
  const windowEnd = sr.preferred_window_end
    ? new Date(sr.preferred_window_end)
    : new Date(windowStart.getTime() + 4 * 60 * 60 * 1000);

  const prior = await client.query(
    `SELECT contractor_id FROM dispatch_offers
     WHERE service_request_id = $1 AND status IN ('declined','expired','withdrawn')`,
    [opts.serviceRequestId],
  );
  const exclude = prior.rows.map((r) => r.contractor_id as string);

  const candidates = await scoreCandidates(client, {
    categoryId: sr.category_id,
    zip: sr.zip,
    windowStart,
    windowEnd,
    excludeContractorIds: exclude,
  });

  const waveCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM dispatch_waves WHERE service_request_id = $1`,
    [opts.serviceRequestId],
  );
  const waveNumber = (waveCount.rows[0].n as number) + 1;
  const maxWaves = opts.maxWaves ?? 3;

  if (waveNumber > maxWaves) {
    await client.query(
      `INSERT INTO cases (service_request_id, type, reason_code, owner_role, meta)
       VALUES ($1, 'escalation', $2, 'ops', $3::jsonb)`,
      [
        opts.serviceRequestId,
        'pool_exhaust',
        JSON.stringify({ wave_number: waveNumber }),
      ],
    );
    await client.query(
      `UPDATE service_requests SET dispatch_owner = 'ops', updated_at = now() WHERE id = $1`,
      [opts.serviceRequestId],
    );
    await client.query(
      `INSERT INTO job_events
         (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
       VALUES ($1, $2, $2, $3, $4, $5, clock_timestamp())`,
      [
        opts.serviceRequestId,
        sr.status,
        opts.actorRole,
        opts.actorId,
        'max waves — escalated to ops',
      ],
    );
    return { wave: null, offers: [], escalated: true as const };
  }

  if (candidates.length === 0) {
    await client.query(
      `INSERT INTO cases (service_request_id, type, reason_code, owner_role, meta)
       VALUES ($1, 'escalation', $2, 'ops', $3::jsonb)`,
      [
        opts.serviceRequestId,
        waveNumber >= maxWaves ? 'pool_exhaust' : 'no_candidates',
        JSON.stringify({ wave_number: waveNumber }),
      ],
    );
    await client.query(
      `UPDATE service_requests SET dispatch_owner = 'ops', updated_at = now() WHERE id = $1`,
      [opts.serviceRequestId],
    );
    await client.query(
      `INSERT INTO job_events
         (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
       VALUES ($1, $2, $2, $3, $4, $5, clock_timestamp())`,
      [
        opts.serviceRequestId,
        sr.status,
        opts.actorRole,
        opts.actorId,
        waveNumber >= maxWaves
          ? 'pool exhaust — escalated to ops'
          : 'no candidates for wave — escalated to ops',
      ],
    );
    return { wave: null, offers: [], escalated: true as const };
  }

  const batchSize =
    opts.strategy === 'sequential' ? 1 : Math.min(opts.batchSize ?? 3, candidates.length);
  const ttl = opts.ttlSeconds ?? 600;
  const chosen = candidates.slice(0, batchSize);

  const wave = await client.query(
    `INSERT INTO dispatch_waves (service_request_id, strategy, batch_size, wave_number)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [opts.serviceRequestId, opts.strategy, batchSize, waveNumber],
  );

  const offers = [];
  for (let i = 0; i < chosen.length; i++) {
    const c = chosen[i];
    const row = await client.query(
      `INSERT INTO dispatch_offers (
         wave_id, service_request_id, contractor_id, rank, status,
         slot_start, slot_end, expires_at, reply_token, score, channel
       ) VALUES ($1,$2,$3,$4,'pending',$5,$6, now() + ($7 || ' seconds')::interval, $8, $9, 'console')
       RETURNING *`,
      [
        wave.rows[0].id,
        opts.serviceRequestId,
        c.contractor_id,
        i + 1,
        c.next_open_slot_start,
        c.next_open_slot_end,
        String(ttl),
        replyToken(),
        c.score,
      ],
    );
    offers.push({ ...row.rows[0], full_name: c.full_name });
  }

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     VALUES ($1, $2, $2, $3, $4, $5, clock_timestamp())`,
    [
      opts.serviceRequestId,
      sr.status,
      opts.actorRole,
      opts.actorId,
      `offer wave #${waveNumber} ${opts.strategy} x${offers.length}`,
    ],
  );

  return { wave: wave.rows[0], offers, escalated: false as const };
}

export async function acceptOffer(
  client: pg.PoolClient,
  opts: {
    offerId: string;
    actorRole: 'contractor' | 'ops' | 'agent' | 'system';
    actorId: string;
    asContractorId?: string;
  },
) {
  await expirePendingOffers(client);

  // Load offer without locking yet — lock request first (H10)
  const peek = await client.query(
    `SELECT o.service_request_id FROM dispatch_offers o WHERE o.id = $1`,
    [opts.offerId],
  );
  if (!peek.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  }

  const srLock = await client.query(
    `SELECT sr.*, p.zip
     FROM service_requests sr
     JOIN properties p ON p.id = sr.property_id
     WHERE sr.id = $1
     FOR UPDATE OF sr`,
    [peek.rows[0].service_request_id],
  );
  if (!srLock.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  }
  const sr = srLock.rows[0];

  if (sr.dispatch_owner === 'ops' && opts.actorRole === 'agent') {
    throw Object.assign(new Error('owned_by_ops'), { code: 'OWNED_BY_OPS', status: 403 });
  }
  if (sr.status !== 'dispatching') {
    throw Object.assign(new Error('not_dispatching'), { code: 'OFFER_LOST', status: 409 });
  }

  const offerRes = await client.query(
    `SELECT * FROM dispatch_offers WHERE id = $1 FOR UPDATE`,
    [opts.offerId],
  );
  if (!offerRes.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  }
  const offer = offerRes.rows[0];

  if (opts.actorRole === 'contractor' && opts.actorId !== offer.contractor_id) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
  }
  if (opts.asContractorId && opts.asContractorId !== offer.contractor_id) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
  }

  if (offer.status !== 'pending') {
    throw Object.assign(new Error('offer_not_pending'), { code: 'OFFER_LOST', status: 409 });
  }
  if (new Date(offer.expires_at) <= new Date()) {
    await client.query(
      `UPDATE dispatch_offers SET status = 'expired', resolved_at = now() WHERE id = $1`,
      [offer.id],
    );
    // persist: route must COMMIT so expire sticks (not rolled back with the 409)
    throw Object.assign(new Error('expired'), {
      code: 'OFFER_LOST',
      status: 409,
      persist: true,
    });
  }

  const accepted = await client.query(
    `SELECT 1 FROM dispatch_offers
     WHERE service_request_id = $1 AND status = 'accepted'`,
    [offer.service_request_id],
  );
  if (accepted.rowCount) {
    throw Object.assign(new Error('already_accepted'), { code: 'OFFER_LOST', status: 409 });
  }

  const fit = await assertContractorFit(client, {
    contractorId: offer.contractor_id,
    categoryId: sr.category_id,
    zip: sr.zip,
    slotEnd: new Date(offer.slot_end),
  });
  if (!fit) {
    await client.query(
      `UPDATE dispatch_offers SET status = 'withdrawn', resolved_at = now() WHERE id = $1`,
      [offer.id],
    );
    throw Object.assign(new Error('unfit'), {
      code: 'CONTRACTOR_UNFIT',
      status: 409,
      persist: true,
    });
  }

  let appointmentId: string;
  try {
    appointmentId = await insertExclusiveAppointment(client, {
      contractorId: offer.contractor_id,
      slotStart: offer.slot_start,
      slotEnd: offer.slot_end,
    });
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'SLOT_CONFLICT') {
      await client.query(
        `UPDATE dispatch_offers SET status = 'withdrawn', resolved_at = now() WHERE id = $1`,
        [offer.id],
      );
      throw Object.assign(new Error('slot_conflict'), {
        code: 'SLOT_CONFLICT',
        status: 409,
        persist: true,
      });
    }
    throw e;
  }

  try {
    await client.query(
      `UPDATE dispatch_offers
       SET status = 'accepted', resolved_at = now()
       WHERE id = $1`,
      [offer.id],
    );
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '23505') {
      throw Object.assign(new Error('already_accepted'), { code: 'OFFER_LOST', status: 409 });
    }
    throw e;
  }

  await client.query(
    `UPDATE dispatch_offers
     SET status = 'withdrawn', resolved_at = now()
     WHERE service_request_id = $1 AND status = 'pending' AND id <> $2`,
    [offer.service_request_id, offer.id],
  );
  await client.query(`UPDATE dispatch_waves SET closed_at = now() WHERE id = $1`, [
    offer.wave_id,
  ]);

  await client.query(
    `UPDATE service_requests
     SET assigned_contractor_id = $2,
         appointment_id = $3,
         updated_at = now()
     WHERE id = $1`,
    [offer.service_request_id, offer.contractor_id, appointmentId],
  );

  await transitionStatus(client, {
    serviceRequestId: offer.service_request_id,
    to: 'booked',
    actorRole: opts.actorRole === 'agent' ? 'agent' : opts.actorRole,
    actorId: opts.actorId,
    note: `offer ${offer.reply_token} accepted`,
  });

  return {
    offer_id: offer.id,
    service_request_id: offer.service_request_id,
    appointment_id: appointmentId,
  };
}

/**
 * Ops desk direct-book: lock a contractor slot without an offer accept.
 * Same exclusivity + request transition as acceptOffer; withdraws pending offers.
 */
export async function directBookAppointment(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    contractorId: string;
    slotStart: string;
    slotEnd: string;
    actorRole: 'ops' | 'system';
    actorId: string;
  },
) {
  await expirePendingOffers(client);

  const srLock = await client.query(
    `SELECT sr.*, p.zip
     FROM service_requests sr
     JOIN properties p ON p.id = sr.property_id
     WHERE sr.id = $1
     FOR UPDATE OF sr`,
    [opts.serviceRequestId],
  );
  if (!srLock.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const sr = srLock.rows[0];
  if (sr.status !== 'dispatching') {
    throw Object.assign(new Error('not_dispatching'), {
      code: 'INVALID_STATUS',
      status: 409,
    });
  }

  const fit = await assertContractorFit(client, {
    contractorId: opts.contractorId,
    categoryId: sr.category_id,
    zip: sr.zip,
    slotEnd: new Date(opts.slotEnd),
  });
  if (!fit) {
    throw Object.assign(new Error('unfit'), {
      code: 'CONTRACTOR_UNFIT',
      status: 409,
    });
  }

  const appointmentId = await insertExclusiveAppointment(client, {
    contractorId: opts.contractorId,
    slotStart: opts.slotStart,
    slotEnd: opts.slotEnd,
  });

  await client.query(
    `UPDATE dispatch_offers
     SET status = 'withdrawn', resolved_at = now()
     WHERE service_request_id = $1 AND status = 'pending'`,
    [opts.serviceRequestId],
  );
  await client.query(
    `UPDATE dispatch_waves SET closed_at = now()
     WHERE service_request_id = $1 AND closed_at IS NULL`,
    [opts.serviceRequestId],
  );

  await client.query(
    `UPDATE service_requests
     SET assigned_contractor_id = $2,
         appointment_id = $3,
         updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId, opts.contractorId, appointmentId],
  );

  await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'booked',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: 'ops direct book',
  });

  const appt = await client.query(`SELECT * FROM appointments WHERE id = $1`, [appointmentId]);
  return appt.rows[0];
}

export async function declineOffer(
  client: pg.PoolClient,
  opts: { offerId: string; actorRole: string; actorId: string },
) {
  await expirePendingOffers(client);
  const offerRes = await client.query(
    `SELECT o.*, sr.dispatch_owner
     FROM dispatch_offers o
     JOIN service_requests sr ON sr.id = o.service_request_id
     WHERE o.id = $1
     FOR UPDATE OF o`,
    [opts.offerId],
  );
  if (!offerRes.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  }
  const offer = offerRes.rows[0];
  if (offer.dispatch_owner === 'ops' && opts.actorRole === 'agent') {
    throw Object.assign(new Error('owned_by_ops'), { code: 'OWNED_BY_OPS', status: 403 });
  }
  if (opts.actorRole === 'contractor' && opts.actorId !== offer.contractor_id) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
  }
  if (offer.status !== 'pending') {
    throw Object.assign(new Error('not_pending'), { code: 'OFFER_LOST', status: 409 });
  }
  await client.query(
    `UPDATE dispatch_offers SET status = 'declined', resolved_at = now() WHERE id = $1`,
    [offer.id],
  );
  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, $2, $3, $4, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [offer.service_request_id, opts.actorRole, opts.actorId, `offer ${offer.reply_token} declined`],
  );
  return { ok: true };
}
