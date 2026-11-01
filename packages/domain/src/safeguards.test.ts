import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditPurpose } from './contracts/types.ts';
import {
  gate,
  InMemoryAttemptStore,
  requiredVerification,
  SELF_AUDIT_ATTESTATION,
  DEFAULT_POLICY,
} from './safeguards.ts';

const purpose = (over: Partial<AuditPurpose> = {}): AuditPurpose => ({
  kind: 'self_audit',
  attestationText: SELF_AUDIT_ATTESTATION,
  attestedAt: '2026-10-29T00:00:00.000Z',
  verification: 'none',
  ...over,
});

const attempt = (subjectName: string, at: string, p: AuditPurpose = purpose()) => ({
  requesterId: 'req-1',
  subjectName,
  purpose: p,
  at,
});

test('a self-audit with an attestation is allowed', async () => {
  const store = new InMemoryAttemptStore();
  const d = await gate(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z'), store);
  assert.equal(d.allowed, true);
});

test('a missing attestation blocks the audit', async () => {
  const store = new InMemoryAttemptStore();
  const d = await gate(
    attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z', purpose({ attestationText: '' })),
    store
  );
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.equal(d.reason, 'attestation_missing');
});

test('any purpose other than self-audit is refused outright', async () => {
  const store = new InMemoryAttemptStore();
  const d = await gate(
    attempt('Someone Else', '2026-10-29T10:00:00.000Z', purpose({ kind: 'research' as never })),
    store
  );
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.equal(d.reason, 'purpose_not_supported');
  assert.match(d.message, /only supports auditing your own/i);
});

test('re-running your own audit is normal and is not throttled early', async () => {
  const store = new InMemoryAttemptStore();
  for (let i = 0; i < DEFAULT_POLICY.maxPerWindow; i++) {
    const d = await gate(attempt('Jensen Adoni', `2026-10-29T1${i}:00:00.000Z`), store);
    assert.equal(d.allowed, true, `attempt ${i + 1} should be allowed`);
  }
});

test('volume is eventually capped', async () => {
  const store = new InMemoryAttemptStore();
  for (let i = 0; i < DEFAULT_POLICY.maxPerWindow; i++) {
    await gate(attempt('Jensen Adoni', `2026-10-29T1${i}:00:00.000Z`), store);
  }
  const d = await gate(attempt('Jensen Adoni', '2026-10-29T16:00:00.000Z'), store);
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.equal(d.reason, 'rate_limited');
  assert.ok(d.retryAfterSeconds! > 0);
});

test('a second different name requires a verified email', async () => {
  const store = new InMemoryAttemptStore();
  await gate(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z'), store);

  const d = await gate(attempt('Someone Else', '2026-10-29T11:00:00.000Z'), store);
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.equal(d.reason, 'verification_required');
});

test('with a verified email a second name is allowed, a third is not', async () => {
  const store = new InMemoryAttemptStore();
  const verified = purpose({ verification: 'verified_email' });

  await gate(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z', verified), store);
  const second = await gate(attempt('Alex Rivera', '2026-10-29T11:00:00.000Z', verified), store);
  assert.equal(second.allowed, true);

  // Variety, not volume, is the signal that separates a professional checking
  // themselves from someone working through a list.
  const third = await gate(attempt('Dana Okoro', '2026-10-29T12:00:00.000Z', verified), store);
  assert.equal(third.allowed, false);
  if (third.allowed) return;
  assert.equal(third.reason, 'enumeration_suspected');
});

test('name variants are not counted as different people', async () => {
  const store = new InMemoryAttemptStore();
  await gate(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z'), store);

  // Same person, differently typed. Treating these as two subjects would
  // throttle people for using their own initials.
  const d = await gate(attempt('jensen  adoni', '2026-10-29T11:00:00.000Z'), store);
  assert.equal(d.allowed, true);
});

test('verification requirements escalate with distinct subjects', () => {
  assert.equal(requiredVerification(1), 'none');
  assert.equal(requiredVerification(2), 'verified_email');
  assert.equal(requiredVerification(3), 'connected_account');
});

test('attempts outside the window do not count', async () => {
  const store = new InMemoryAttemptStore();
  for (let i = 0; i < DEFAULT_POLICY.maxPerWindow; i++) {
    await gate(attempt('Jensen Adoni', `2026-10-20T1${i}:00:00.000Z`), store);
  }

  const d = await gate(attempt('Jensen Adoni', '2026-10-29T10:00:00.000Z'), store);
  assert.equal(d.allowed, true);
});
