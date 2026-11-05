/**
 * GET /api/account — what this account is, and whether it is on its way out.
 *
 * The page that offers export and deletion needs to know three things before
 * it can say anything true: whether there is a session, whether the address
 * is verified, and whether a deletion is already pending. Asking for them
 * separately would let the page render a "Delete" button for a quarter of a
 * second on an account that is already scheduled.
 */
import { NextResponse } from 'next/server';
import { store } from '../../../src/server/db.ts';
import { currentScope } from '../../../src/server/session.ts';

export async function GET() {
  const scope = await currentScope();
  if (!scope) return NextResponse.json({ signedIn: false }, { status: 200 });

  const { repo } = store();

  return NextResponse.json(
    {
      signedIn: true,
      verified: scope.verified,
      // An anonymous account has an opaque identifier, not an address.
      email: scope.verified ? scope.email : null,
      scans: repo.listScans(scope).length,
      /**
       * The reports themselves, not just how many there are.
       *
       * This page used to say "Audits stored: 1" and give no way to open it.
       * The data was there, the API would rebuild it, and the id — the only
       * thing a customer needed — was never handed over. A count of
       * deliverables you cannot reach is a worse answer than no count.
       */
      reports: repo.listScans(scope).map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        status: s.status,
        isFixture: s.isFixture,
        evidenceExpiredAt: s.evidenceExpiredAt ?? null,
      })),
      pendingDeletion: repo.deletionStatus(scope),
    },
    { status: 200 }
  );
}
