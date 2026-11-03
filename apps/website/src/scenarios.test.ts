/**
 * The demonstration scenarios the app offers must be the ones the engine has.
 *
 * This exists because of a specific failure, not a hypothetical one. The
 * audit route kept its own hand-typed copy of the scenario names and, on a
 * name it did not recognise, quietly fell back to `strong`. When `sensitive`
 * was added to the engine, the route served a complete, confident report of
 * an entirely different scenario and nothing anywhere said so.
 *
 * The route now takes the list from the engine, so the drift cannot recur
 * there. The dropdown is still written by hand — it needs a human-readable
 * label per scenario, and there is nowhere sensible to derive prose from —
 * so this is what holds it honest.
 *
 * Reading the source files rather than importing the component keeps a
 * DOM-free test honest about what actually ships.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FIXTURE_SCENARIOS } from '@rep/domain';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, '..', ...parts), 'utf8');

/** The `['name', 'Label']` pairs out of the audit form's scenario list. */
function offeredScenarios(): string[] {
  const source = read('app', 'audit', 'AuditClient.tsx');
  const block = /const SCENARIOS[\s\S]*?\n\](?: as const)?;/.exec(source);
  assert.ok(block, 'could not find the scenario list in AuditClient.tsx');

  return [...block[0].matchAll(/\[\s*'([a-z_]+)'\s*,/g)].map((m) => m[1]);
}

test('every engine scenario is offered in the audit form', () => {
  const offered = new Set(offeredScenarios());

  for (const scenario of FIXTURE_SCENARIOS) {
    assert.ok(
      offered.has(scenario),
      `the engine has "${scenario}" and the form does not offer it`
    );
  }
});

test('the form offers nothing the engine cannot run', () => {
  const known = new Set<string>(FIXTURE_SCENARIOS);

  for (const scenario of offeredScenarios()) {
    assert.ok(
      known.has(scenario),
      `the form offers "${scenario}" and the engine has no such scenario`
    );
  }
});

/**
 * The fallback itself.
 *
 * Defaulting to `strong` on an unknown name is the right behaviour for a
 * hostile request — it is a demonstration control, and refusing would be
 * noisier than it is worth. It was only dangerous because the list it
 * checked against was wrong. Asserting that the route reads the engine's
 * list is what makes the fallback safe to keep.
 */
test('the audit route takes its scenario list from the engine', () => {
  const route = read('app', 'api', 'audit', 'route.ts');

  assert.match(
    route,
    /const SCENARIOS[^=]*=\s*FIXTURE_SCENARIOS/,
    'the route has gone back to keeping its own copy of the scenario names'
  );
});
