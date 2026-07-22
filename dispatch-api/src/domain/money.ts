import type pg from 'pg';

import { openCase } from './cases.js';
import { transitionStatus } from '../status/transitions.js';

/** Contractor payout share stub — 70% of charge (or $0). */
export function payoutAmountCents(chargeAmountCents: number): number {
  if (chargeAmountCents <= 0) return 0;
  return Math.floor(chargeAmountCents * 0.7);
}

export async function getActiveCharge(
  client: pg.Pool | pg.PoolClient,
  serviceRequestId: string,
) {
  const { rows } = await client.query(
    `SELECT * FROM charges
     WHERE service_request_id = $1
       AND status IN ('pending', 'captured', 'failed')
     ORDER BY created_at DESC LIMIT 1`,
    [serviceRequestId],
  );
  return rows[0] ?? null;
}

export async function getPayout(
  client: pg.Pool | pg.PoolClient,
  serviceRequestId: string,
) {
  const { rows } = await client.query(
    `SELECT * FROM payouts WHERE service_request_id = $1 LIMIT 1`,
    [serviceRequestId],
  );
  return rows[0] ?? null;
}

/**
 * On complete: create payout held; if charge amount > 0 leave pending for capture worker.
 * $0 charges mark captured immediately (included visit).
 */
export async function settleMoneyOnComplete(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    contractorId: string;
    actorRole: string;
    actorId: string;
  },
) {
  const charge = await getActiveCharge(client, opts.serviceRequestId);
  if (!charge) {
    await client.query(
      `INSERT INTO job_events
         (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
       SELECT id, status, status, $2, $3, $4, clock_timestamp()
       FROM service_requests WHERE id = $1`,
      [opts.serviceRequestId, opts.actorRole, opts.actorId, 'complete — no charge row'],
    );
    return { charge: null, payout: null, capture_enqueued: false };
  }

  let chargeOut = charge;
  if (charge.amount_cents === 0 && charge.status === 'pending') {
    const upd = await client.query(
      `UPDATE charges
       SET status = 'captured', updated_at = now(), note = coalesce(note,'') || ' | $0 auto-captured'
       WHERE id = $1 RETURNING *`,
      [charge.id],
    );
    chargeOut = upd.rows[0];
  }

  const amount = payoutAmountCents(chargeOut.amount_cents as number);
  const payout = await client.query(
    `INSERT INTO payouts (service_request_id, contractor_id, amount_cents, status, note)
     VALUES ($1, $2, $3, 'held', $4)
     ON CONFLICT (service_request_id) DO UPDATE
       SET amount_cents = EXCLUDED.amount_cents,
           updated_at = now()
     RETURNING *`,
    [
      opts.serviceRequestId,
      opts.contractorId,
      amount,
      'held at complete',
    ],
  );

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, $2, $3, $4, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [
      opts.serviceRequestId,
      opts.actorRole,
      opts.actorId,
      chargeOut.amount_cents > 0
        ? `payout held ${amount}¢ — capture enqueued`
        : `payout held ${amount}¢ — $0 charge captured`,
    ],
  );

  return {
    charge: chargeOut,
    payout: payout.rows[0],
    capture_enqueued: (chargeOut.amount_cents as number) > 0 && chargeOut.status === 'pending',
  };
}

/** Capture stub — creates payment_attempt; succeeds unless force_fail. */
export async function captureCharge(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'system';
    actorId: string;
    forceFail?: boolean;
  },
) {
  const charge = await getActiveCharge(client, opts.serviceRequestId);
  if (!charge) {
    throw Object.assign(new Error('no_charge'), { code: 'NO_CHARGE', status: 404 });
  }
  if (charge.status === 'captured' || charge.status === 'voided') {
    return { charge, attempt: null, already: true as const };
  }
  if (charge.status !== 'pending' && charge.status !== 'failed') {
    throw Object.assign(new Error('bad_charge_status'), {
      code: 'INVALID_CHARGE',
      status: 409,
      detail: `cannot capture ${charge.status}`,
    });
  }

  if (charge.amount_cents === 0) {
    const upd = await client.query(
      `UPDATE charges SET status = 'captured', updated_at = now() WHERE id = $1 RETURNING *`,
      [charge.id],
    );
    return { charge: upd.rows[0], attempt: null, already: false as const };
  }

  const succeed = !opts.forceFail;
  const attempt = await client.query(
    `INSERT INTO payment_attempts
       (charge_id, service_request_id, amount_cents, status, provider_ref, failure_reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      charge.id,
      opts.serviceRequestId,
      charge.amount_cents,
      succeed ? 'succeeded' : 'failed',
      succeed ? `stub_${Date.now().toString(36)}` : null,
      succeed ? null : 'stub_card_declined',
    ],
  );

  const upd = await client.query(
    `UPDATE charges
     SET status = $2, updated_at = now(),
         note = coalesce(note,'') || $3
     WHERE id = $1
     RETURNING *`,
    [
      charge.id,
      succeed ? 'captured' : 'failed',
      succeed ? ' | captured' : ' | capture failed',
    ],
  );

  if (!succeed) {
    await openCase(client, {
      serviceRequestId: opts.serviceRequestId,
      type: 'escalation',
      reasonCode: 'capture_failed',
      moneyImpact: 'hold_payout',
      blocksClose: true,
      actorRole: opts.actorRole,
      actorId: opts.actorId,
      note: 'capture failed — close blocked',
      meta: { payment_attempt_id: attempt.rows[0].id },
    });
  }

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, $2, $3, $4, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [
      opts.serviceRequestId,
      opts.actorRole,
      opts.actorId,
      succeed
        ? `payment_attempt succeeded ${charge.amount_cents}¢`
        : `payment_attempt failed ${charge.amount_cents}¢`,
    ],
  );

  return { charge: upd.rows[0], attempt: attempt.rows[0], already: false as const };
}

/** Fire pending captures for completed jobs (ops/system worker). */
export async function runCaptureWorker(
  client: pg.PoolClient,
  opts: { actorRole: 'ops' | 'system'; actorId: string; limit?: number },
) {
  const { rows } = await client.query(
    `SELECT c.service_request_id
     FROM charges c
     JOIN service_requests sr ON sr.id = c.service_request_id
     WHERE c.status = 'pending' AND c.amount_cents > 0
       AND sr.status IN ('needs_review', 'reviewed', 'completed')
     ORDER BY c.created_at ASC
     LIMIT $1
     FOR UPDATE OF c SKIP LOCKED`,
    [opts.limit ?? 25],
  );
  const results = [];
  for (const row of rows) {
    results.push(
      await captureCharge(client, {
        serviceRequestId: row.service_request_id,
        actorRole: opts.actorRole,
        actorId: opts.actorId,
      }),
    );
  }
  return { captured: results.length, items: results };
}

export async function ackCompletion(
  client: pg.PoolClient,
  opts: { serviceRequestId: string; actorRole: 'member' | 'ops'; actorId: string },
) {
  const locked = await client.query(
    `SELECT * FROM service_requests WHERE id = $1 FOR UPDATE`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const sr = locked.rows[0];
  if (opts.actorRole === 'member' && sr.homeowner_id !== opts.actorId) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
  }
  if (!['needs_review', 'reviewed', 'completed'].includes(sr.status)) {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `ack_completion from ${sr.status}`,
    });
  }

  await client.query(
    `UPDATE service_requests
     SET completion_acked_at = now(), updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId],
  );
  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     VALUES ($1, $2, $2, $3, $4, 'ack_completion', clock_timestamp())`,
    [opts.serviceRequestId, sr.status, opts.actorRole, opts.actorId],
  );
  return { ok: true, status: sr.status as string };
}

export async function submitReview(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'member' | 'ops' | 'system';
    actorId: string;
    rating?: number;
    comment?: string;
    timeout?: boolean;
  },
) {
  const locked = await client.query(
    `SELECT * FROM service_requests WHERE id = $1 FOR UPDATE`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const sr = locked.rows[0];
  if (opts.actorRole === 'member' && sr.homeowner_id !== opts.actorId) {
    throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN', status: 403 });
  }
  if (sr.status !== 'needs_review') {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `review requires needs_review, got ${sr.status}`,
    });
  }

  const rating =
    typeof opts.rating === 'number' && opts.rating >= 1 && opts.rating <= 5
      ? opts.rating
      : opts.timeout
        ? null
        : 5;

  await client.query(
    `UPDATE service_requests
     SET review_rating = $2,
         review_comment = $3,
         reviewed_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId, rating, opts.comment ?? (opts.timeout ? 'auto: 72h timeout' : null)],
  );

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'reviewed',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.timeout ? 'review timeout (72h stub)' : `submit_review rating=${rating}`,
  });

  return { status: result.to, rating };
}

export async function openDispute(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'member' | 'ops';
    actorId: string;
    reason: string;
  },
) {
  const locked = await client.query(
    `SELECT * FROM service_requests WHERE id = $1 FOR UPDATE`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const sr = locked.rows[0];
  if (!['needs_review', 'confirmed', 'checked_in'].includes(sr.status)) {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
    });
  }

  const cse = await openCase(client, {
    serviceRequestId: opts.serviceRequestId,
    type: 'dispute',
    reasonCode: 'member_dispute',
    blocksClose: true,
    moneyImpact: 'hold_payout',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    meta: { reason: opts.reason },
    note: `dispute: ${opts.reason}`,
  });

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'disputed',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: `dispute: ${opts.reason}`,
  });

  return { status: result.to, case: cse };
}

export async function createRefund(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops';
    actorId: string;
    amountCents: number;
    reason: string;
  },
) {
  const charge = await getActiveCharge(client, opts.serviceRequestId);
  if (!charge || charge.status !== 'captured') {
    throw Object.assign(new Error('no_captured_charge'), {
      code: 'NO_CAPTURED_CHARGE',
      status: 409,
    });
  }
  if (opts.amountCents <= 0 || opts.amountCents > charge.amount_cents) {
    throw Object.assign(new Error('bad_amount'), {
      code: 'VALIDATION_ERROR',
      status: 422,
    });
  }

  const refund = await client.query(
    `INSERT INTO refunds (charge_id, service_request_id, amount_cents, status, reason)
     VALUES ($1, $2, $3, 'succeeded', $4)
     RETURNING *`,
    [charge.id, opts.serviceRequestId, opts.amountCents, opts.reason],
  );

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, 'ops', $2, $3, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [opts.serviceRequestId, opts.actorId, `refund ${opts.amountCents}¢ — ${opts.reason}`],
  );

  // Charge status stays captured (money ≠ status)
  return { refund: refund.rows[0], charge_status: charge.status };
}

export async function closeRequest(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    actorRole: 'ops' | 'system';
    actorId: string;
    note?: string;
    waivePayoutHold?: boolean;
  },
) {
  const locked = await client.query(
    `SELECT * FROM service_requests WHERE id = $1 FOR UPDATE`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const sr = locked.rows[0];
  if (sr.status !== 'reviewed' && sr.status !== 'resolved') {
    throw Object.assign(new Error('invalid_status'), {
      code: 'INVALID_STATUS',
      status: 409,
      detail: `close requires reviewed|resolved, got ${sr.status}`,
    });
  }

  const blocking = await client.query(
    `SELECT id, type FROM cases
     WHERE service_request_id = $1 AND status = 'open' AND blocks_close = true
     LIMIT 5`,
    [opts.serviceRequestId],
  );
  if (blocking.rowCount) {
    throw Object.assign(new Error('blocks_close'), {
      code: 'BLOCKS_CLOSE',
      status: 409,
      detail: `open blocking case: ${blocking.rows.map((r) => r.type).join(',')}`,
    });
  }

  const charge = await getActiveCharge(client, opts.serviceRequestId);
  if (charge) {
    const ok =
      charge.status === 'captured' ||
      charge.status === 'voided' ||
      (charge.status === 'pending' && charge.amount_cents === 0);
    if (!ok) {
      throw Object.assign(new Error('charge_not_terminal'), {
        code: 'CHARGE_NOT_TERMINAL',
        status: 409,
        detail: `charge status ${charge.status} amount ${charge.amount_cents}`,
      });
    }
  }

  const payout = await getPayout(client, opts.serviceRequestId);
  if (payout && payout.status === 'held') {
    if (!opts.waivePayoutHold) {
      // Move held → payable as part of close (happy path)
      await client.query(
        `UPDATE payouts
         SET status = 'payable', updated_at = now(), note = coalesce(note,'') || ' | payable at close'
         WHERE id = $1`,
        [payout.id],
      );
    } else {
      await client.query(
        `UPDATE payouts
         SET status = 'waived', updated_at = now(), note = coalesce(note,'') || ' | ops waiver'
         WHERE id = $1`,
        [payout.id],
      );
    }
  }

  const result = await transitionStatus(client, {
    serviceRequestId: opts.serviceRequestId,
    to: 'closed',
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.note ?? 'close',
  });

  return {
    status: result.to,
    payout: await getPayout(client, opts.serviceRequestId),
    charge,
  };
}

export async function moneySnapshot(
  client: pg.Pool | pg.PoolClient,
  serviceRequestId: string,
) {
  const charge = await getActiveCharge(client, serviceRequestId);
  const payout = await getPayout(client, serviceRequestId);
  const { rows: attempts } = await client.query(
    `SELECT * FROM payment_attempts WHERE service_request_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [serviceRequestId],
  );
  const { rows: refunds } = await client.query(
    `SELECT * FROM refunds WHERE service_request_id = $1 ORDER BY created_at DESC`,
    [serviceRequestId],
  );
  return { charge, payout, payment_attempts: attempts, refunds };
}
