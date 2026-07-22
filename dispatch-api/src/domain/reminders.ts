import type pg from 'pg';

export const REMINDER_CADENCE: { kind: 't_24h' | 't_2h' | 't_30m'; msBefore: number }[] = [
  { kind: 't_24h', msBefore: 24 * 60 * 60 * 1000 },
  { kind: 't_2h', msBefore: 2 * 60 * 60 * 1000 },
  { kind: 't_30m', msBefore: 30 * 60 * 1000 },
];

/** Cancel all scheduled reminders for a request (H16 reschedule/cancel). */
export async function cancelScheduledReminders(
  client: pg.Pool | pg.PoolClient,
  serviceRequestId: string,
) {
  await client.query(
    `UPDATE reminder_jobs
     SET status = 'cancelled'
     WHERE service_request_id = $1 AND status = 'scheduled'`,
    [serviceRequestId],
  );
}

/**
 * Schedule T-24 / T-2 / T-30 from appointment slot_start.
 * fire_at = slot_start − offset (absolute); timezone stored for audit / local display (H16).
 * Skips reminders whose fire_at is already in the past (marks skipped).
 */
export async function scheduleReminders(
  client: pg.PoolClient,
  opts: {
    serviceRequestId: string;
    slotStart: Date;
    timezone: string;
  },
) {
  await cancelScheduledReminders(client, opts.serviceRequestId);
  const now = Date.now();
  const rows = [];
  for (const c of REMINDER_CADENCE) {
    const fireAt = new Date(opts.slotStart.getTime() - c.msBefore);
    const status = fireAt.getTime() <= now ? 'skipped' : 'scheduled';
    const r = await client.query(
      `INSERT INTO reminder_jobs
         (service_request_id, kind, fire_at, timezone, status, fired_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        opts.serviceRequestId,
        c.kind,
        fireAt.toISOString(),
        opts.timezone,
        status,
        status === 'skipped' ? new Date().toISOString() : null,
      ],
    );
    rows.push(r.rows[0]);
  }
  return rows;
}

/** Fire due scheduled reminders; each fire → job_event note (system worker). */
export async function fireDueReminders(
  client: pg.PoolClient,
  limit = 50,
): Promise<{ fired: number; items: unknown[] }> {
  const due = await client.query(
    `SELECT * FROM reminder_jobs
     WHERE status = 'scheduled' AND fire_at <= now()
     ORDER BY fire_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  const items = [];
  for (const row of due.rows) {
    await client.query(
      `UPDATE reminder_jobs
       SET status = 'fired', fired_at = now()
       WHERE id = $1`,
      [row.id],
    );
    await client.query(
      `INSERT INTO job_events
         (service_request_id, from_status, to_status, actor_role, actor_id, note, created_at)
       SELECT id, status, status, 'system', $2, $3, clock_timestamp()
       FROM service_requests WHERE id = $1`,
      [
        row.service_request_id,
        '00000000-0000-4000-8000-000000000001',
        `reminder ${row.kind} fired`,
      ],
    );
    items.push({ ...row, status: 'fired' });
  }
  return { fired: items.length, items };
}
