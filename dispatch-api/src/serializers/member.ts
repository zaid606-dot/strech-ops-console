/**
 * INV-2 / H3 — member-facing payload never includes contractor PII.
 */
export function memberPublicRequest(row: {
  id: string;
  status: string;
  category_id: string;
  confirmation_code: string | null;
  preferred_window_start: string | null;
  preferred_window_end: string | null;
  confirmed_at: string | null;
  promise_by: string | null;
  created_at: string;
  updated_at: string;
  assigned_contractor_id?: string | null;
  appointment_id?: string | null;
  details?: Record<string, unknown>;
}) {
  return {
    id: row.id,
    status: row.status,
    category_id: row.category_id,
    confirmation_code: row.confirmation_code,
    preferred_window_start: row.preferred_window_start,
    preferred_window_end: row.preferred_window_end,
    confirmed_at: row.confirmed_at,
    promise_by: row.promise_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Masked pro — never real contractor identity
    pro_label: row.status === 'dispatching' ? null : 'Strech Pro',
    // Explicitly omit assigned_contractor_id, appointment internals, access/safety details
  };
}

export function assertNoContractorLeak(payload: unknown) {
  const s = JSON.stringify(payload);
  if (s.includes('assigned_contractor_id') || /"contractor_id"\s*:/.test(s)) {
    throw new Error('INV2_LEAK');
  }
  // Block obvious contractor PII keys in member payloads
  if (/"full_name"\s*:/.test(s) && /"phone"\s*:/.test(s)) {
    throw new Error('INV2_LEAK');
  }
  if (/"email"\s*:\s*"[^"]+@/.test(s) && s.includes('contractor')) {
    throw new Error('INV2_LEAK');
  }
}
