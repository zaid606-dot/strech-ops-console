/** Visit charge amount from category + membership tier (H5 / money ≠ status). */
const CATEGORY_BASE_CENTS: Record<string, number> = {
  hvac: 12900,
  plumbing: 9900,
  electrical: 10900,
  appliance: 8900,
};

/**
 * Free pays list price. Comfort / Premium included visits are still charge rows at $0.
 */
export function visitAmountCents(categoryId: string, membershipTier: string): number {
  const base = CATEGORY_BASE_CENTS[categoryId] ?? 7900;
  if (membershipTier === 'Comfort' || membershipTier === 'Premium') return 0;
  return base;
}
