/**
 * PII redaction tiers (H17).
 * member_public — INV-2
 * contractor_field — address/access, no medical/billing
 * agent_context — ops-like minus medical/emergency payload bodies
 * ops_only — full
 */

export function contractorFieldPayload(row: {
  id: string;
  status: string;
  category_id: string;
  confirmation_code: string | null;
  details?: Record<string, unknown> | null;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  slot_start?: string | null;
  slot_end?: string | null;
}) {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(
      ([k]) =>
        !k.startsWith('safety.') &&
        !k.startsWith('medical.') &&
        k !== 'billing' &&
        !k.startsWith('card.'),
    ),
  );
  return {
    id: row.id,
    status: row.status,
    category_id: row.category_id,
    confirmation_code: row.confirmation_code,
    slot_start: row.slot_start ?? null,
    slot_end: row.slot_end ?? null,
    property: {
      address_line1: row.address_line1,
      city: row.city,
      state: row.state,
      zip: row.zip,
    },
    details: safeDetails,
  };
}

export function agentContextCase(row: Record<string, unknown>) {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const { payload, medical, ...rest } = meta;
  return {
    ...row,
    meta: {
      ...rest,
      has_payload: Boolean(payload || medical),
    },
  };
}
