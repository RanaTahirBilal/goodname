/**
 * /report/[id] — a report somebody can come back to.
 *
 * The first fulfillment rehearsal found that a finished report existed only
 * in the browser tab that produced it. No URL, no history, no link from the
 * account page — which cheerfully said "Audits stored: 1" and offered a JSON
 * download. The data was all there and the API route would rebuild it; the
 * customer was simply never given the id. Close the tab and the deliverable
 * was gone, with a live search provider and a paying customer or without.
 *
 * Two things this is not.
 *
 * It is not a share link. The id is not a capability: the account comes from
 * the session cookie, every repository read is scoped to it, and a scan id
 * belonging to somebody else returns exactly what a scan id belonging to
 * nobody returns. Possession of the URL grants nothing.
 *
 * It is not a stored report. The page is rebuilt from evidence on every
 * visit, so a customer's "this is not me" is reflected the moment they make
 * it (rule 16d). What a durable route adds is the obligation to notice when
 * the rebuild no longer matches what the customer was last shown — which is
 * handled in the API route, and surfaced here.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import ReportPage from './ReportPage.tsx';

export const metadata: Metadata = {
  title: 'Your report',
  // A report about an identifiable person has no business in an index.
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="wrap">
      <p className="small no-print" style={{ marginBottom: 'var(--s-4)' }}>
        <Link href="/account">← Your data</Link>
      </p>
      <ReportPage scanId={id} />
    </main>
  );
}
