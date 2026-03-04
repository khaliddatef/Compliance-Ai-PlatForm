export type ControlComplianceStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT_ASSESSED';
export type TestComponentComplianceStatus = 'PASS' | 'PARTIAL' | 'FAIL';

export type TestComponentStatusInput = {
  componentId: string;
  bestScore: number | null;
  hasAcceptedEvidence: boolean;
};

export const deriveTestComponentStatus = (
  bestScore: number | null,
  hasAcceptedEvidence: boolean,
): TestComponentComplianceStatus => {
  if (!hasAcceptedEvidence || bestScore === null || !Number.isFinite(bestScore)) {
    return 'FAIL';
  }
  if (bestScore >= 80) return 'PASS';
  if (bestScore >= 50) return 'PARTIAL';
  return 'FAIL';
};

export const deriveControlStatusFromComponents = (
  componentStatuses: TestComponentComplianceStatus[],
): ControlComplianceStatus => {
  if (!componentStatuses.length) return 'NOT_ASSESSED';
  if (componentStatuses.includes('FAIL')) return 'FAIL';
  if (componentStatuses.includes('PARTIAL')) return 'PARTIAL';
  return 'PASS';
};

export const deriveControlComplianceStatus = (params: {
  requiredCount: number;
  acceptedCount: number;
  latestAssessmentStatus: string | null;
  componentInputs?: TestComponentStatusInput[];
}): ControlComplianceStatus => {
  const componentInputs = Array.isArray(params.componentInputs) ? params.componentInputs : [];
  if (componentInputs.length) {
    const statuses = componentInputs.map((item) =>
      deriveTestComponentStatus(item.bestScore, item.hasAcceptedEvidence),
    );
    return deriveControlStatusFromComponents(statuses);
  }

  const assessment = String(params.latestAssessmentStatus || '').toUpperCase();
  if (assessment === 'PASS' || assessment === 'PARTIAL' || assessment === 'FAIL' || assessment === 'NOT_ASSESSED') {
    return assessment;
  }

  if (!params.requiredCount) return 'NOT_ASSESSED';
  if (params.acceptedCount >= params.requiredCount) return 'PASS';
  if (params.acceptedCount > 0) return 'PARTIAL';
  return 'FAIL';
};
