/** H19 — promise_by = created_at + sla_hours(category, tier) */

const BASE_HOURS: Record<string, number> = {
  hvac: 24,
  plumbing: 24,
  electrical: 24,
  appliance: 48,
  landscaping: 72,
  default: 48,
};

const TIER_FACTOR: Record<string, number> = {
  Premium: 0.5,
  Comfort: 0.75,
  Free: 1,
};

export function slaHours(categoryId: string, membershipTier: string): number {
  const base = BASE_HOURS[categoryId.toLowerCase()] ?? BASE_HOURS.default;
  const factor = TIER_FACTOR[membershipTier] ?? 1;
  return Math.max(4, Math.round(base * factor));
}

export function computePromiseBy(
  createdAt: Date,
  categoryId: string,
  membershipTier: string,
): Date {
  const hours = slaHours(categoryId, membershipTier);
  return new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
}
