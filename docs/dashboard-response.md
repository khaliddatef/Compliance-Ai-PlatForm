# Dashboard Response (Extended)

This project now returns additional fields to support the action-driven dashboard.
All fields are additive and backward-compatible with the existing payload.

## New fields (summary)

- `filterOptions`: Frameworks and range options for global filters.
- `attentionToday`: Action-first items for the "What needs attention today" block.
- `kpis`: KPI tiles with drilldown metadata.
- `evidenceHealthDetailV2`: Auditor-friendly evidence health counts (expiring in 30 days, expired, missing, reused, rejected, outdated).
- `trendsV2`: Date-labeled trend series for Risk Score, Compliance, MTTR (range-aware).
- `frameworkComparisonV2`: Per-framework compliance breakdown (compliant/partial/not compliant/unknown).
- `recommendedActionsV2`: Rule-based actions with reasons and drilldowns.
- `auditSummary`: Upcoming audits summary (placeholder until audit schedule data is added).
- `executiveSummary`: One-page executive narrative and highlights.
- `riskDistribution`: Roll-up of risk heatmap into high/medium/low exposure buckets.
- `evidenceHealthVisual`: Visual-ready evidence freshness counts (valid/expiring/expired/missing).
- `complianceGaps`: Top compliance gap reasons for non-compliant/partial controls (Missing Evidence, Control Not Implemented, Control Not Tested, Owner Not Assigned, Outdated Policy).
- `riskDrivers`: Top 3 drivers behind current risk exposure (Missing Evidence, Unassigned Owners, Unreviewed Controls).

## Sample response (trimmed)

```json
{
  "ok": true,
  "appliedFilters": {
    "framework": "ISO 27001",
    "businessUnit": null,
    "riskCategory": null,
    "rangeDays": 90
  },
  "filterOptions": {
    "frameworks": ["ISO 27001", "SOC 2", "NIST"],
    "businessUnits": [],
    "riskCategories": [],
    "timeRanges": [30, 90, 180, 365]
  },
  "attentionToday": [
    {
      "id": "failed-controls",
      "label": "Failed Controls",
      "count": 5,
      "severity": "high",
      "kind": "control",
      "route": "/control-kb",
      "query": { "status": "enabled" }
    },
    {
      "id": "missing-evidence",
      "label": "Missing Evidence",
      "count": 8,
      "severity": "high",
      "kind": "evidence",
      "route": "/uploads"
    },
    {
      "id": "risks-without-owner",
      "label": "Risks Without Owner",
      "count": 3,
      "severity": "medium",
      "kind": "risk",
      "route": "/dashboard"
    },
    {
      "id": "upcoming-audits",
      "label": "Upcoming Audits",
      "count": 2,
      "severity": "medium",
      "kind": "audit",
      "route": "/dashboard",
      "query": { "range": "30" }
    }
  ],
  "kpis": [
    {
      "id": "coverage",
      "label": "Overall Coverage",
      "value": "72%",
      "note": "45/62 controls reviewed",
      "severity": "medium",
      "drilldown": { "route": "/control-kb", "query": { "status": "enabled" } }
    }
  ],
  "evidenceHealthDetailV2": {
    "expiringIn30": 3,
    "expired": 2,
    "missing": 12,
    "reusedAcrossFrameworks": 4,
    "rejected": 1,
    "outdated": 6
  },
  "trendsV2": [
    {
      "id": "riskScore",
      "label": "Risk Score",
      "rangeDays": 90,
      "unit": "percent",
      "dates": ["2026-01-05", "2026-01-06"],
      "points": [45, 44]
    }
  ],
  "frameworkComparisonV2": [
    {
      "framework": "ISO 27001",
      "totalControls": 62,
      "compliant": 30,
      "partial": 15,
      "notCompliant": 7,
      "unknown": 10,
      "completionPercent": 72,
      "failedControls": 7
    }
  ],
  "recommendedActionsV2": [
    {
      "id": "add-evidence-control",
      "title": "Add evidence for A.5.1",
      "reason": "7 controls are marked NOT_COMPLIANT",
      "severity": "high",
      "route": "/control-kb",
      "query": { "status": "enabled" },
      "cta": "Review control"
    }
  ],
  "auditSummary": {
    "upcoming14": 0,
    "upcoming30": 0,
    "upcoming90": 0,
    "upcoming": []
  },
  "executiveSummary": {
    "headline": "72% coverage across 62 controls",
    "highlights": [
      "30 compliant - 15 partial - 7 failed",
      "Evidence health 68%",
      "Audit readiness 62%"
    ],
    "risks": [
      "7 failed controls require attention",
      "12 controls are missing evidence"
    ],
    "lastUpdated": "2026-02-02T18:30:00.000Z"
  },
  "complianceGaps": [
    {
      "id": "missing-evidence",
      "label": "Missing Evidence",
      "count": 12,
      "route": "/control-kb",
      "query": { "status": "enabled", "gap": "missing-evidence" }
    },
    {
      "id": "control-not-tested",
      "label": "Control Not Tested",
      "count": 6,
      "route": "/control-kb",
      "query": { "status": "enabled", "gap": "control-not-tested" }
    }
  ],
  "riskDistribution": {
    "high": 6,
    "medium": 12,
    "low": 44,
    "total": 62,
    "exposure": "medium"
  },
  "riskDrivers": [
    { "id": "missing-evidence", "label": "Missing Evidence", "count": 8 },
    { "id": "owner-not-assigned", "label": "Unassigned Owners", "count": 5 },
    { "id": "control-not-tested", "label": "Unreviewed Controls", "count": 3 }
  ],
  "evidenceHealthVisual": {
    "valid": 45,
    "expiringSoon": 3,
    "expired": 2,
    "missing": 12,
    "total": 62
  }
}
```
