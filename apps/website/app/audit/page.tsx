import AuditClient from './AuditClient';
import { INDEXABLE } from '../../src/seo.ts';

export const metadata = {
  title: 'Run a self-audit | Reputation Platform',
  description:
    'Enter your name and what distinguishes you from people who share it. The audit reports what ranks, what each result is based on, and how sure we are it is about you.',
  alternates: { canonical: '/audit' },

  /**
   * Follows the launch flag rather than hard-coding `false`.
   *
   * It used to be fixed closed, which was right while nothing was live and
   * wrong the moment it was: `sitemap.ts` lists this page, so a permanent
   * `noindex` here would have shipped a sitemap inviting a crawler to a
   * page that tells it to go away. Contradicting yourself in two files is
   * worse than being closed in both.
   */
  robots: INDEXABLE
    ? { index: true, follow: true }
    : { index: false, follow: false },
};

export default function AuditPage() {
  return <AuditClient />;
}
