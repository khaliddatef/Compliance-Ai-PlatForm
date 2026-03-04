# Backend Guide

## Backend Stack

- NestJS 11
- Prisma 7
- SQLite with better-sqlite3 adapter
- OpenAI Responses API

## Bootstrap

Entry point: `backend/src/main.ts`

Bootstrap config includes:
1. CORS for local frontend
2. `helmet` security headers
3. `morgan` request logging
4. global `ValidationPipe`
5. global `HttpExceptionFilter` for normalized errors

## Module Map

### `AuthModule`

Files:
1. `backend/src/auth/auth.controller.ts`
2. `backend/src/auth/auth.service.ts`
3. `backend/src/auth/auth.guard.ts`

Responsibilities:
1. login/logout/me endpoints
2. user validation and JWT issue/verify
3. role-bearing auth context on requests
4. default user seed on module init

### `ChatModule`

Files:
1. `backend/src/chat/chat.controller.ts`
2. `backend/src/chat/chat.service.ts`

Responsibilities:
1. conversation listing/get/messages APIs
2. chat send API
3. evidence evaluation API
4. conversation deletion/hide behavior by role

### `AgentService`

File: `backend/src/agent/agent.service.ts`

Responsibilities:
1. chat guidance response generation
2. control evidence evaluation generation
3. single-document control matching
4. optional external link lookup for web-search-like prompts

### `UploadModule`

Files:
1. `backend/src/upload/upload.controller.ts`
2. `backend/src/upload/upload.service.ts`
3. `backend/src/upload/upload.validation.ts`

Responsibilities:
1. file upload/list/detail/download/delete
2. status and compliance updates
3. upload-time analysis and control matching
4. OpenAI file/vector-store lifecycle management

### `IngestModule`

Files:
1. `backend/src/ingest/ingest.controller.ts`
2. `backend/src/ingest/ingest.service.ts`

Responsibilities:
1. extract text from PDF/DOCX/XLSX
2. chunk extracted text
3. persist chunks in `DocumentChunk`

### `ControlKbModule`

Files:
1. `backend/src/control-kb/control-kb.controller.ts`
2. `backend/src/control-kb/control-kb.service.ts`

Responsibilities:
1. framework/topic/control CRUD APIs
2. control-topic and control-framework mapping
3. control filtering by status/compliance/gap/framework/evidence
4. control context resolution for evaluations
5. catalog/context endpoints available to authenticated users for chat-guided control flow
6. control status aggregation with weak-evidence and why-partial/why-fail explainability

### `EvidenceModule`

Files:
1. `backend/src/evidence/evidence.controller.ts`
2. `backend/src/evidence/evidence-requests.controller.ts`
3. `backend/src/evidence/evidence.service.ts`
4. `backend/src/evidence/evidence-quality.service.ts`

Responsibilities:
1. evidence listing/detail/review/linking APIs
2. evidence request lifecycle and fulfillment
3. deterministic evidence quality scoring (`0..100`) with explainability payload
4. recompute endpoint with RBAC + idempotency + audit trail

### `DashboardModule`

Files:
1. `backend/src/dashboard/dashboard.controller.ts`
2. `backend/src/dashboard/dashboard.service.ts`

Responsibilities:
1. aggregate compliance/risk/evidence metrics
2. produce KPI and trend payloads for dashboard UI

### `SettingsModule`

Files:
1. `backend/src/settings/settings.controller.ts`
2. `backend/src/settings/settings.service.ts`

Responsibilities:
1. notification and AI preference settings
2. team invitation and role management APIs
3. runtime creation of `UserSettings` and `TeamInvite` tables

### `PrismaModule`

Files:
1. `backend/src/prisma/prisma.module.ts`
2. `backend/src/prisma/prisma.service.ts`

Responsibilities:
1. shared Prisma service singleton
2. SQLite URL normalization for runtime paths

### `HealthModule`

File: `backend/src/health/health.controller.ts`

Responsibilities:
1. healthcheck endpoint for liveness

## Role and Access Rules

General role meaning:
1. `USER`: own chat/files, no KB/dashboard admin operations
2. `MANAGER`: broader visibility and operational updates
3. `ADMIN`: full system management operations

Enforcement happens in:
1. controller-level guards and role checks
2. service-level ownership checks and business rules

## Environment Variables

Core:
1. `PORT`
2. `DATABASE_URL`
3. `JWT_SECRET`
4. `JWT_EXPIRES_IN`
5. `TEST_USERS_PASSWORD`
6. `NODE_ENV`
7. `FEATURE_EVIDENCE_QUALITY_V1`

AI and storage:
1. `OPENAI_API_KEY`
2. `OPENAI_MODEL`
3. `DISABLE_OPENAI_STORAGE`
4. `DISABLE_DB_INGEST`

## Operational Notes

1. Standard uploads are disabled; knowledge base is source of truth for standard controls.
2. Upload ingestion and OpenAI storage can be toggled with env flags.
3. Dashboard audit summary fields are currently placeholder values in service logic.
4. Error responses are consistently wrapped as:

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "details": []
  }
}
```

## Related Docs

1. [API Reference](api-reference.md)
2. [Data Model](data-model.md)
3. [Architecture](architecture.md)
