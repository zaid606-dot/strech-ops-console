import type pg from 'pg';

export type CaseType =
  | 'escalation'
  | 'scope_change'
  | 'reschedule'
  | 'no_show'
  | 'parts_hold'
  | 'dispute'
  | 'emergency'
  | 'cancel_request';

export type CaseStatus = 'open' | 'resolved' | 'dismissed';

export async function openCase(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    type: CaseType;
    reasonCode?: string;
    ownerRole?: 'ops' | 'agent' | 'system';
    blocksClose?: boolean;
    moneyImpact?: 'none' | 'amend_charge' | 'refund' | 'hold_payout';
    meta?: Record<string, unknown>;
    actorRole: string;
    actorId: string;
    note?: string;
  },
) {
  const blocks =
    opts.blocksClose ??
    (opts.type === 'emergency' || opts.type === 'dispute');
  const money =
    opts.moneyImpact ??
    (opts.type === 'emergency' || opts.type === 'dispute'
      ? 'hold_payout'
      : opts.type === 'scope_change'
        ? 'amend_charge'
        : 'none');

  const { rows } = await client.query(
    `INSERT INTO cases (
       service_request_id, type, reason_code, owner_role,
       blocks_close, money_impact, meta
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      opts.serviceRequestId,
      opts.type,
      opts.reasonCode ?? null,
      opts.ownerRole ?? 'ops',
      blocks,
      money,
      JSON.stringify(opts.meta ?? {}),
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
      opts.note ?? `case opened: ${opts.type}${opts.reasonCode ? ` (${opts.reasonCode})` : ''}`,
    ],
  );

  return rows[0];
}

export async function resolveCase(
  client: pg.PoolClient,
  opts: {
    caseId: string;
    actorRole: 'ops' | 'system';
    actorId: string;
    resolution: 'resolved' | 'dismissed';
    note?: string;
  },
) {
  const locked = await client.query(`SELECT * FROM cases WHERE id = $1 FOR UPDATE`, [
    opts.caseId,
  ]);
  if (!locked.rowCount) {
    throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND', status: 404 });
  }
  const row = locked.rows[0];
  if (row.status !== 'open') {
    throw Object.assign(new Error('not_open'), { code: 'CASE_NOT_OPEN', status: 409 });
  }

  const { rows } = await client.query(
    `UPDATE cases
     SET status = $2, resolved_at = now()
     WHERE id = $1
     RETURNING *`,
    [opts.caseId, opts.resolution],
  );

  await client.query(
    `INSERT INTO job_events
       (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
     SELECT id, status, status, $2, $3, $4, clock_timestamp()
     FROM service_requests WHERE id = $1`,
    [
      row.service_request_id,
      opts.actorRole,
      opts.actorId,
      opts.note ?? `case ${opts.resolution}: ${row.type}`,
    ],
  );

  return rows[0];
}

export async function listCases(
  client: pg.Pool | pg.PoolClient,
  opts: { status?: string; type?: string; serviceRequestId?: string } = {},
) {
  const params: unknown[] = [];
  let sql = `
    SELECT c.*, sr.confirmation_code, sr.status AS request_status,
           sr.dispatch_owner
    FROM cases c
    JOIN service_requests sr ON sr.id = c.service_request_id
    WHERE 1=1`;
  if (opts.status && opts.status !== 'all') {
    params.push(opts.status);
    sql += ` AND c.status = $${params.length}`;
  }
  if (opts.type) {
    params.push(opts.type);
    sql += ` AND c.type = $${params.length}`;
  }
  if (opts.serviceRequestId) {
    params.push(opts.serviceRequestId);
    sql += ` AND c.service_request_id = $${params.length}`;
  }
  // Emergencies first, then open by created_at
  sql += `
    ORDER BY
      CASE WHEN c.type = 'emergency' AND c.status = 'open' THEN 0 ELSE 1 END,
      CASE WHEN c.status = 'open' THEN 0 ELSE 1 END,
      c.created_at DESC
    LIMIT 200`;
  const { rows } = await client.query(sql, params);
  return rows;
}

/** Strip emergency/medical payload for agent serializers. */
export function agentSafeCase(row: Record<string, unknown>) {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const { payload, medical, ...safeMeta } = meta;
  return {
    ...row,
    meta: {
      ...safeMeta,
      has_payload: Boolean(payload || medical),
    },
  };
}
