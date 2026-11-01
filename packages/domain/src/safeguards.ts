/**
 * Self-audit safeguards.
 *
 * The product is for professionals auditing *their own* presence. Nothing in
 * a search pipeline enforces that by itself — a name is a name — so the
 * safeguard has to be deliberate, and it has to be proportionate: too weak
 * and the product is a people-search engine with better typography; too heavy
 * and nobody completes a free audit.
 *
 * A checkbox does not establish authorization. It establishes that we asked,
 * which matters for the record but does not stop anyone. So attestation is
 * the floor, not the mechanism, and the real controls are rate limiting,
 * enumeration detection and escalating verification.
 *
 * These are engineering controls. They do not establish legal compliance.
 * See docs/SAFEGUARDS.md for the open legal questions.
 */
import type { AuditPurpose, VerificationLevel } from './contracts/types.ts';

export type GateDecision =
  | { allowed: true; verification: VerificationLevel }
  | { allowed: false; reason: GateReason; message: string; retryAfterSeconds?: number };

export type GateReason =
  | 'purpose_not_supported'
  | 'attestation_missing'
  | 'rate_limited'
  | 'enumeration_suspected'
  | 'verification_required';

export interface AuditAttempt {
  /** Stable id for the requester: account id, or a hashed address for anonymous use. */
  requesterId: string;
  /** The name being audited, used only to detect enumeration. */
  subjectName: string;
  purpose: AuditPurpose;
  at: string;
}

export interface RateLimitPolicy {
  /** Audits one requester may run in the window. */
  maxPerWindow: number;
  windowSeconds: number;
  /**
   * Distinct names one requester may audit in the window. The signal that
   * separates a professional checking themselves from someone working through
   * a list is not volume, it is variety.
   */
  maxDistinctSubjects: number;
}

export const DEFAULT_POLICY: RateLimitPolicy = {
  maxPerWindow: 5,
  windowSeconds: 86_400,
  maxDistinctSubjects: 2,
};

/**
 * Storage seam. In-memory here; a durable implementation is required before
 * public launch, because an in-process counter resets on deploy and is
 * per-instance.
 */
export interface AttemptStore {
  recent(requesterId: string, sinceIso: string): Promise<AuditAttempt[]>;
  record(attempt: AuditAttempt): Promise<void>;
}

export class InMemoryAttemptStore implements AttemptStore {
  private attempts: AuditAttempt[] = [];

  async recent(requesterId: string, sinceIso: string): Promise<AuditAttempt[]> {
    const since = Date.parse(sinceIso);
    return this.attempts.filter(
      (a) => a.requesterId === requesterId && Date.parse(a.at) >= since
    );
  }

  async record(attempt: AuditAttempt): Promise<void> {
    this.attempts.push(attempt);
  }
}

/** Normalised so "J. Adoni" and "j adoni" are not counted as two people. */
const normaliseName = (n: string): string =>
  n.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).join(' ');

/**
 * Verification required before we will run an audit, given what the requester
 * has already done. Escalates with variety, not with volume: re-running your
 * own audit is normal, running a third different name is not.
 */
export function requiredVerification(distinctSubjects: number): VerificationLevel {
  if (distinctSubjects <= 1) return 'none';
  if (distinctSubjects === 2) return 'verified_email';
  return 'connected_account';
}

const SUFFICIENT: Record<VerificationLevel, number> = {
  none: 0,
  email_domain_match: 1,
  verified_email: 2,
  connected_account: 3,
  document_verified: 4,
};

export async function gate(
  attempt: AuditAttempt,
  store: AttemptStore,
  policy: RateLimitPolicy = DEFAULT_POLICY
): Promise<GateDecision> {
  if (attempt.purpose.kind !== 'self_audit') {
    return {
      allowed: false,
      reason: 'purpose_not_supported',
      message:
        'This product only supports auditing your own professional presence. Looking up other people is not something it does.',
    };
  }

  if (!attempt.purpose.attestationText || !attempt.purpose.attestedAt) {
    return {
      allowed: false,
      reason: 'attestation_missing',
      message: 'We need you to confirm that this audit is about you before it runs.',
    };
  }

  const since = new Date(Date.parse(attempt.at) - policy.windowSeconds * 1000).toISOString();
  const recent = await store.recent(attempt.requesterId, since);

  if (recent.length >= policy.maxPerWindow) {
    return {
      allowed: false,
      reason: 'rate_limited',
      message: 'You have run several audits recently. This limit exists to stop the product being used to look up other people.',
      retryAfterSeconds: policy.windowSeconds,
    };
  }

  const subjects = new Set(recent.map((a) => normaliseName(a.subjectName)));
  subjects.add(normaliseName(attempt.subjectName));

  if (subjects.size > policy.maxDistinctSubjects) {
    return {
      allowed: false,
      reason: 'enumeration_suspected',
      message:
        'This account has audited several different names. We have paused further audits pending review.',
    };
  }

  const required = requiredVerification(subjects.size);
  if (SUFFICIENT[attempt.purpose.verification] < SUFFICIENT[required]) {
    return {
      allowed: false,
      reason: 'verification_required',
      message:
        required === 'verified_email'
          ? 'Confirm your email address before auditing a different name.'
          : 'Connect a professional profile so we can establish this is you.',
    };
  }

  await store.record(attempt);
  return { allowed: true, verification: attempt.purpose.verification };
}

/**
 * The exact words a customer confirms. Kept here rather than in the UI so the
 * same text is stored on the audit record as the one that was shown.
 */
export const SELF_AUDIT_ATTESTATION =
  'I confirm this audit is about me, and that I am not using it to research another person.';
