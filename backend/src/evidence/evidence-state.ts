export type EvidenceState = 'SUBMITTED' | 'REVIEWED' | 'ACCEPTED' | 'REJECTED';
export type EvidenceRequestState = 'OPEN' | 'SUBMITTED' | 'OVERDUE' | 'CLOSED';

export const isEvidenceTransitionAllowed = (current: EvidenceState, next: EvidenceState) => {
  if (current === next) return true;
  if (current === 'SUBMITTED' && next === 'REVIEWED') return true;
  if (current === 'REVIEWED' && (next === 'ACCEPTED' || next === 'REJECTED' || next === 'SUBMITTED')) return true;
  if (current === 'REJECTED' && next === 'SUBMITTED') return true;
  return false;
};

export const deriveRequestStatusFromEvidence = (evidenceStatusRaw: string): EvidenceRequestState => {
  const evidenceStatus = String(evidenceStatusRaw || '').toUpperCase() as EvidenceState;
  if (evidenceStatus === 'ACCEPTED') return 'CLOSED';
  if (evidenceStatus === 'REJECTED') return 'OPEN';
  return 'SUBMITTED';
};
