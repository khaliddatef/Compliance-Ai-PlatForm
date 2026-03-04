# Data Model

Source of truth: `backend/prisma/schema.prisma`

The project uses SQLite with Prisma models for chat, documents, evaluations, and control knowledge base domains.

## Core Chat and Evidence Models

### `User`

- Primary identity model
- Fields include `name`, `email` (unique), `passwordHash`, `role`

### `Conversation`

- Chat container
- Links to optional `userId`
- Has many `messages`, `documents`, `evaluations`
- Supports `customerVectorStoreId` for OpenAI storage

### `Message`

- Belongs to one conversation
- Role is `user` or `assistant`

### `Document`

- Uploaded file metadata
- Belongs to one conversation
- Supports match fields such as:
  1. `docType`
  2. `matchControlId`
  3. `matchStatus`
  4. `matchNote`
  5. `matchRecommendations`
- Has many `DocumentChunk`

### `DocumentChunk`

- Chunked text extracted from document
- Used for retrieval/evaluation paths

### `EvidenceEvaluation`

- Stores control evaluation output per conversation/control
- Includes status, summary, satisfied/missing/recommendations, citations

### `Evidence` (V2)

- Canonical evidence entity used by review workflow and control status
- Core fields:
  1. `title`, `type`, `source`
  2. `status` (`SUBMITTED`/`REVIEWED`/`ACCEPTED`/`REJECTED`)
  3. review metadata (`reviewedById`, `reviewedAt`, `reviewComment`)
  4. validity (`validFrom`, `validTo`)
- Quality scoring fields:
  1. `qualityScore` (`0..100`)
  2. `qualityGrade` (`STRONG`/`MEDIUM`/`WEAK`)
  3. `qualityFactors` (JSON explainability payload)
  4. `qualityComputedAt`
  5. `qualityVersion`

### `EvidenceControlLink`

- Many-to-many link between `Evidence` and `ControlDefinition`
- Unique pair of (`evidenceId`, `controlId`)

### `ControlEvidenceRequest`

- Operational request entity for collecting missing evidence
- Includes `ownerId`, `dueDate`, `status`, optional `testComponentId`, `dedupKey`

### `EvidenceRequestFulfillment`

- Link table between `ControlEvidenceRequest` and submitted `Evidence`
- Drives request lifecycle transitions and quality relevance signals

### `ConversationVisibility`

- Per-user hide flag for conversations
- Used for manager hide behavior without deleting conversation

## Control Knowledge Base Models

### `ControlTopic`

- Logical control grouping (topic/domain)

### `ControlDefinition`

- Main control record
- Includes `controlCode`, `title`, optional `isoMappings`, owner and status fields

### `ControlTopicMapping`

- Many-to-many between controls and topics
- Relationship type: `PRIMARY` or `RELATED`

### `Framework`

- Framework registry (for example ISO variants)
- Can be enabled/disabled

### `ControlFrameworkMapping`

- Maps controls to framework-specific reference codes

### `TopicFrameworkMapping`

- Maps topics to frameworks

### `TestComponent`

- Detailed test requirements for control evaluation

### `EvidenceRequest` and `ControlEvidenceMapping`

- Defines required evidence artifacts
- Maps control to evidence requests

## Risk, Threat, and Context Models

### `ControlRiskContext`

- Control-level risk framing metadata

### `RiskCatalog`

- Risk catalog items

### `ThreatCatalog`

- Threat catalog items

### `ControlRiskMapping`

- Control to risk associations

### `ControlThreatMapping`

- Control to threat associations

### `ControlApplicability`

- Applicability dimensions for controls (people/process/technology/data)

## Additional KB Support Models

1. `TestComponentSignal`
2. `ControlRole`
3. `ImplementationGuidance`
4. `FrameworkSource`
5. `EvidenceType`

## Enums

1. `ControlTopicRelationshipType`: `PRIMARY`, `RELATED`
2. `MappingRelationshipType`: `PRIMARY`, `RELATED`

## Runtime-Created Settings Tables

These are created via SQL in `SettingsService`, not Prisma schema models:

1. `UserSettings`
2. `TeamInvite`

## Notes

- Most list and dashboard operations are built on top of `ControlDefinition`, `Document`, and `EvidenceEvaluation`.
- Control assignment operations update both direct fields and mapping tables to maintain primary/related consistency.
