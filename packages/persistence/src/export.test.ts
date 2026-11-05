/**
 * What a data export says about itself.
 *
 * The export is the copy of a report most likely to be forwarded and the
 * least likely to arrive with any context: a JSON file attached to an
 * email, opened by somebody who never saw the product. Everything the
 * interface says about what the report is for is absent by then.
 *
 * So the limitation is a field in the file rather than a sentence on the
 * page that produced it, which is the same reasoning as `isFixture` being
 * a column and not a banner. These tests hold it there, and hold it to
 * the single definition in the domain so the export and the report cannot
 * drift into saying different things about the same document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMITTED_USE } from '@rep/domain';
import { open } from './db.ts';
import { ScanRepository, type AccountScope } from './repository.ts';

function setup() {
  const db = open({ location: ':memory:' });
  const repo = new ScanRepository(db);
  const account = repo.createAccount('jensen@example.test');
  const scope: AccountScope = { accountId: account.id, actor: 'customer' };
  return { db, repo, account, scope };
}

test('an export states what it may not be used for', () => {
  const { repo, scope } = setup();

  const data = repo.exportAccount(scope);

  assert.equal(
    data.permittedUse,
    PERMITTED_USE,
    'the export does not carry the permitted-use statement, or carries its own copy of it'
  );
});

test('the statement names the decisions this is not for', () => {
  // Naming them matters more than the general disclaimer: "not a
  // background check" is a category somebody can argue about, and
  // "employment, credit, housing" is a list they cannot.
  for (const use of ['employment', 'credit', 'housing', 'tenancy', 'insurance']) {
    assert.match(
      PERMITTED_USE.toLowerCase(),
      new RegExp(use),
      `the statement does not mention ${use}`
    );
  }

  assert.match(PERMITTED_USE.toLowerCase(), /background check|consumer report|screening/);
});

test('it comes first, before anything about the person', () => {
  const { repo, scope } = setup();

  const keys = Object.keys(repo.exportAccount(scope));

  assert.equal(
    keys[0],
    'permittedUse',
    'the limitation is buried below the data it qualifies'
  );
});

test('an export of an empty account still carries it', () => {
  // The case somebody would skip: nothing to export, so nothing to
  // qualify. The file is still a document with a name on it.
  const { repo, scope } = setup();

  const data = repo.exportAccount(scope);

  assert.ok(data.permittedUse, 'an export with no scans dropped the statement');
});
