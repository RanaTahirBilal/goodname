/**
 * POST /api/audit — creates a scan and queues the work.
 *
 * Returns a scan id immediately rather than a report. The audit itself runs
 * in a background job, because the cheapest search provider averages five
 * minutes per batch and even the fast tier is several seconds times three
 * calls plus classification. Holding a connection open for that is not an
 * option. See docs/SEARCH_PROVIDERS.md.
 *
 * The gate runs here, in the request, not in the job: a refused audit should
 * cost nothing and leave no queued work behind.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  buildQueries,
  gate,
  validateIdentity,
  FixtureSearchProvider,
  SELF_AUDIT_ATTESTATION,
  type AuditPurpose,
  type FixtureScenario,
  type ProfessionalIdentity,
  type Profession,
} from '@rep/domain';
import { store } from '../../../src/server/db.ts';
import { startWorker, type AuditJobPayload } from '../../../src/server/worker.ts';
import { ensureScope } from '../../../src/server/session.ts';

const PROFESSIONS: Profession[] = ['attorney', 'physician', 'founder', 'executive', 'other'];

const SCENARIOS: FixtureScenario[] = [
  'strong', 'official_finding', 'allegation', 'syndicated', 'corroborated',
  'retracted', 'employer_collision', 'ambiguous', 'sparse', 'empty',
  'provider_error', 'rate_limited',
];

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
};

/**
 * Identifies the requester for rate limiting.
 *
 * Keyed on the account rather than an IP now that one exists: an IP collides
 * for everyone in a shared office and is spoofable by anyone who cares.
 */
const requesterFor = (accountId: string) => `account:${accountId}`;

const websiteChecksFor = (identity: ProfessionalIdentity) =>
  identity.websiteUrl
    ? [
        { key: 'https', passed: true },
        { key: 'title', passed: true },
        { key: 'meta_description', passed: false },
        { key: 'structured_data', passed: true },
      ]
    : undefined;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const profession = str(body.profession);
  const identity: ProfessionalIdentity = {
    fullName: str(body.fullName) ?? '',
    profession: (PROFESSIONS.includes(profession as Profession)
      ? profession
      : 'other') as Profession,
    employer: str(body.employer),
    city: str(body.city),
    region: str(body.region),
    websiteUrl: str(body.websiteUrl),
    credentials: str(body.credentials)?.split(',').map((c) => c.trim()).filter(Boolean),
  };

  const issues = validateIdentity(identity);
  if (!PROFESSIONS.includes(profession as Profession)) {
    issues.push({ field: 'profession', message: 'Choose the profession that fits best.' });
  }
  if (body.attested !== true) {
    issues.push({
      field: 'attested',
      message: 'Confirm that this audit is about you before it runs.',
    });
  }
  if (issues.length > 0) {
    return NextResponse.json({ status: 'invalid_input', issues }, { status: 400 });
  }

  const scope = await ensureScope();
  const { repo, attempts, queue } = store();

  // A retried request returns the original scan rather than spending another
  // provider call and writing a second copy of the same evidence.
  const idempotencyKey = str(body.idempotencyKey);
  if (idempotencyKey) {
    const existing = repo.findByIdempotencyKey(scope, idempotencyKey);
    if (existing) {
      return NextResponse.json({ status: 'already_run', scanId: existing }, { status: 200 });
    }
  }

  const purpose: AuditPurpose = {
    kind: 'self_audit',
    attestationText: SELF_AUDIT_ATTESTATION,
    attestedAt: new Date().toISOString(),
    // Taken from the session rather than asserted. A verified email is what
    // unblocks auditing a second distinct name; an anonymous visitor gets
    // 'none' and will be asked to sign in at that point.
    verification: scope.verified ? 'verified_email' : 'none',
  };

  const requested = str(body.scenario);
  const scenario: FixtureScenario = SCENARIOS.includes(requested as FixtureScenario)
    ? (requested as FixtureScenario)
    : 'strong';

  const websiteChecks = websiteChecksFor(identity);

  // The gate is the one piece that must run inline. It is cheap, it decides
  // whether any work happens at all, and a refusal should not leave a queued
  // job behind for a worker to discover.
  const gateDecision = await gate(
    {
      requesterId: requesterFor(scope.accountId),
      subjectName: identity.fullName,
      purpose,
      at: new Date().toISOString(),
    },
    attempts
  );

  if (!gateDecision.allowed) {
    return NextResponse.json(
      {
        status: 'not_permitted',
        reason: gateDecision.reason,
        message: gateDecision.message,
        retryAfterSeconds: gateDecision.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  const scanId = repo.saveScan(scope, {
    identity,
    status: 'pending',
    provider: 'fixture',
    isFixture: true,
    window: 10,
    queries: buildQueries(identity),
    purpose,
    requesterId: requesterFor(scope.accountId),
    idempotencyKey,
  });

  const payload: AuditJobPayload = {
    identity,
    purpose,
    scenario,
    requesterId: requesterFor(scope.accountId),
    scanId,
    websiteChecks,
  };

  const jobId = queue.enqueue(scope, {
    type: 'audit',
    payload: payload as unknown as Record<string, unknown>,
    subjectType: 'scan',
    subjectId: scanId,
  });

  startWorker();

  return NextResponse.json({ status: 'queued', scanId, jobId }, { status: 202 });
}
