/**
 * The health endpoint has to fail when the thing that fails silently fails.
 *
 * A port check tells you the web server is up, which you already knew
 * because the request arrived. The two things that break while a process
 * looks entirely fine are the database and the background worker, and the
 * worker is the dangerous one: if it is not running, audits queue for ever
 * and nothing ages out or gets purged, while every page answers normally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(join(here, '..', 'app', 'api', 'health', 'route.ts'), 'utf8');
const worker = readFileSync(join(here, 'server', 'worker.ts'), 'utf8');

test('a dead worker makes the service unhealthy', () => {
  assert.match(route, /workerState\(\)/, 'the worker is not checked at all');
  assert.match(route, /ok = false;[\s\S]{0,200}not started/, 'a dead worker still reports healthy');
  assert.match(route, /status: ok \? 200 : 503/, 'a failed check does not change the status code');
});

test('it asks the worker whether it started, not whether it is busy', () => {
  /**
   * `running` is true only while a job is in flight, which is a fraction of
   * any second. Checking it would report an idle worker as broken and a
   * broken one as fine for the instant it happened to be busy.
   */
  assert.match(route, /worker\.started/, 'the check reads the wrong field');
  assert.doesNotMatch(route, /if \(worker\.running\)/, 'the check is reading the busy flag');

  assert.match(worker, /started: Boolean\(w\)/, 'workerState no longer reports whether it started');
});

test('the database check runs a query rather than opening a file', () => {
  // `open()` succeeds against a file it cannot read from, so the useful
  // question is whether a statement runs and the migrations are applied.
  assert.match(route, /schema_migrations/, 'the check does not verify the schema');
  assert.match(route, /MIGRATIONS\[MIGRATIONS\.length - 1\]/, 'nothing compares against the expected version');
});

test('it reveals nothing about who uses the service', () => {
  /**
   * Reachable without a session. Whether a live provider is configured and
   * which schema version is deployed are facts about the deployment; how
   * many accounts or scans exist is not something to hand to anybody who
   * can reach the port.
   */
  // Comments stripped first: the paragraph at the top of that file
  // explains which counts are deliberately absent, and matching on it
  // would fail the test for saying the right thing.
  const code = route
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1 ');

  for (const leak of ['accounts', 'COUNT(*)', 'scans', 'evidence', 'email']) {
    assert.ok(!code.includes(leak), `the health endpoint exposes ${leak}`);
  }
});
