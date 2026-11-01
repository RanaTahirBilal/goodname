/** GET /api/auth/me — who the current session belongs to, if anyone. */
import { NextResponse } from 'next/server';
import { currentScope } from '../../../../src/server/session.ts';

export async function GET() {
  const scope = await currentScope();
  if (!scope) return NextResponse.json({ signedIn: false }, { status: 200 });

  return NextResponse.json(
    {
      signedIn: true,
      verified: scope.verified,
      // An anonymous account has an opaque identifier, not an address.
      email: scope.verified ? scope.email : null,
    },
    { status: 200 }
  );
}
