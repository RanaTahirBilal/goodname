import type { MetadataRoute } from 'next';
import { canonical, PUBLIC_PATHS } from '../src/seo.ts';

/**
 * The sitemap, which is two URLs and should stay honest about that.
 *
 * `lastModified` is the build time rather than a hard-coded date. The skill
 * this follows names a stale `lastmod` as the most commonly forgotten step:
 * a date that never moves tells a crawler nothing changed, so a page that
 * was improved sits unread. Tying it to the build means it moves whenever
 * the site is actually redeployed, and never otherwise.
 *
 * Only public pages. The audit form is here because it is the page somebody
 * would reasonably land on; `/review`, `/account` and `/signin` are not,
 * and `robots.ts` disallows them as well, because a sitemap that lists a
 * page is an invitation to crawl it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_PATHS.map((path) => ({
    url: canonical(path),
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: path === '/' ? 1 : 0.8,
  }));
}
