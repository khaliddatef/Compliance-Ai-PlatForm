import { Injectable } from '@nestjs/common';

export type FeatureFlagsSnapshot = {
  evidenceV2: boolean;
  evidenceQualityV1: boolean;
  controlStatusBanner: boolean;
  copilotStructured: boolean;
  auditPackV1: boolean;
};

const toBool = (value: string | undefined, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
};

@Injectable()
export class FeatureFlagsService {
  get snapshot(): FeatureFlagsSnapshot {
    const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    return {
      evidenceV2: toBool(process.env.FEATURE_EVIDENCE_V2, true),
      evidenceQualityV1: toBool(process.env.FEATURE_EVIDENCE_QUALITY_V1, !isProd),
      controlStatusBanner: toBool(process.env.FEATURE_CONTROL_STATUS_BANNER, true),
      copilotStructured: toBool(process.env.FEATURE_COPILOT_STRUCTURED, true),
      auditPackV1: toBool(process.env.FEATURE_AUDIT_PACK_V1, true),
    };
  }

  isEnabled(flag: keyof FeatureFlagsSnapshot) {
    return this.snapshot[flag];
  }
}
