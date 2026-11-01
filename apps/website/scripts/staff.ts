/**
 * Reviewer accounts, created from the server shell and nowhere else.
 *
 *   npm run staff -- list
 *   npm run staff -- add ops@example.com reviewer
 *   npm run staff -- disable staff_abc123
 *
 * There is no web route that does this on purpose. The review queue is the
 * only thing in the product that reads across accounts, so the ability to
 * grant that has to sit behind access to the machine rather than behind a
 * password somebody could phish. Disabling someone revokes their live
 * sessions in the same transaction.
 */
import { open, ReviewRepository, StaffAuthRepository } from '@rep/persistence';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const location = resolve(
  process.env.REP_DB_PATH ?? resolve(process.cwd(), '.data', 'rep.db')
);
mkdirSync(dirname(location), { recursive: true });

const db = open({ location });
const review = new ReviewRepository(db);
const staffAuth = new StaffAuthRepository(db);

const [command, ...args] = process.argv.slice(2);

const usage = () => {
  console.log(
    'Usage:\n' +
      '  npm run staff -- list\n' +
      '  npm run staff -- add <email> [reviewer|admin]\n' +
      '  npm run staff -- disable <staffId>\n'
  );
};

switch (command) {
  case 'list': {
    const rows = db
      .prepare('SELECT id, email, role, created_at, disabled_at FROM staff ORDER BY created_at')
      .all() as Array<Record<string, string | null>>;

    if (rows.length === 0) {
      console.log('No staff. Nobody can open the review queue.');
      break;
    }

    for (const r of rows) {
      const live = staffAuth.sessions(String(r.id)).length;
      console.log(
        `${r.id}  ${r.email}  ${r.role}` +
          (r.disabled_at ? `  DISABLED ${r.disabled_at}` : `  ${live} live session(s)`)
      );
    }
    break;
  }

  case 'add': {
    const [email, role = 'reviewer'] = args;
    if (!email || (role !== 'reviewer' && role !== 'admin')) {
      usage();
      process.exit(1);
    }

    const created = review.createStaff(email, role);
    console.log(`Added ${created.email} as ${created.role}.`);
    console.log(`  id: ${created.id}`);
    console.log(
      '\nThey sign in at /review with their address. No password, and no\n' +
        'sign-up: a code is only ever issued against this row.'
    );
    break;
  }

  case 'disable': {
    const [id] = args;
    if (!id) {
      usage();
      process.exit(1);
    }

    review.disableStaff(id);
    console.log(`Disabled ${id}. Any session they held is revoked.`);
    break;
  }

  default:
    usage();
    process.exit(command ? 1 : 0);
}
