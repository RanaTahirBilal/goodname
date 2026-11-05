/**
 * Test factories. Not exported from the package index — these exist to make
 * tests readable, not to be used by production code.
 */
import type {
  Classification,
  EvidenceRecord,
  FindingStatus,
  IdentityStatus,
  ProfessionalIdentity,
  SourceReliability,
  Authorship,
} from '../contracts/types.ts';

export const OBSERVED = '2026-10-29T00:00:00.000Z';

export const ADONI: ProfessionalIdentity = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  region: 'Illinois',
  credentials: ['JD'],
  websiteUrl: 'https://adoni-law.example',
};

export interface EvidenceOpts {
  authorship?: Authorship;
  id?: string;
  url?: string;
  domain?: string;
  title?: string;
  excerpt?: string;
  position?: number;
  classification?: Classification;
  findingStatus?: FindingStatus;
  severity?: number;
  reliability?: SourceReliability;
  authority?: number;
  confidence?: number;
  publishedAt?: string;
  fixture?: boolean;
  duplicateOf?: string;
  storyClusterId?: string;
  independentSources?: number;
  contradictedBy?: string[];
}

let seq = 0;

export const evidence = (o: EvidenceOpts = {}): EvidenceRecord => {
  const n = ++seq;
  const confidence = o.confidence ?? 0.9;
  const status: IdentityStatus =
    confidence >= 0.85 ? 'confirmed' : confidence >= 0.6 ? 'probable' : confidence >= 0.3 ? 'uncertain' : 'rejected';

  return {
    /**
     * Undeclared by default, matching an audit for somebody we have never
     * worked for. A test that cares about authorship overrides it, and one
     * that does not behaves exactly as it did before the field existed.
     */
    authorship: o.authorship ?? {
      createdBy: 'third_party',
      distribution: 'editorial',
      editorialIndependence: 'not_verified',
    },

    id: o.id ?? `ev-${n}`,
    sourceUrl: o.url ?? `https://example.test/${n}`,
    sourceName: o.domain ?? 'example.test',
    domain: o.domain ?? 'example.test',
    retrievedAt: OBSERVED,
    publishedAt: o.publishedAt,
    title: o.title ?? `Result ${n}`,
    excerpt: o.excerpt ?? 'An excerpt.',
    position: o.position,

    provenance: o.fixture ? 'fixture' : 'live_search',
    providerName: 'test',

    identityConfidence: confidence,
    identityStatus: status,
    identitySignals: ['name'],

    sourceReliability: o.reliability ?? 'high',
    authority: o.authority ?? 0.8,

    classification: o.classification ?? 'earned',
    classificationConfidence: 0.8,
    classificationRationale: 'test',

    findingStatus: o.findingStatus,
    severity: o.severity,
    severityRationale: o.severity ? 'test severity' : undefined,

    reviewStatus: 'auto',

    duplicateOf: o.duplicateOf,
    storyClusterId: o.storyClusterId,
    independentSourcesInCluster: o.independentSources,
    contradictedBy: o.contradictedBy,
  };
};

/** A presence input with every dimension applicable, so tests vary one thing. */
export const presenceInput = (records: EvidenceRecord[], over: Record<string, unknown> = {}) => ({
  identity: ADONI,
  records,
  expectedProfiles: ['firm_bio', 'linkedin'],
  profileObservations: [
    { key: 'firm_bio', present: true, hasPhoto: true, hasBio: true, hasCredentials: true, hasOutboundLink: true },
    { key: 'linkedin', present: true, hasPhoto: true, hasBio: true, hasCredentials: true, hasOutboundLink: true },
  ],
  consistency: {
    comparableFields: 10,
    matchingFields: 10,
    profilesAssertingEmployment: 2,
    profilesWithStaleEmployment: 0,
  },
  websiteChecks: [
    { key: 'https', passed: true },
    { key: 'title', passed: true },
  ],
  ...over,
});
