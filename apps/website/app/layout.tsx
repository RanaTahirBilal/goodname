import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { INDEXABLE, ORIGIN } from '../src/seo.ts';
import './globals.css';

/**
 * The type pairing, self-hosted.
 *
 * `next/font` downloads these at build time and serves them from our own
 * origin, so no request leaves the page at runtime and there is no flash of
 * a fallback face. Before this existed the serif was whatever Palatino the
 * reader's machine happened to have, which is why the same page looked
 * considered on a Mac and ordinary everywhere else.
 *
 * Fraunces carries real optical sizing, so a 150px figure is drawn with a
 * finer cut and tighter spacing than a 20px standfirst rather than being the
 * same letterforms scaled up. That difference is most of what "set" rather
 * than "sized" means, and on this product the single largest thing on the
 * page is a two-digit number, which is the hardest case for a face that
 * cannot do it.
 *
 * It replaced Newsreader when the briefing direction was chosen. Newsreader
 * is the better reading face and Fraunces is the better display one; the
 * report leads with a figure at 150px, so the display job won. There are
 * still two faces, not three.
 */
const serif = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
  // Variable weight, so the 150px figure can sit at 300 while a heading
  // holds 500 without loading a second file for each.
  weight: 'variable',
});

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const BRAND = 'Reputation Platform';

const TITLE = 'Reputation Platform: see what they find when they search your name';
const DESCRIPTION =
  'An evidence-backed audit of your professional online presence. See what ranks for your name, what it is based on, and what is worth doing about it.';

export const metadata: Metadata = {
  // Internal name only. Branding is a single value so the commercial name is
  // a one-line change. See docs/PRODUCT_DECISIONS.md PD-006.
  title: TITLE,
  description: DESCRIPTION,

  /**
   * Canonicals, which need an origin to exist at all.
   *
   * Without `metadataBase` Next emits relative canonical hrefs, which is
   * the same as having none. The origin comes from configuration because
   * the site does not have a domain yet, and defaults to localhost so a
   * development build produces something inspectable rather than nothing.
   */
  metadataBase: new URL(ORIGIN),
  alternates: { canonical: '/' },

  /**
   * Indexing is a runtime condition, not a constant somebody must remember
   * to flip. It defaults closed: see `src/seo.ts`.
   */
  robots: INDEXABLE
    ? { index: true, follow: true }
    : { index: false, follow: false },

  /**
   * What a link to this looks like when somebody pastes it.
   *
   * No image is declared, deliberately. An OG card is a claim about the
   * product, and the only honest image available today would be a
   * screenshot of a report built from fixture data — which is precisely
   * the thing that must never circulate looking like a real result.
   */
  openGraph: {
    type: 'website',
    siteName: BRAND,
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
  },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        {/**
         * Structured data, kept to what is true.
         *
         * Two nodes and no more. There is no `address`, because there is no
         * office; no `aggregateRating`, because nobody has rated anything;
         * no `sameAs`, because the profiles it would point at do not exist;
         * no `FAQPage`, which is the one people reach for and the one that
         * breaks Google's rules the moment its questions are not also
         * readable on the page.
         *
         * `WebSite` with a `SearchAction` is deliberately absent too: this
         * site has no site-search, and declaring one is a request for a
         * search box in the result that leads nowhere.
         *
         * Served whatever the launch flag says. It costs a few hundred
         * bytes, it is inert when nothing is indexed, and the failure it
         * prevents — shipping with the markup still missing — is the one
         * that only shows up after launch.
         */}
        <script
          type="application/ld+json"
          // The content is a literal built here, not anything a customer
          // supplied, so there is nothing to escape beyond JSON itself.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'WebSite',
                  '@id': `${ORIGIN}/#website`,
                  url: `${ORIGIN}/`,
                  name: BRAND,
                  description: DESCRIPTION,
                  inLanguage: 'en',
                  publisher: { '@id': `${ORIGIN}/#organization` },
                },
                {
                  '@type': 'Organization',
                  '@id': `${ORIGIN}/#organization`,
                  name: BRAND,
                  url: `${ORIGIN}/`,
                  description:
                    'Audits a professional’s own online presence: what ranks for their name, what each result is based on, and how confident the assessment is that it is about them.',
                },
              ],
            }),
          }}
        />
        {/**
         * Sticky, because the report is long.
         *
         * Solid rather than translucent: a blurred bar over scrolling text
         * is the one decoration this product keeps turning down, and a
         * backdrop filter over an evidence table makes the row underneath
         * it unreadable at exactly the moment someone is reading it.
         */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div
            className="wrap row"
            style={{ height: 68, justifyContent: 'space-between' }}
          >
            <a href="/" className="wordmark row" style={{ gap: 'var(--s-3)' }}>
              {/* A mark, not a logo: the same rule that opens every section. */}
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 2,
                  background: 'var(--primary)',
                  flex: '0 0 auto',
                }}
              />
              {BRAND}
            </a>
            <nav className="row" style={{ gap: 'var(--s-6)' }}>
              <a href="/audit" className="small nav-compact" style={{ fontWeight: 600 }}>
                Check My Reputation
              </a>
              <a href="/signin" className="small" style={{ fontWeight: 600 }}>
                Sign in
              </a>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer
          style={{
            marginTop: 'var(--s-24)',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div
            className="wrap stack"
            style={{ padding: 'var(--s-8) var(--s-6)', ['--gap' as string]: 'var(--s-4)' }}
          >
            <p className="small" style={{ maxWidth: '62ch' }}>
              This product measures the professional online presence we can observe at a
              point in time. It does not measure character, honesty or competence, and it
              does not promise search rankings, content removal or score increases.
            </p>

            {/**
             * In the footer rather than the header.
             *
             * Export and deletion are not things anyone needs mid-task, and
             * putting "delete my account" next to "Check My Reputation"
             * would be an odd pair of choices to offer at once. The footer
             * is where people look for this, and it is on every page.
             */}
            <p className="small">
              <a href="/account" style={{ fontWeight: 600 }}>
                Your data
              </a>{' '}
              : download everything we hold, or have it deleted.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
