import { buildEvidenceQuality } from './evidence-quality.service';

const baseInput = (overrides?: Partial<Parameters<typeof buildEvidenceQuality>[0]>): Parameters<typeof buildEvidenceQuality>[0] => ({
  evidence: {
    id: 'ev-1',
    title: 'Evidence',
    type: 'LOGS',
    source: 'upload',
    documentId: 'doc-1',
    url: null,
    status: 'ACCEPTED',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    validFrom: null,
    validTo: new Date('2026-12-31T00:00:00.000Z').toISOString(),
    reviewedById: 'manager-1',
    reviewComment: 'Reviewed',
  },
  coverage: {
    linkedControls: ['ctrl-1'],
    linkedRequests: ['req-1'],
    linkedTestComponents: ['tc-1'],
  },
  frequencyDays: 90,
  now: new Date('2026-03-01T00:00:00.000Z'),
  ...overrides,
});

describe('buildEvidenceQuality', () => {
  it('sets freshness to 0 and adds EVIDENCE_EXPIRED reason when validTo is expired', () => {
    const result = buildEvidenceQuality(
      baseInput({
        evidence: {
          ...baseInput().evidence,
          validTo: new Date('2025-12-31T00:00:00.000Z').toISOString(),
        },
      }),
    );

    expect(result.factors.freshness.points).toBe(0);
    expect(result.factors.reasons.some((reason) => reason.code === 'EVIDENCE_EXPIRED')).toBe(true);
    expect(result.factors.fixes.some((fix) => fix.code === 'REUPLOAD_FRESH_EVIDENCE')).toBe(true);
  });

  it('scores POLICY reliability lower than LOGS', () => {
    const logs = buildEvidenceQuality(baseInput({ evidence: { ...baseInput().evidence, type: 'LOGS' } }));
    const policy = buildEvidenceQuality(baseInput({ evidence: { ...baseInput().evidence, type: 'POLICY' } }));

    expect(logs.factors.reliability.points).toBeGreaterThan(policy.factors.reliability.points);
    expect(logs.factors.reliability.points).toBe(30);
    expect(policy.factors.reliability.points).toBe(10);
  });

  it('increases relevance when evidence is linked to controls/requests', () => {
    const linked = buildEvidenceQuality(baseInput());
    const unlinked = buildEvidenceQuality(
      baseInput({
        coverage: {
          linkedControls: [],
          linkedRequests: [],
          linkedTestComponents: [],
        },
      }),
    );

    expect(linked.factors.relevance.points).toBeGreaterThan(unlinked.factors.relevance.points);
    expect(unlinked.factors.reasons.some((reason) => reason.code === 'EVIDENCE_NOT_LINKED')).toBe(true);
  });

  it('penalizes completeness when accepted evidence misses reviewer/comment requirements', () => {
    const complete = buildEvidenceQuality(baseInput());
    const incomplete = buildEvidenceQuality(
      baseInput({
        evidence: {
          ...baseInput().evidence,
          reviewedById: null,
          reviewComment: '',
        },
      }),
    );

    expect(incomplete.factors.completeness.points).toBeLessThan(complete.factors.completeness.points);
    expect(incomplete.factors.reasons.some((reason) => reason.code === 'MISSING_REVIEWER')).toBe(true);
    expect(incomplete.factors.reasons.some((reason) => reason.code === 'MISSING_REVIEW_COMMENT')).toBe(true);
  });
});
