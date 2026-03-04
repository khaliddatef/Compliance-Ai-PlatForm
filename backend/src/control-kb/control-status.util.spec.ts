import {
  deriveControlComplianceStatus,
  deriveControlStatusFromComponents,
  deriveTestComponentStatus,
} from './control-status.util';

describe('control-status util', () => {
  describe('deriveTestComponentStatus', () => {
    it('returns PASS for strong evidence score', () => {
      expect(deriveTestComponentStatus(88, true)).toBe('PASS');
    });

    it('returns PARTIAL for medium evidence score', () => {
      expect(deriveTestComponentStatus(65, true)).toBe('PARTIAL');
    });

    it('returns FAIL for weak evidence score', () => {
      expect(deriveTestComponentStatus(40, true)).toBe('FAIL');
    });

    it('returns FAIL when no accepted evidence exists', () => {
      expect(deriveTestComponentStatus(95, false)).toBe('FAIL');
      expect(deriveTestComponentStatus(null, false)).toBe('FAIL');
    });
  });

  describe('deriveControlStatusFromComponents', () => {
    it('returns PASS when all components pass', () => {
      expect(deriveControlStatusFromComponents(['PASS', 'PASS'])).toBe('PASS');
    });

    it('returns PARTIAL when no fail and at least one partial', () => {
      expect(deriveControlStatusFromComponents(['PASS', 'PARTIAL', 'PASS'])).toBe('PARTIAL');
    });

    it('returns FAIL when any component fails', () => {
      expect(deriveControlStatusFromComponents(['PASS', 'FAIL', 'PARTIAL'])).toBe('FAIL');
    });

    it('returns NOT_ASSESSED when components are empty', () => {
      expect(deriveControlStatusFromComponents([])).toBe('NOT_ASSESSED');
    });
  });

  describe('deriveControlComplianceStatus', () => {
    it('uses component inputs when provided', () => {
      expect(
        deriveControlComplianceStatus({
          requiredCount: 3,
          acceptedCount: 0,
          latestAssessmentStatus: 'PASS',
          componentInputs: [
            { componentId: 'a', bestScore: 90, hasAcceptedEvidence: true },
            { componentId: 'b', bestScore: 72, hasAcceptedEvidence: true },
          ],
        }),
      ).toBe('PARTIAL');
    });

    it('falls back to latest assessment when no component inputs', () => {
      expect(
        deriveControlComplianceStatus({
          requiredCount: 4,
          acceptedCount: 0,
          latestAssessmentStatus: 'PASS',
        }),
      ).toBe('PASS');
    });

    it('falls back to accepted/required counts when no assessment', () => {
      expect(
        deriveControlComplianceStatus({
          requiredCount: 4,
          acceptedCount: 2,
          latestAssessmentStatus: null,
        }),
      ).toBe('PARTIAL');
    });
  });
});
