/**
 * What the review screen must not make easy.
 *
 * The first fulfillment rehearsal put a clean board certification in front
 * of a reviewer, classified as a severity-3 disciplinary finding because the
 * classifier had read a negation as the thing it negated. The screen offered
 * "Uphold" first, and had it already selected — so the cheapest possible
 * action, the one a tired reviewer reaches by pressing the button without
 * touching anything, was to confirm a false allegation about a doctor.
 *
 * The engine change (detection no longer confirms) is the real fix. This is
 * the other half: upholding is now the act that creates a finding about a
 * person, so it must be the most deliberate thing on the page rather than
 * the default one.
 *
 * Source assertions rather than a rendered DOM, for the same reason
 * `print.test.ts` works this way: there is no renderer in this workspace,
 * and the properties worth holding are visible in the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, '..', 'app', 'review', 'ReviewClient.tsx'), 'utf8');

test('no outcome is preselected', () => {
  assert.match(
    client,
    /useState<Outcome \| null>\(null\)/,
    'the decision starts on a value, so "I did not choose" and "I chose this" arrive identical'
  );

  assert.doesNotMatch(
    client,
    /useState<Outcome>\('uphold'\)/,
    'uphold is preselected again'
  );
});

test('the form cannot be submitted without a decision', () => {
  // A rationale alone is not a decision, and a disabled button is the only
  // thing standing between "typed something" and "recorded something".
  assert.match(
    client,
    /disabled=\{busy \|\| outcome === null/,
    'the record button does not require an outcome to have been chosen'
  );
});

test('uphold is not the first thing offered', () => {
  const order = [...client.matchAll(/value: '(uphold|downgrade_to_allegation|reject_not_this_person|reject_not_harm)'/g)].map(
    (m) => m[1]
  );

  assert.ok(order.length === 4, `expected four outcomes, found ${order.length}`);
  assert.notEqual(order[0], 'uphold', 'the most consequential answer is the first one offered');
  assert.equal(
    order[order.length - 1],
    'uphold',
    'the ordering should run from what costs the customer nothing to what costs them most'
  );
});

test('upholding says what it does to the customer', () => {
  // "The classification is right. It stands as written" describes a
  // bookkeeping operation. It is in fact the moment a person is told
  // something about themselves is settled, and the words should say so.
  const help = /value: 'uphold',[\s\S]{0,300}?help: '([^']+)'/.exec(client);

  assert.ok(help, 'the uphold option has no help text');
  assert.match(
    help![1]!,
    /read the source|established|told/i,
    `"${help![1]}" does not tell the reviewer what upholding does`
  );
});
