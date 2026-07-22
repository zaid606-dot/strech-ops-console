/** Canonical service request statuses — do not invent synonyms. */
export const STATUSES = [
  'dispatching',
  'booked',
  'confirmed',
  'checked_in',
  'completed',
  'needs_review',
  'reviewed',
  'closed',
  'no_show',
  'cancelled',
  'disputed',
  'resolved',
] as const;

export type ServiceRequestStatus = (typeof STATUSES)[number];

export type ActorRole = 'member' | 'ops' | 'contractor' | 'system' | 'agent';

/** Legal edges of the status machine (happy + side paths). */
const ALLOWED: Record<ServiceRequestStatus, readonly ServiceRequestStatus[]> = {
  dispatching: ['booked', 'cancelled'],
  booked: ['confirmed', 'dispatching', 'cancelled'],
  confirmed: ['checked_in', 'no_show', 'cancelled', 'disputed'],
  checked_in: ['completed', 'disputed', 'cancelled'],
  // complete always auto-chains to needs_review; dispute from needs_review
  completed: ['needs_review'],
  needs_review: ['reviewed', 'disputed'],
  reviewed: ['closed'],
  closed: [],
  no_show: ['dispatching', 'cancelled'],
  cancelled: [],
  disputed: ['resolved'],
  resolved: ['closed'],
};

export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

export function isStatus(v: string): v is ServiceRequestStatus {
  return (STATUSES as readonly string[]).includes(v);
}

export function canTransition(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  constructor(
    public from: ServiceRequestStatus,
    public to: ServiceRequestStatus,
  ) {
    super(`Cannot transition ${from} → ${to}`);
  }
}

type Queryable = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number | null }>;
};

async function assertInTransaction(client: Queryable) {
  const r = await client.query(`SELECT txid_current_if_assigned() AS txid`);
  const txid = (r.rows[0] as { txid: string | null }).txid;
  if (txid == null) {
    throw new Error('transitionStatus requires an open DB transaction');
  }
}

async function insertEvent(
  client: Queryable,
  row: {
    serviceRequestId: string;
    from: ServiceRequestStatus | null;
    to: ServiceRequestStatus;
    actorRole: ActorRole;
    actorId: string;
    note?: string | null;
  },
) {
  // clock_timestamp() is unique per statement — keeps timeline order inside a txn
  await client.query(
    `INSERT INTO job_events
      (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [
      row.serviceRequestId,
      row.from,
      row.to,
      row.actorRole,
      row.actorId,
      row.note ?? null,
    ],
  );
}

/**
 * Apply a status change and append job_event(s).
 * MUST be called inside an open transaction (BEGIN … COMMIT).
 */
export async function transitionStatus(
  client: Queryable,
  opts: {
    serviceRequestId: string;
    to: ServiceRequestStatus;
    actorRole: ActorRole;
    actorId: string;
    note?: string | null;
  },
): Promise<{ from: ServiceRequestStatus; to: ServiceRequestStatus }> {
  await assertInTransaction(client);

  const locked = await client.query(
    `SELECT status FROM service_requests WHERE id = $1 FOR UPDATE`,
    [opts.serviceRequestId],
  );
  if (!locked.rowCount) {
    throw new Error('SERVICE_REQUEST_NOT_FOUND');
  }
  const from = (locked.rows[0] as { status: ServiceRequestStatus }).status;

  // Public API: callers request "completed"; engine expands to needs_review
  const requested = opts.to;
  if (requested === 'completed') {
    if (!canTransition(from, 'completed') && from !== 'checked_in') {
      // checked_in → completed is allowed via ALLOWED completed list from checked_in
    }
    if (from !== 'checked_in') {
      throw new IllegalTransitionError(from, 'completed');
    }

    await client.query(
      `UPDATE service_requests
       SET status = 'completed', updated_at = now()
       WHERE id = $1`,
      [opts.serviceRequestId],
    );
    await insertEvent(client, {
      serviceRequestId: opts.serviceRequestId,
      from,
      to: 'completed',
      actorRole: opts.actorRole,
      actorId: opts.actorId,
      note: opts.note,
    });

    await client.query(
      `UPDATE service_requests
       SET status = 'needs_review', updated_at = now()
       WHERE id = $1`,
      [opts.serviceRequestId],
    );
    await insertEvent(client, {
      serviceRequestId: opts.serviceRequestId,
      from: 'completed',
      to: 'needs_review',
      actorRole: 'system',
      actorId: SYSTEM_ACTOR_ID,
      note: 'auto: complete → needs_review',
    });

    return { from, to: 'needs_review' };
  }

  if (!canTransition(from, requested)) {
    throw new IllegalTransitionError(from, requested);
  }

  await client.query(
    `UPDATE service_requests
     SET status = $2, updated_at = now()
     WHERE id = $1`,
    [opts.serviceRequestId, requested],
  );
  await insertEvent(client, {
    serviceRequestId: opts.serviceRequestId,
    from,
    to: requested,
    actorRole: opts.actorRole,
    actorId: opts.actorId,
    note: opts.note,
  });

  return { from, to: requested };
}

/** Convenience: BEGIN/transition/COMMIT on a pool. */
export async function runTransition(
  pool: {
    connect: () => Promise<
      Queryable & { release: () => void; query: Queryable['query'] }
    >;
  },
  opts: Parameters<typeof transitionStatus>[1],
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transitionStatus(client, opts);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
