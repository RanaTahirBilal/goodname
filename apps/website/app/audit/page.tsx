import AuditClient from './AuditClient';

export const metadata = {
  title: 'Run a self-audit — Reputation Platform',
  robots: { index: false, follow: false },
};

export default function AuditPage() {
  return <AuditClient />;
}
