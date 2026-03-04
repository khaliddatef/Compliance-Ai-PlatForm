# Evidence Quality Rules (v1)

This document defines the deterministic scoring and explainability logic used by `EvidenceQualityService`.

## Score Dimensions

Total score is `0..100`, computed as:

1. Relevance (`0..30`)
2. Reliability (`0..30`)
3. Freshness (`0..20`)
4. Completeness (`0..20`)

Grade mapping:

- `STRONG`: `>= 80`
- `MEDIUM`: `50..79`
- `WEAK`: `< 50`

## Deterministic Inputs

Scoring only uses persisted data and relationships:

- Evidence fields (`type`, `status`, `validFrom`, `validTo`, `reviewComment`, ...)
- Links (`EvidenceControlLink`)
- Request fulfillment links (`EvidenceRequestFulfillment`)
- Control schedule (`ControlSchedule.frequencyDays`)

No freeform AI generation is used for score, reasons, or fixes.

## Reliability Mapping

Default reliability points by normalized evidence type:

- `LOGS`, `CONFIG_EXPORT`, `SYSTEM_REPORT`: `30`
- `TICKET_WITH_APPROVAL`: `24`
- `SCREENSHOT`: `18`
- `PROCEDURE`: `14`
- `POLICY`: `10`
- `ATTESTATION`: `8`
- fallback (`OTHER`): `16`

## Freshness Rules

- If `validTo` exists and is in the past: freshness `0`, reason `EVIDENCE_EXPIRED`.
- Otherwise, age is compared with cadence derived from `frequencyDays`:
  - Monthly (`<=45 days`): full `<=30`, half `31..60`, low `>60`
  - Quarterly (`<=180 days`): full `<=90`, half `91..120`, low `>120`
  - Annual (`>180 days`): full `<=365`, half `366..450`, low `>450`

## Completeness Rules

Start from `20`, apply penalties:

- Missing reviewer for `ACCEPTED`/`REVIEWED`: `-5`
- Missing review comment for `ACCEPTED`/`REJECTED`: `-5`
- Not linked to any control: `-10`
- Missing metadata (source/type-specific minimal checks): `-5` to `-10`

## Relevance Rules

- Linked to at least one control: `+15`
- Linked to requested context (control/test component), or fallback linked context: `+10`
- Fulfills at least one evidence request: `+5`

## Explainability Payload

`qualityFactors` stores stable JSON:

- dimension points and signals
- deterministic reasons (`code`, `msg`, `severity`)
- deterministic fixes (`code`, `msg`, `suggestedAction`)
- coverage (`linkedControls`, `linkedRequests`, `linkedTestComponents`)

## Control Status Derivation (v1)

Per test component:

- `PASS` if best accepted linked evidence score `>=80`
- `PARTIAL` if best accepted linked evidence score `50..79`
- `FAIL` otherwise

Control status:

- `PASS` if all components pass
- `PARTIAL` if no component fails and at least one is partial
- `FAIL` if any component fails

Fallback behavior is used when component-specific links are unavailable.
