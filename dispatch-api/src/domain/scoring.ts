import type pg from 'pg';

export type ScoredCandidate = {
  contractor_id: string;
  full_name: string;
  vetting_status: string;
  rating: number | null;
  score: number;
  next_open_slot_start: string;
  next_open_slot_end: string;
  accept_rate: number;
  open_load: number;
};

function fitnessSql(): string {
  return `
    c.vetting_status = 'approved'
    AND c.suspended_at IS NULL
    AND (c.insurance_expires_at IS NULL OR c.insurance_expires_at > $3)
    AND $1 = ANY (c.categories)
    AND $2 = ANY (c.service_zips)
  `;
}

/**
 * Rank vetted contractors by skill, zip, load, historical accept rate.
 * Only returns pros with a free availability slot overlapping the window.
 */
export async function scoreCandidates(
  client: pg.Pool | pg.PoolClient,
  opts: {
    categoryId: string;
    zip: string;
    windowStart: Date;
    windowEnd: Date;
    excludeContractorIds?: string[];
  },
): Promise<ScoredCandidate[]> {
  const exclude = opts.excludeContractorIds ?? [];
  const { rows } = await client.query(
    `
    WITH fit AS (
      SELECT c.*
      FROM contractors c
      WHERE ${fitnessSql()}
        AND ($4::uuid[] IS NULL OR NOT (c.id = ANY (COALESCE($4::uuid[], ARRAY[]::uuid[]))))
    ),
    slots AS (
      SELECT DISTINCT ON (s.contractor_id)
        s.contractor_id,
        s.slot_start,
        s.slot_end
      FROM availability_slots s
      JOIN fit f ON f.id = s.contractor_id
      WHERE s.slot_start < $3
        AND s.slot_end > $5
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.contractor_id = s.contractor_id
            AND tstzrange(a.slot_start, a.slot_end, '[)') &&
                tstzrange(s.slot_start, s.slot_end, '[)')
        )
      ORDER BY s.contractor_id, s.slot_start ASC
    ),
    stats AS (
      SELECT
        o.contractor_id,
        COUNT(*) FILTER (WHERE o.status = 'accepted')::float /
          NULLIF(COUNT(*) FILTER (WHERE o.status IN ('accepted','declined','expired')), 0)
          AS accept_rate
      FROM dispatch_offers o
      GROUP BY o.contractor_id
    ),
    load AS (
      SELECT assigned_contractor_id AS contractor_id, COUNT(*)::int AS open_load
      FROM service_requests
      WHERE status IN ('booked', 'confirmed', 'checked_in')
        AND assigned_contractor_id IS NOT NULL
      GROUP BY assigned_contractor_id
    )
    SELECT
      f.id AS contractor_id,
      f.full_name,
      f.vetting_status,
      f.rating,
      s.slot_start AS next_open_slot_start,
      s.slot_end AS next_open_slot_end,
      COALESCE(st.accept_rate, 0.5) AS accept_rate,
      COALESCE(l.open_load, 0) AS open_load,
      (
        40.0
        + COALESCE(f.rating, 3) * 8.0
        + COALESCE(st.accept_rate, 0.5) * 30.0
        - COALESCE(l.open_load, 0) * 5.0
      )::numeric(8,4) AS score
    FROM fit f
    JOIN slots s ON s.contractor_id = f.id
    LEFT JOIN stats st ON st.contractor_id = f.id
    LEFT JOIN load l ON l.contractor_id = f.id
    ORDER BY score DESC, f.rating DESC NULLS LAST
    LIMIT 25
    `,
    [
      opts.categoryId,
      opts.zip,
      opts.windowEnd.toISOString(),
      exclude.length ? exclude : null,
      opts.windowStart.toISOString(),
    ],
  );

  return rows.map((r) => ({
    contractor_id: r.contractor_id,
    full_name: r.full_name,
    vetting_status: r.vetting_status,
    rating: r.rating != null ? Number(r.rating) : null,
    score: Number(r.score),
    next_open_slot_start: new Date(r.next_open_slot_start).toISOString(),
    next_open_slot_end: new Date(r.next_open_slot_end).toISOString(),
    accept_rate: Number(r.accept_rate),
    open_load: Number(r.open_load),
  }));
}

export async function assertContractorFit(
  client: pg.PoolClient,
  opts: {
    contractorId: string;
    categoryId: string;
    zip: string;
    slotEnd: Date;
  },
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM contractors c
     WHERE c.id = $4
       AND ${fitnessSql()}`,
    [opts.categoryId, opts.zip, opts.slotEnd.toISOString(), opts.contractorId],
  );
  return (rows.length ?? 0) > 0;
}
