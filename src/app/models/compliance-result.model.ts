export type ComplianceStatus = 'Compliant' | 'Partially compliant' | 'Not compliant';

export interface ComplianceResult {
  framework?: string | null;
  status: ComplianceStatus;
  summary: string;
  missing: string[];
  sources: string[];
}
