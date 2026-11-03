/**
 * GET /api/account/export — everything we hold about this account, as a file.
 *
 * Synchronous, and a download rather than an email. `api-contract.md` has
 * this queued and notified by mail, which is right once there is a mail
 * provider and wrong today: OQ-14 means no message can actually be
 * delivered, so a queued export would be a request that silently goes
 * nowhere. A file the browser saves needs nothing we do not have.
 *
 * The scope comes from the session cookie. There is no account id in the
 * URL, so this cannot be pointed at anybody else's data — `exportAccount`
 * has no unscoped form to reach for.
 */
import { NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { currentScope } from '../../../../src/server/session.ts';

export async function GET() {
  const scope = await currentScope();
  if (!scope) {
    return NextResponse.json({ error: 'No session.' }, { status: 401 });
  }

  const data = store().repo.exportAccount(scope);

  /**
   * A dated filename, because people keep these.
   *
   * An export is the thing somebody downloads before deleting their
   * account. Three of them in a Downloads folder all called "export.json"
   * is a worse answer than it looks.
   */
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="reputation-export-${stamp}.json"`,
      // Never let an intermediary keep a copy of somebody's whole account.
      'cache-control': 'no-store, private',
    },
  });
}
