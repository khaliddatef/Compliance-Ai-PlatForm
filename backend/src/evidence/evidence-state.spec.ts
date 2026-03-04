import {
  deriveRequestStatusFromEvidence,
  isEvidenceTransitionAllowed,
} from './evidence-state';

describe('Evidence state machine', () => {
  it('allows submitted -> reviewed', () => {
    expect(isEvidenceTransitionAllowed('SUBMITTED', 'REVIEWED')).toBe(true);
  });

  it('allows reviewed -> accepted/rejected/submitted', () => {
    expect(isEvidenceTransitionAllowed('REVIEWED', 'ACCEPTED')).toBe(true);
    expect(isEvidenceTransitionAllowed('REVIEWED', 'REJECTED')).toBe(true);
    expect(isEvidenceTransitionAllowed('REVIEWED', 'SUBMITTED')).toBe(true);
  });

  it('allows rejected -> submitted (rework)', () => {
    expect(isEvidenceTransitionAllowed('REJECTED', 'SUBMITTED')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(isEvidenceTransitionAllowed('SUBMITTED', 'ACCEPTED')).toBe(false);
    expect(isEvidenceTransitionAllowed('ACCEPTED', 'REJECTED')).toBe(false);
  });

  it('derives request status from evidence status', () => {
    expect(deriveRequestStatusFromEvidence('ACCEPTED')).toBe('CLOSED');
    expect(deriveRequestStatusFromEvidence('REJECTED')).toBe('OPEN');
    expect(deriveRequestStatusFromEvidence('REVIEWED')).toBe('SUBMITTED');
  });
});
