/**
 * A number that moves on its own.
 *
 * The report is rebuilt from evidence on every read, which is right while a
 * scan is live: a customer answering "this is not me" has to change the
 * score immediately, and a stored report would be stale the moment they did.
 *
 * A durable report route exposes the other half of that choice. Reopen an
 * audit from six months ago after the scoring engine has changed, and the
 * page shows a different number under the original date — no new evidence,
 * no decision by anybody, and nothing on the page admitting it. For a
 * product that assesses somebody's professional reputation, that is not a
 * refinement. It is a different claim wearing the same timestamp.
 *
 * These tests hold the rule: recomputation stays, and divergence becomes an
 * event in an append-only history rather than a silent substitution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PresenceScore, RiskAssessment } from '@rep/domain';
import { reconcileAssessment } from './report.ts';
import type { AccountScope } from './repository.ts';

const SCOPE: AccountScope = { accountId: 'acct_1', actor: 'customer' };

type Row = {
  score: number | null;
  coverage: number;
  methodologyVersion: string;
  computedAt: string;
  reason: string;
};

/** A repository stub, so the test is about the rule and not about SQL. */
function fakeRepo(history: Row[]) {
  const saved: Array<{ kind: string; reason: string }> = [];
  return {
    saved,
    presenceHistory: () => history,
    savePresence: (_s: AccountScope, _i: string, _p: PresenceScore, reason: string) =>
      void saved.push({ kind: 'presence', reason }),
    saveRisk: (_s: AccountScope, _i: string, _r: RiskAssessment, reason: string) =>
      void saved.push({ kind: 'risk', reason }),
  };
}

const presence = (score: number, version = '3.0.0-provisional'): PresenceScore =>
  ({ status: 'scored', score, coverage: 1, methodologyVersion: version } as PresenceScore);

const risk = { level: 'none' } as RiskAssessment;

const row = (over: Partial<Row> = {}): Row => ({
  score: 61,
  coverage: 1,
  methodologyVersion: '3.0.0-provisional',
  computedAt: '2026-05-01T00:00:00.000Z',
  reason: 'initial scan',
  ...over,
});

test('nothing happens when nothing changed', () => {
  // The common case, and it must stay cheap: one read, no write, no notice
  // on the page. A report that announces a reassessment every time it is
  // opened teaches the customer to ignore the word.
  const repo = fakeRepo([row()]);

  const result = reconcileAssessment(repo, SCOPE, 'scan_1', {
    presence: presence(61),
    risk,
  });

  assert.equal(result, null);
  assert.equal(repo.saved.length, 0);
});

test('a methodology change is recorded, not applied quietly', () => {
  const repo = fakeRepo([row({ score: 61, methodologyVersion: '3.0.0-provisional' })]);

  const result = reconcileAssessment(repo, SCOPE, 'scan_1', {
    presence: presence(68, '3.1.0'),
    risk,
  });

  assert.ok(result, 'the engine changed under an old report and nothing was recorded');
  assert.equal(result!.from, '3.0.0-provisional');
  assert.equal(result!.to, '3.1.0');
  assert.equal(result!.previousScore, 61);
  assert.equal(result!.currentScore, 68);
  assert.match(result!.reason, /methodology/, 'the reason does not name what actually changed');
});

test('both snapshots are written, so the two outputs cannot drift apart', () => {
  // Presence and risk are assessed by different engines with different
  // versions. Recording one and not the other would leave a history where
  // the score has a story and the risk level does not.
  const repo = fakeRepo([row()]);

  reconcileAssessment(repo, SCOPE, 'scan_1', { presence: presence(70, '3.1.0'), risk });

  assert.deepEqual(
    repo.saved.map((s) => s.kind).sort(),
    ['presence', 'risk']
  );
});

test('the earlier assessment is kept, not overwritten', () => {
  /**
   * Snapshots are append-only (rule 16c) and this is the case that rule was
   * written for. The old number keeps its own date and its own methodology
   * version; the new one is a new row. A customer who printed the report in
   * May can still find what they printed.
   */
  const history = [row({ score: 61, computedAt: '2026-05-01T00:00:00.000Z' })];
  const repo = fakeRepo(history);

  const result = reconcileAssessment(repo, SCOPE, 'scan_1', {
    presence: presence(68, '3.1.0'),
    risk,
  });

  assert.equal(result!.previousAt, '2026-05-01T00:00:00.000Z');
  assert.equal(history[0]!.score, 61, 'the stored history was mutated');
});

test('a score that moves without a version change is still an event', () => {
  /**
   * The case that is easy to miss. A reviewer upholding or rejecting a
   * record changes the customer's report and writes no snapshot of its own,
   * so without this the number moves and the history says the last thing
   * that happened was the initial scan.
   */
  const repo = fakeRepo([row({ score: 61 })]);

  const result = reconcileAssessment(repo, SCOPE, 'scan_1', { presence: presence(55), risk });

  assert.ok(result, 'the score moved and the history does not show it');
  assert.equal(result!.from, result!.to, 'this was not a methodology change');
  assert.match(result!.reason, /recomputed/);
});

test('an unscored report is a change the history can hold', () => {
  // Below 55% coverage the engine declines to score (rule 7). Going from a
  // number to no number is the largest change a report can undergo, and
  // `null` must not read as "unchanged".
  const repo = fakeRepo([row({ score: 61 })]);

  const result = reconcileAssessment(repo, SCOPE, 'scan_1', {
    presence: { status: 'insufficient_evidence', methodologyVersion: '3.0.0-provisional' } as PresenceScore,
    risk,
  });

  assert.ok(result, 'a report that stopped being scoreable recorded nothing');
  assert.equal(result!.currentScore, null);
});

test('a scan with no history is left alone', () => {
  // Nothing to diverge from. The scoring run writes the first row, and
  // inventing one here would put a reassessment on a report that has never
  // been assessed.
  const repo = fakeRepo([]);

  assert.equal(
    reconcileAssessment(repo, SCOPE, 'scan_1', { presence: presence(61), risk }),
    null
  );
  assert.equal(repo.saved.length, 0);
});
