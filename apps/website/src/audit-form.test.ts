/**
 * The one screen where the wrong name is the whole failure.
 *
 * This form used to arrive pre-filled with Jensen Adoni, attorney, Chicago,
 * for whoever was signed in. The first fulfillment rehearsal recorded it as
 * a convenience; the second called it what it is in a real engagement — the
 * product exists to stop somebody being audited who did not ask to be, and
 * the form was supplying a stranger's name by default and waiting for an
 * operator not to notice.
 *
 * Source assertions, like `print.test.ts` and `review-screen.test.ts`:
 * there is no renderer in this workspace, and these properties are visible
 * in the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, '..', 'app', 'audit', 'AuditClient.tsx'), 'utf8');

const defaults = /const DEFAULTS = \{([\s\S]*?)\};/.exec(client)?.[1] ?? '';

test('the form does not arrive describing somebody', () => {
  assert.ok(defaults, 'the defaults block has moved; this test needs rewriting');

  const values = [...defaults.matchAll(/:\s*'([^']*)'/g)].map((m) => m[1]);

  assert.ok(values.length > 0, 'no default values found');
  assert.deepEqual(
    values.filter((v) => v !== ''),
    [],
    'the audit form is pre-filled with a person again'
  );
});

test("no fixture subject's details are hard-coded here", () => {
  /**
   * The subjects live in the engine, which is where the one statement of who
   * they are belongs. A copy in the website is how the form and the results
   * drifted into describing different people the first time.
   */
  for (const name of ['Jensen Adoni', 'Amara Okonkwo', 'Devon Marsh', 'Adoni Law']) {
    assert.ok(!defaults.includes(name), `${name} is hard-coded in the form defaults`);
  }
});

test('choosing a scenario does not overwrite a name somebody typed', () => {
  // A control that changes the subject of an audit without being asked is
  // the same class of mistake as the one this screen exists to avoid.
  assert.match(
    client,
    /if \(form\.fullName\.trim\(\) === ''\) setForm\(formFor\(next\)\)/,
    'the scenario picker overwrites the form unconditionally'
  );
});

test('loading a demonstration subject is a deliberate act', () => {
  assert.match(
    client,
    /onClick=\{\(\) => setForm\(formFor\(scenario\)\)\}/,
    'there is no explicit way to load a fixture subject, so the picker will end up doing it silently'
  );
});

test('the name being audited is shown where it is confirmed', () => {
  // "This audit is about me", ticked above a form the operator has not
  // re-read, confirms nothing. The name belongs next to the box.
  assert.match(
    client,
    /You are about to audit \{form\.fullName/,
    'the attestation does not state whose name is about to be searched'
  );
});
