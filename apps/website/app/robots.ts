import type { MetadataRoute } from 'next';
import {
  ASSISTANT_CRAWLERS,
  INDEXABLE,
  ORIGIN,
  PRIVATE_PATHS,
} from '../src/seo.ts';

/**
 * robots.txt, generated rather than kept as a static file.
 *
 * A static one would carry the launch decision in a file nobody re-reads;
 * this one is wrong the moment `REP_INDEXABLE` is wrong, which is a single
 * place to be right.
 *
 * Until the site is launched it disallows everything, for every agent. That
 * is deliberate belt-and-braces beside the `noindex` header: `noindex` asks
 * a crawler not to *list* a page it has already fetched, and this asks it
 * not to fetch. Neither is enforcement, and both are worth sending while
 * every number on the site comes from fixture data.
 *
 * After launch the assistant crawlers are named individually, because
 * several honour their own user-agent and ignore `*`. That is a decision
 * this product has to take on purpose: it exists to tell professionals how
 * assistants describe them, so being unreadable to those same assistants
 * would be an odd thing to do by accident.
 */
export default function robots(): MetadataRoute.Robots {
  if (!INDEXABLE) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
    };
  }

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      ...ASSISTANT_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: `${ORIGIN}/sitemap.xml`,
    host: ORIGIN,
  };
}
