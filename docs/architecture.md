# Architecture

## System Overview

Compliance AI Platform uses a single-repo architecture with:
1. Angular frontend (`src/`)
2. NestJS backend (`backend/src/`)
3. Prisma + SQLite persistence (`backend/prisma/`)
4. OpenAI Responses API integration for AI-assisted features

## High-Level Runtime

1. Frontend runs on `http://localhost:4200`.
2. Backend runs on `http://localhost:3000`.
3. Frontend API calls are proxied to backend in local development.
4. Backend stores business data in SQLite.
5. Backend optionally uploads files to OpenAI vector storage.

## Main Components

### Frontend

1. Routing and guards in `src/app/app.routes.ts`
2. Auth/session state in `src/app/services/auth.service.ts`
3. API client contracts in `src/app/services/api.service.ts`
4. Chat state orchestration in `src/app/services/chat.service.ts`
5. Feature pages under `src/app/pages/*`

### Backend

1. Platform bootstrap in `backend/src/main.ts`
2. Module composition in `backend/src/app.module.ts`
3. Global error formatting via `HttpExceptionFilter`
4. Auth guard used by protected controllers

## Request Lifecycle

1. Frontend sends request with credentials (`withCredentials=true`).
2. Backend `AuthGuard` extracts bearer token or cookie.
3. Backend route handler performs role/resource checks.
4. Service layer executes domain logic.
5. Prisma persists/fetches data.
6. Optional AI or file-storage calls are executed.
7. Normalized JSON response returns to frontend.

## Core Functional Flows

### Chat Flow

1. `POST /api/chat` receives message.
2. Message is saved to `Conversation` and `Message`.
3. Relevant `DocumentChunk` evidence is retrieved.
4. Agent generates structured response.
5. Assistant message is saved and returned.

### Upload Flow

1. `POST /api/uploads` receives multipart files.
2. Files are saved on disk.
3. `IngestService` extracts and chunks text into `DocumentChunk`.
4. Agent analyzes document and sets match metadata.
5. Optional OpenAI file/vector-store attachment is performed.

### Control Evaluation Flow

1. Frontend requests `POST /api/chat/evaluate`.
2. Backend resolves control context from Control KB.
3. Relevant customer evidence chunks are retrieved.
4. Agent returns control-level evaluation.
5. Result is stored in `EvidenceEvaluation`.

### Dashboard Flow

1. `GET /api/dashboard` aggregates controls, docs, and evaluations.
2. Service computes KPIs, trends, heatmaps, and recommendations.
3. Frontend renders interactive drilldown cards.

## Security and Access Model

Roles:
1. `USER`
2. `MANAGER`
3. `ADMIN`

Enforcement:
1. Route-level checks in frontend guards.
2. API-level checks in backend controller/service logic.
3. Ownership checks for user-bound conversations and files.

## Persistence Model

Primary entities:
1. `User`
2. `Conversation`
3. `Message`
4. `Document`
5. `DocumentChunk`
6. `EvidenceEvaluation`
7. Control KB domain entities (`ControlDefinition`, `ControlTopic`, `Framework`, mappings)

See [data-model.md](data-model.md) for details.

## Configuration and Environment

Main backend env variables:
1. `PORT`
2. `DATABASE_URL`
3. `JWT_SECRET`
4. `JWT_EXPIRES_IN`
5. `TEST_USERS_PASSWORD`
6. `OPENAI_API_KEY`
7. `OPENAI_MODEL`
8. `DISABLE_OPENAI_STORAGE`
9. `DISABLE_DB_INGEST`

## Known Documentation Notes

Legacy mock-oriented notes in older READMEs have been replaced by implementation-aligned docs.
