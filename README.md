# Compliance AI Platform

Compliance AI Platform is a full-stack GRC and cybersecurity compliance workspace.

It combines:
1. An Angular 20 frontend for chat, uploads, dashboard, control knowledge base, frameworks, and settings.
2. A NestJS backend with authenticated REST APIs.
3. Prisma + SQLite for persistence.
4. OpenAI Responses API integration for guidance, document matching, and control evidence evaluation.

## Tech Stack

- Frontend: Angular 20 (standalone components, zoneless change detection)
- Backend: NestJS 11
- Database: Prisma 7 + SQLite (better-sqlite3 adapter)
- AI integration: OpenAI Responses API

## Repository Layout

- `src/`: Angular app
- `backend/src/`: NestJS API
- `backend/prisma/`: Prisma schema and migrations
- `backend/scripts/`: Control KB seeding script
- `docs/`: Project documentation

## Quick Start

### 1) Install dependencies

```bash
npm run setup
```

This installs root dependencies and backend dependencies.

### 2) Configure environment

Backend reads env from `backend/.env`.

Required for AI features:

```bash
OPENAI_API_KEY=your_key_here
```

Recommended baseline:

```bash
PORT=3000
DATABASE_URL=file:./prisma/dev.db
JWT_SECRET=replace-in-production
JWT_EXPIRES_IN=8h
OPENAI_MODEL=gpt-4.1-mini
TEST_USERS_PASSWORD=Tekronyx@123
DISABLE_OPENAI_STORAGE=false
DISABLE_DB_INGEST=false
```

### 3) Sync database

```bash
npm run db:sync
```

### 4) Run the full stack

```bash
npm run start:all
```

Frontend runs on `http://localhost:4200`, backend on `http://localhost:3000`.

## Default Test Accounts

The backend seeds these users automatically on startup (password from `TEST_USERS_PASSWORD`):

1. `mostafa@tekronyx.com` (USER)
2. `wasamy.omar@tekronyx.com` (MANAGER)
3. `khaled@tekronyx.com` (ADMIN)

## Frontend Routes

Public:
1. `/login`

Authenticated:
1. `/home`
2. `/history`
3. `/history/:conversationId`
4. `/uploads`
5. `/uploads/:id`
6. `/settings`

Manager/Admin only:
1. `/dashboard`
2. `/frameworks`
3. `/framework-controls`
4. `/control-kb`
5. `/control-kb/:id`

Admin only:
1. `/framework-controls/assign-topic`
2. `/control-kb/assign`

## Key Workflows

### Chat workflow

1. User message is saved to conversation.
2. Backend retrieves top customer evidence chunks.
3. Agent generates a response.
4. Assistant message is saved and returned.

### Upload workflow

1. User uploads PDF/DOCX/XLSX files.
2. Backend saves files and extracts chunked text.
3. Document is analyzed and matched to likely controls.
4. Match status and recommendations are stored.

### Evaluation workflow

1. User triggers control evidence evaluation.
2. Backend evaluates uploaded evidence against control test components.
3. Result is persisted in `EvidenceEvaluation`.

### Dashboard workflow

1. Backend aggregates controls, docs, evaluations, and mappings.
2. Frontend displays KPIs, heatmaps, trends, and recommended actions.

## Scripts

Root scripts:

1. `npm run start`: Angular dev server
2. `npm run dev`: Angular dev with API proxy
3. `npm run start:all`: run frontend + backend together
4. `npm run setup`: install root + backend dependencies
5. `npm run db:sync`: run backend DB sync

Backend scripts:

1. `npm --prefix backend run dev`
2. `npm --prefix backend run build`
3. `npm --prefix backend run start:prod`
4. `npm --prefix backend run db:sync`
5. `npm --prefix backend run seed:control-kb`
6. `npm --prefix backend run test`

## Documentation Map

1. [Docs Index](docs/README.md)
2. [Architecture](docs/architecture.md)
3. [API Reference](docs/api-reference.md)
4. [Frontend Guide](docs/frontend-guide.md)
5. [Backend Guide](docs/backend-guide.md)
6. [Data Model](docs/data-model.md)
7. [Dashboard Response Notes](docs/dashboard-response.md)

## Notes

- `README.md` and `backend/README.md` were updated to reflect the current implementation.
- The old mock-oriented description is no longer accurate for the current codebase.
