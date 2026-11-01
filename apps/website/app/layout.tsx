import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body>
        <header
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div
            className="wrap row"
            style={{ height: 64, justifyContent: 'space-between' }}
          >
            <a
              href="/"
              style={{
                fontFamily: 'var(--serif)',
                fontSize: '1.0625rem',
                fontWeight: 600,
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              {BRAND}
            </a>
            <nav className="row" style={{ gap: 20 }}>
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
            marginTop: 72,
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div className="wrap" style={{ padding: '28px 24px' }}>
            <p className="small" style={{ maxWidth: 680 }}>
              This product measures the professional online presence we can observe at a
              point in time. It does not measure character, honesty or competence, and it
              does not promise search rankings, content removal or score increases.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
