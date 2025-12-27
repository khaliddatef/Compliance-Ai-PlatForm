export type ComplianceStatus = 'Compliant' | 'Partially compliant' | 'Not compliant';

export interface ComplianceResult {
  standard: string;
  status: ComplianceStatus;
  summary: string;
  missing: string[];
  sources: string[];
}
