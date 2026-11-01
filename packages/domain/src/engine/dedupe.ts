/**
 * Story clustering.
 *
 * One event produces many articles. A wire story about a disciplinary hearing
 * can appear in a dozen outlets within a day, and counting each as an
 * independent source would turn one event into a dozen corroborations — which
 * is precisely backwards, since syndication is the opposite of independent
 * verification.
 *
 * So results are grouped into story clusters, and the risk assessment counts
 * **clusters**, not documents. Corroboration means two independent outlets
 * reporting separately, not one press release reprinted twice.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'as', 'is', 'was', 'were', 'be', 'been', 'after',
  'over', 'into', 'his', 'her', 'their', 'its', 'he', 'she', 'they', 'it',
  'this', 'that', 'these', 'those', 'has', 'have', 'had', 'will', 'said',
]);

const tokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );

/** Jaccard similarity over significant tokens. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;

  return shared / (ta.size + tb.size - shared);
}

/**
 * Two documents are the same story above this similarity.
 *
 * Chosen to be forgiving of rewritten headlines while still separating two
 * genuinely different events about the same person. Tuning this is a product
 * decision with a real cost either way: too low merges distinct findings into
 * one, too high inflates corroboration counts.
 */
export const SAME_STORY_THRESHOLD = 0.5;

/**
 * Above this, two documents are the *same text*, not two accounts of one
 * event — a wire story reprinted, or a press release pasted.
 *
 * This threshold is what separates corroboration from syndication, and
 * getting it wrong is consequential in both directions. Count syndicated
 * copies as independent and one press release promotes an allegation to a
 * finding. Treat genuine independent reporting as syndication and real
 * corroboration never registers.
 */
export const NEAR_IDENTICAL_THRESHOLD = 0.8;

export interface Clusterable {
  id: string;
  title: string;
  snippet: string;
  domain: string;
  publishedAt?: string;
}

export interface Cluster {
  id: string;
  memberIds: string[];
  /** The earliest-published member, or the first seen when undated. */
  primaryId: string;
  /** Members that are near-identical reprints of the primary. */
  syndicatedIds: string[];
  /**
   * Distinct domains that reported this *independently* — syndicated
   * reprints excluded. This is the number that may promote an allegation.
   */
  independentSources: number;
}

/**
 * Greedy single-link clustering. Fine at the scale of one page of results;
 * replace it when a scan returns hundreds of documents rather than tens.
 */
export function clusterStories(items: Clusterable[]): Cluster[] {
  const clusters: Cluster[] = [];
  const assigned = new Map<string, number>();

  items.forEach((item) => {
    const text = `${item.title} ${item.snippet}`;

    const match = clusters.findIndex((c) =>
      c.memberIds.some((mid) => {
        const other = items.find((i) => i.id === mid)!;
        return similarity(text, `${other.title} ${other.snippet}`) >= SAME_STORY_THRESHOLD;
      })
    );

    if (match >= 0) {
      clusters[match].memberIds.push(item.id);
      assigned.set(item.id, match);
    } else {
      clusters.push({
        id: `cluster-${clusters.length + 1}`,
        memberIds: [item.id],
        primaryId: item.id,
        syndicatedIds: [],
        independentSources: 1,
      });
      assigned.set(item.id, clusters.length - 1);
    }
  });

  for (const c of clusters) {
    const members = c.memberIds.map((id) => items.find((i) => i.id === id)!);

    // The earliest account is the primary; a reprint cannot predate its source.
    const dated = members.filter((m) => m.publishedAt);
    c.primaryId = dated.length
      ? dated.reduce((a, b) => (Date.parse(a.publishedAt!) <= Date.parse(b.publishedAt!) ? a : b)).id
      : members[0].id;

    const primary = members.find((m) => m.id === c.primaryId)!;
    const primaryText = `${primary.title} ${primary.snippet}`;

    c.syndicatedIds = members
      .filter(
        (m) =>
          m.id !== c.primaryId &&
          similarity(primaryText, `${m.title} ${m.snippet}`) >= NEAR_IDENTICAL_THRESHOLD
      )
      .map((m) => m.id);

    const independent = members.filter((m) => !c.syndicatedIds.includes(m.id));
    c.independentSources = new Set(independent.map((m) => m.domain)).size;
  }

  return clusters;
}
