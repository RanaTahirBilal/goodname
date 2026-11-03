/**
 * Special-category material must not reach the database.
 *
 * The domain engine drops the title and excerpt of a withheld record before
 * the record exists, so in principle there is nothing here to get wrong. In
 * principle is not a guarantee: the insert is a long positional statement
 * and the obvious "improvement" to it is to keep the original text in a
 * spare column, just in case somebody wants it later. That spare column is
 * the entire thing this is built to prevent.
 *
 * So these tests search the raw SQLite file for the words themselves, the
 * same way `auth.test.ts` asserts a sign-in code never appears in a row.
 * A check that reads through the repository would only prove the repository
 * agrees with itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './db.ts';
import { ScanRepository, type AccountScope } from './repository.ts';
import {
  runAudit,
  FixtureSearchProvider,
  SELF_AUDIT_ATTESTATION,
  type AuditPurpose,
  type ProfessionalIdentity,
} from '@rep/domain';

const PURPOSE: AuditPurpose = {
  kind: 'self_audit',
  attestationText: SELF_AUDIT_ATTESTATION,
  attestedAt: '2026-11-03T00:00:00.000Z',
  verification: 'verified_email',
};

const ADONI: ProfessionalIdentity = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  region: 'Illinois',
  websiteUrl: 'https://adoni-law.example',
};

/** The words the `sensitive` fixture puts in front of the filter. */
const SENSITIVE_WORDS = [
  'diagnosed with cancer',
  'converted to islam',
  'mosque',
  'democratic party campaign',
];

async function seed() {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const account = repo.createAccount('jensen@example.test');
  const scope: AccountScope = { accountId: account.id, actor: 'customer' };

  const report = await runAudit({
    identity: ADONI,
    purpose: PURPOSE,
    provider: new FixtureSearchProvider('sensitive'),
  });
  if (report.status !== 'complete') throw new Error('expected a complete report');

  const scanId = repo.saveScan(scope, {
    identity: ADONI,
    status: 'complete',
    provider: report.scan.provider,
    isFixture: report.scan.isFixture,
    window: report.scan.window,
    queries: report.scan.queries,
    purpose: PURPOSE,
    requesterId: 'test',
    evidence: report.evidence,
  });

  repo.savePresence(scope, scanId, report.presence, 'initial scan');
  repo.saveRisk(scope, scanId, report.risk, 'initial scan');

  return { db, repo, scope, scanId, report };
}

/** Every text value in the database, whatever table or column it sits in. */
function allStoredText(db: ReturnType<typeof open>): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => String((r as { name: string }).name));

  let text = '';
  for (const table of tables) {
    for (const row of db.prepare(`SELECT * FROM "${table}"`).all()) {
      text += JSON.stringify(row) + '\n';
    }
  }
  return text.toLowerCase();
}

test('the withheld text appears nowhere in the database', async () => {
  const { db } = await seed();
  const stored = allStoredText(db);

  for (const word of SENSITIVE_WORDS) {
    assert.ok(
      !stored.includes(word),
      `"${word}" was stored somewhere; special-category text must never be written`
    );
  }
});

test('what is stored instead is enough to point at the source', async () => {
  const { repo, scope, scanId } = await seed();
  const scan = repo.getScan(scope, scanId)!;

  const withheld = scan.evidence.filter((e) => e.sensitivity?.withhold);
  assert.ok(withheld.length >= 3, 'expected the health, religion and politics rows');

  for (const record of withheld) {
    assert.ok(record.sourceUrl.startsWith('https://'), 'the link has to survive');
    assert.ok(record.sourceName.length > 0);
    assert.ok(record.sensitivity!.categories.length > 0);
  }
});

test('the assessment survives a round trip through SQLite', async () => {
  const { repo, scope, scanId, report } = await seed();
  const reread = repo.getScan(scope, scanId)!;

  for (const original of report.evidence) {
    const stored = reread.evidence.find((e) => e.id === original.id)!;
    assert.deepEqual(
      stored.sensitivity,
      original.sensitivity,
      `${original.id}: the assessment changed in storage`
    );
  }
});

/**
 * The distinction the migration's nullable columns exist to keep.
 *
 * A row written before migration 7 was never assessed, which is not the same
 * as assessed and clean. Collapsing the two would let a report state that a
 * record holds nothing sensitive on the strength of a check that never ran.
 */
test('never assessed reads back as undefined, not as clean', async () => {
  const { db, repo, scope, scanId } = await seed();

  db.prepare(
    `UPDATE evidence
        SET sensitivity_withheld = NULL,
            sensitivity_categories = NULL,
            sensitivity_signals = NULL
      WHERE scan_id = ?`
  ).run(scanId);

  const scan = repo.getScan(scope, scanId)!;
  for (const record of scan.evidence) {
    assert.equal(record.sensitivity, undefined);
  }
});

/**
 * Deleting an account has to take the assessment with it.
 *
 * The categories are not the excerpt, but "this person's results touched on
 * health and religion" is itself personal data about them. It goes when the
 * rest of their evidence goes, and it goes because `evidence` is in
 * ACCOUNT_OWNED_TABLES rather than because anyone remembered this column.
 */
test('deleting the account removes the assessment with the evidence', async () => {
  const { repo, scope } = await seed();

  repo.deleteAccount(scope);

  const after = repo.listScans(scope);
  assert.equal(after.length, 0);
});
