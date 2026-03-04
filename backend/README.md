# Backend (NestJS)

Backend service for the Compliance AI Platform.

It provides:
1. Authentication and role-aware access control.
2. Chat and control evidence evaluation APIs.
3. File upload, ingestion, and document-level compliance matching.
4. Control knowledge base and framework mapping APIs.
5. Dashboard aggregation APIs.
6. Personal settings and team-access management APIs.

## Stack

- NestJS 11
- Prisma 7 with SQLite
- better-sqlite3 adapter
- OpenAI Responses API integration

## Run Locally

### 1) Install

```bash
cd backend
npm install
```

### 2) Configure env (`backend/.env`)

Core:

```bash
PORT=3000
DATABASE_URL=file:./prisma/dev.db
JWT_SECRET=replace-in-production
JWT_EXPIRES_IN=8h
TEST_USERS_PASSWORD=Tekronyx@123
NODE_ENV=development
```

AI features:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
DISABLE_OPENAI_STORAGE=false
DISABLE_DB_INGEST=false
```

### 3) Sync schema

```bash
npm run db:sync
```

### 4) Start

```bash
npm run dev
```

## Authentication Model

- JWT-based auth.
- Token can be sent as:
  1. `Authorization: Bearer <token>` header
  2. `tekronyx_token` cookie
- Roles: `ADMIN`, `MANAGER`, `USER`.

Default users are auto-seeded on startup.

## Core Modules

1. `AuthModule`: login/logout/me, token verification, seeded users
2. `ChatModule`: conversation APIs, chat replies, evidence evaluation
3. `UploadModule`: upload/list/download/status/submit/reevaluate APIs
4. `IngestModule`: text extraction and chunk persistence
5. `ControlKbModule`: frameworks/topics/controls/mappings APIs
6. `DashboardModule`: KPI/risk/compliance aggregation
7. `SettingsModule`: personal settings and team access
8. `PrismaModule`: shared Prisma client service
9. `HealthModule`: service health endpoint

## API Summary

### Public

1. `GET /health`
2. `POST /api/auth/login`
3. `POST /api/auth/logout`

### Authenticated (`AuthGuard`)

1. Auth: `GET /api/auth/me`
2. Chat: `/api/chat/*`
3. Uploads: `/api/uploads/*`
4. Ingest: `/api/ingest/:documentId`
5. Dashboard: `GET /api/dashboard` (manager/admin only)
6. Control KB:
   - Manager/admin: topics, frameworks, controls, mutating routes
   - Any authenticated user: `catalog` and `context` endpoints used in chat flow
7. Settings: `/api/settings/*`

For complete endpoint details, use [docs/api-reference.md](../docs/api-reference.md).

## Upload and Ingestion Rules

- Accepted extensions: `.pdf`, `.docx`, `.xlsx`
- Max files per request: `10`
- Max file size: `15 MB`
- STANDARD uploads are disabled in current implementation.
- Text extraction is performed by file type:
  1. PDF: `pdf-parse`
  2. DOCX: `mammoth`
  3. XLSX: `xlsx`

## AI Integration Behavior

- Agent service uses OpenAI Responses API.
- Chat guidance is customer-evidence-centric.
- Control evaluation is a separate explicit endpoint.
- Document-level matching is run during upload/reevaluate.

## Database

- Primary schema: `backend/prisma/schema.prisma`
- DB URL default: `file:./prisma/dev.db`
- The service normalizes SQLite file URLs for local runtime paths.

Some settings tables are created at runtime through SQL in `SettingsService`:
1. `UserSettings`
2. `TeamInvite`

## Seeding

Default user seed is automatic via `AuthService` module init.

Control knowledge base seed script:

```bash
npm run seed:control-kb
```

With full reset:

```bash
npm run seed:control-kb -- --reset
```

This script reads `backend/data/control-kb/tekronyx_GRC_kb_v6_mappings.xlsx`.

## Testing

```bash
npm test
npm run test:e2e
```

Current tests are baseline smoke tests. See docs for suggested coverage expansion.

## Related Docs

1. [Project README](../README.md)
2. [Architecture](../docs/architecture.md)
3. [Backend Guide](../docs/backend-guide.md)
4. [API Reference](../docs/api-reference.md)
5. [Data Model](../docs/data-model.md)
