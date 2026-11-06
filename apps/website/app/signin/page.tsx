import SignInClient from './SignInClient';

export const metadata = {
  title: 'Sign in | Reputation Platform',
  /**
   * Never indexed, whatever the launch flag says.
   *
   * There is nothing here to rank for: this page is per-customer, or in
   * the case of the review queue, staff-only. `robots.ts` disallows the
   * path as well, because a header asks a crawler not to list a page it
   * has already fetched and the disallow asks it not to fetch.
   */
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return <SignInClient />;
}
