# API Reference

Base URL in local development: `http://localhost:3000`

Most API routes are prefixed with `/api`.

## Authentication

Auth is JWT-based.

Accepted token transport:
1. `Authorization: Bearer <token>` header
2. `tekronyx_token` cookie

Frontend uses `withCredentials=true` on all HTTP requests.

## Health

### `GET /health`

Access: public

Response:

```json
{
  "status": "ok",
  "timestamp": 1712345678901
}
```

## Auth Endpoints

### `POST /api/auth/login`

Access: public

Body:

```json
{
  "email": "mostafa@tekronyx.com",
  "password": "Tekronyx@123"
}
```

Response includes `user`, `token`, `tokenType`, `expiresIn`.

### `GET /api/auth/me`

Access: authenticated

Response includes current `user`.

### `POST /api/auth/logout`

Access: public endpoint, clears auth cookie.

## Chat Endpoints

Controller: `backend/src/chat/chat.controller.ts`

All routes below require authentication.

### `GET /api/chat/conversations`

Returns conversation summaries visible to current user role.

### `GET /api/chat/:conversationId`

Returns metadata for a conversation.

### `GET /api/chat/:conversationId/messages`

Returns messages in ascending order.

### `POST /api/chat`

Body:

```json
{
  "conversationId": "optional",
  "message": "User question",
  "language": "en"
}
```

Returns:
1. `conversationId`
2. `reply`
3. `citations`
4. `complianceSummary`
5. optional `externalLinks`

### `POST /api/chat/evaluate`

Body:

```json
{
  "conversationId": "...",
  "controlId": "A.5.1",
  "language": "en"
}
```

Also supports full `control` context payload.

Returns structured evaluation and saved evaluation id.

### `DELETE /api/chat/:conversationId`

Behavior depends on role:
1. `MANAGER`: hides conversation for manager user
2. Others with access: deletes conversation and dependent records

## Upload Endpoints

Controller: `backend/src/upload/upload.controller.ts`

All routes below require authentication.

### Upload constraints

1. max files: `10`
2. max size per file: `15 MB`
3. allowed types: `pdf`, `docx`, `xlsx`
4. `kind=STANDARD` is disabled

### `POST /api/uploads`

Multipart upload endpoint.

Query params:
1. `conversationId` (required)
2. `kind` (default `CUSTOMER`)
3. `language` (`en` or `ar`, optional)

Form-data key: `files`

### `GET /api/uploads`

Query modes:
1. `?conversationId=<id>` list docs for conversation
2. `?all=true` list all docs accessible to current user
3. optional `kind`

### `GET /api/uploads/:id`

Returns one document detail payload.

### `GET /api/uploads/:id/download`

Downloads file binary.

### `DELETE /api/uploads/:id`

Deletes document and related resources.

### `PATCH /api/uploads/:id/status`

Access: manager/admin

Body:

```json
{
  "status": "REVIEWED"
}
```

Allowed: `REVIEWED`, `SUBMITTED`

### `PATCH /api/uploads/:id/match-status`

Access: manager/admin

Body:

```json
{
  "matchStatus": "COMPLIANT"
}
```

Allowed: `COMPLIANT`, `PARTIAL`, `NOT_COMPLIANT`, `UNKNOWN`

### `POST /api/uploads/:id/reevaluate`

Re-runs document-level AI analysis.

### `POST /api/uploads/submit`

Body:

```json
{
  "documentIds": ["..."],
  "controlId": "A.5.1",
  "status": "COMPLIANT",
  "note": "optional"
}
```

Allowed status: `COMPLIANT` or `PARTIAL`

## Ingest Endpoint

Controller: `backend/src/ingest/ingest.controller.ts`

### `POST /api/ingest/:documentId`

Access: authenticated with ownership checks for user role.

Runs extraction + chunking pipeline for one document.

## Dashboard Endpoint

Controller: `backend/src/dashboard/dashboard.controller.ts`

### `GET /api/dashboard`

Access: manager/admin only

Query params:
1. `framework`
2. `businessUnit`
3. `riskCategory`
4. `rangeDays`

Returns large aggregated payload including metrics, KPIs, trends, heatmaps, recommendations.

## Control KB Endpoints

Controller: `backend/src/control-kb/control-kb.controller.ts`

All routes require auth.

Access pattern:
1. Manager/admin: topics, frameworks, controls, assignments, activation, and test component routes
2. Any authenticated user: `catalog` and `context` routes
3. Mutating endpoints are mostly admin-only, except control activation which is manager/admin

### Frameworks

1. `GET /api/control-kb/frameworks`
2. `POST /api/control-kb/frameworks` (admin)
3. `PATCH /api/control-kb/frameworks/:id` (admin)
4. `DELETE /api/control-kb/frameworks/:id` (admin)

### Topics

1. `GET /api/control-kb/topics`
2. `POST /api/control-kb/topics` (admin)
3. `PATCH /api/control-kb/topics/:id` (admin)
4. `DELETE /api/control-kb/topics/:id` (admin)
5. `POST /api/control-kb/topics/:id/assign` (admin)

### Controls

1. `GET /api/control-kb/controls`
2. `GET /api/control-kb/controls/:id`
3. `POST /api/control-kb/controls` (admin)
4. `PATCH /api/control-kb/controls/:id` (admin)
5. `PATCH /api/control-kb/controls/:id/activation` (manager/admin)
6. `DELETE /api/control-kb/controls/:id` (admin)
7. `POST /api/control-kb/controls/:id/assign` (admin)
8. `POST /api/control-kb/controls/:id/topics` (admin)
9. `DELETE /api/control-kb/controls/:id/topics/:topicId` (admin)

### Test Components

1. `POST /api/control-kb/controls/:id/test-components` (admin)
2. `PATCH /api/control-kb/test-components/:id` (admin)
3. `DELETE /api/control-kb/test-components/:id` (admin)

### Catalog and Context

1. `GET /api/control-kb/catalog`
2. `GET /api/control-kb/context?controlCode=<code>`

Both routes are available to any authenticated role.

## Evidence Endpoints (V2)

Controller: `backend/src/evidence/evidence.controller.ts`

All routes require auth and `FEATURE_EVIDENCE_V2=true`.

### Evidence records

1. `GET /api/evidence`
2. `GET /api/evidence/:id`
3. `GET /api/evidence/review/inbox?bucket=pending|expiring|overdue`
4. `PATCH /api/evidence/:id/review` (manager/admin)
5. `POST /api/evidence/links` (manager/admin)
6. `DELETE /api/evidence/links/:linkId` (manager/admin)
7. `POST /api/evidence/backfill` (manager/admin)

### Evidence quality scoring

All quality routes require `FEATURE_EVIDENCE_QUALITY_V1=true`.

1. `GET /api/evidence/:id/quality`
2. `POST /api/evidence/:id/quality/recompute` (manager/admin, supports `Idempotency-Key`)

### Evidence requests

Controller: `backend/src/evidence/evidence-requests.controller.ts`

1. `GET /api/evidence-requests`
2. `POST /api/evidence-requests` (manager/admin)
3. `POST /api/evidence-requests/:id/fulfill`

## Control Status Endpoint

Controller: `backend/src/control-kb/control-kb.controller.ts`

1. `GET /api/control-kb/controls/:id/status`

Response includes banner-ready fields:

1. compliance status
2. evidence completeness
3. weak evidence count/list
4. per-component status and `why` explanation payload

## Settings Endpoints

Controller: `backend/src/settings/settings.controller.ts`

All routes require auth.

### Self settings

1. `GET /api/settings/me`
2. `PATCH /api/settings/notifications`
3. `PATCH /api/settings/ai`

### Team access

1. `GET /api/settings/team` (manager/admin)
2. `POST /api/settings/team/invite` (manager/admin, invite role restrictions by actor role)
3. `PATCH /api/settings/team/invites/:id/cancel` (manager/admin with policy checks)
4. `PATCH /api/settings/team/:userId/role` (admin)

## Error Format

Errors are normalized by global exception filter:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "...",
    "details": []
  }
}
```
