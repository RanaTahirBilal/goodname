/**
 * The shared numeric primitives of the scoring model.
 *
 * Kept separate from the dimensions so they can be tested at their boundaries
 * once rather than implicitly through seven callers.
 */

export const clamp = (v: number, lo = 0, hi = 1): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * How much a result matters by virtue of where it ranks.
 *
 * Position 1 → 1.000, position 3 → 0.500, position 10 → 0.289. A result with
 * no position was not ranked in the observed window and contributes nothing,
 * which is different from contributing zero to an average.
 */
export const prominence = (position?: number): number => {
  if (position === undefined || position < 1) return 0;
  return 1 / Math.log2(position + 1);
};

/** Age in whole days between a publication date and the observation. */
export const ageInDays = (publishedAt: string | undefined, observedAt: string): number | null => {
  if (!publishedAt) return null;
  const published = Date.parse(publishedAt);
  const observed = Date.parse(observedAt);
  if (Number.isNaN(published) || Number.isNaN(observed)) return null;
  return Math.max(0, (observed - published) / 86_400_000);
};

/**
 * Old harm is still harm; it just weighs less. Floors at 0.5 rather than
 * decaying to nothing, because a decade-old conviction at position one is
 * still the first thing anyone reads.
 *
 * An undefined age returns 0.75 — the midpoint — and callers flag it, rather
 * than silently treating undated content as either fresh or ancient.
 */
export const RECENCY_UNKNOWN = 0.75;

export const recencyDecay = (ageDays: number | null): number => {
  if (ageDays === null) return RECENCY_UNKNOWN;
  return 0.5 + 0.5 * Math.exp(-ageDays / 1095);
};

/**
 * Source authority tiers. A property of the publication, never of whether we
 * like what it says — the same tier applies to praise and to criticism.
 */
const AUTHORITY_TIERS: Record<string, number> = {
  national_press: 1.0,
  trade_press: 0.8,
  regulator: 0.7,
  directory: 0.7,
  established_blog: 0.4,
  aggregator: 0.2,
  unknown: 0.3,
};

export type AuthorityTier = keyof typeof AUTHORITY_TIERS;

export const authorityOf = (tier: AuthorityTier | string): number =>
  AUTHORITY_TIERS[tier] ?? AUTHORITY_TIERS.unknown;

/** Mean of a list, or null for an empty one — never 0, which is a real score. */
export const meanOrNull = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
