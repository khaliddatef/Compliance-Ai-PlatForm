# Document Analysis V1 (12 Extraction Signals)

The upload pipeline now writes a structured `Document.analysisJson` payload after ingest + matching.

## What is extracted

1. Document metadata: file type, words, chars, language, checksum, duplicate-of, estimated pages.
2. Governance fields: title, version, owner, approver, approval/effective/review dates.
3. Control references: explicit codes (A.x.x, NIST-like IDs) with confidence.
4. Obligations: `must/shall/required` (and Arabic equivalents).
5. Evidence artifacts: logs, reports, tickets, screenshots, SIEM, etc.
6. Roles and responsibilities.
7. Operational signals: cadence/frequency, SLA-like targets, date signals.
8. Exceptions and approval path.
9. Risk signals: severity/CVSS/incident/threat mentions.
10. Auto-detected gaps for missing key sections.
11. Suggested actions (link control, create request, set validity, etc.).
12. Grounding: every claim contains `sourceRef` (documentId, chunkIndex, snippet).

## Storage fields

- `Document.analysisJson` (`Json?`)
- `Document.analysisVersion` (`Int`, default `1`)
- `Document.analysisComputedAt` (`DateTime?`)

## Runtime behavior

- New upload: extract and persist analysis.
- Re-evaluate endpoint: recomputes and persists analysis.
- Duplicate upload in same conversation: reuses previous analysis and marks `duplicateOfDocumentId`.
