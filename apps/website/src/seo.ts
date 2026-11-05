/**
 * Where the site lives, and whether it may be indexed yet.
 *
 * Both are runtime conditions rather than comments asking someone to
 * remember, which is the same rule the development outbox follows: an
 * affordance that would be wrong in production fails closed on a condition,
 * not on a note in a file.
 *
 * `indexable` defaults to **false**. A product with no live search provider,
 * a known identity-attribution defect and fixture data behind every number
 * should not be collecting impressions for anybody's name — least of all a
 * product whose whole subject is what shows up when somebody is looked up.
 * Launch is then a configuration change rather than a code change, and
 * nobody has to find the line that says `index: false`.
 */

/** The origin the canonical URLs are built from. */
export const ORIGIN = (
  process.env.REP_PUBLIC_ORIGIN ?? 'http://localhost:4300'
).replace(/\/$/, '');

/**
 * True only when a deployment has explicitly said so.
 *
 * Any value other than the exact string `true` leaves the site closed —
 * including `1`, `yes`, and an empty variable that merely exists, each of
 * which is the kind of thing that gets set by accident.
 */
export const INDEXABLE = process.env.REP_INDEXABLE === 'true';

/**
 * Paths that stay out of the index whatever the launch flag says.
 *
 * `/review` is the staff queue: it reads flagged evidence across accounts,
 * and a crawler finding the sign-in page for it is an invitation. `/account`
 * and `/signin` are per-customer and have nothing to rank for. `/api` is not
 * a page.
 */
export const PRIVATE_PATHS = ['/api/', '/review', '/account', '/signin', '/report'];

/** The public pages, in the order a reader would meet them. */
export const PUBLIC_PATHS = ['/', '/audit'];

/**
 * Crawlers named individually because the default is not obvious.
 *
 * Several of these read the open web for assistants rather than for a search
 * index, and a few honour only their own user-agent rather than `*`. Naming
 * them is how a product decides, on purpose, whether it wants to be readable
 * by the assistants its own customers are being described by — which for
 * this product is not an abstract question.
 */
export const ASSISTANT_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-User',
  'Google-Extended',
  'PerplexityBot',
  'CCBot',
];

export const canonical = (path: string): string =>
  `${ORIGIN}${path === '/' ? '' : path}`;
