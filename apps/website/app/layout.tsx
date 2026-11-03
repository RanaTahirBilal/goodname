import type { Metadata } from 'next';
import { Newsreader, Inter } from 'next/font/google';
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
 * Newsreader carries real optical sizing, so a 68px headline is drawn with a
 * finer cut than a 20px standfirst rather than being the same letterforms
 * scaled up. That difference is most of what "set" rather than "sized" means.
 */
const serif = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-serif',
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
});

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  // Internal name only. Branding is a single value so the commercial name is
  // a one-line change. See docs/PRODUCT_DECISIONS.md PD-006.
  title: 'Reputation Platform — understand what people find when they search for you',
  description:
    'An evidence-backed audit of your professional online presence. See what ranks for your name, what it is based on, and what is worth doing about it.',
  robots: { index: false, follow: false },
};

export const BRAND = 'Reputation Platform';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <header
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div
            className="wrap row"
            style={{ height: 68, justifyContent: 'space-between' }}
          >
            <a href="/" className="wordmark">
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
              — download everything we hold, or have it deleted.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
