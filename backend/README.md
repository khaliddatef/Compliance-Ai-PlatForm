# Compliance AI Platform – Backend (NestJS)

Mocked API that mirrors the future OpenAI RAG/Agents pipeline. Provides chat, uploads, and health endpoints for the Angular client.

## Quick start

```bash
cd backend
npm install

# Dev watch
npm run dev

# Build
npm run build

# Production start (after build)
npm run start:prod
```

Environment:
- `PORT` (default: `3000`)
- `NODE_ENV` (default: `development`)

The server enables CORS for `http://localhost:4200` to allow the Angular app to call it directly.

## Endpoints

### Health
- `GET /health` → `{ "status": "ok", "timestamp": 1712345678901 }`

### Chat
- `POST /api/chat`
  ```json
  {
    "conversationId": "optional-uuid",
    "message": "How are we handling MFA and logging for finance?"
  }
  ```
  Response:
  ```json
  {
    "conversationId": "generated-or-provided",
    "reply": "text...",
    "citations": [
      { "doc": "ISO-27001.pdf", "page": 12, "snippet": "..." }
    ],
    "complianceSummary": {
      "framework": "ISO 27001",
      "status": "COMPLIANT",
      "missing": ["Quarterly access review evidence"],
      "recommendations": ["Refresh data flow diagrams...", "..."]
    }
  }
  ```

### Uploads
- `POST /api/upload` (multipart/form-data, field: `files`, accepts PDF/DOCX/XLSX, max 15MB each)
  Response:
  ```json
  {
    "uploaded": [
      { "originalName": "AccessPolicy.pdf", "storedName": "uuid.pdf", "size": 102400, "status": "UPLOADED" }
    ]
  }
  ```
- `GET /api/uploads` → `{ "uploaded": [ { "originalName": "...", "storedName": "...", "size": 12345, "status": "UPLOADED" } ] }`

Files are stored under `backend/uploads` with unique filenames.

## Client integration

- Angular base URL: `http://localhost:3000`
- Error shape (all endpoints): `{ "error": { "code": "BAD_REQUEST", "message": "...", "details": [...] } }`

## Notes

- Global validation pipe (class-validator) and error filter are enabled.
- Helmet for security headers, morgan for request logging, and ConfigModule for env management are configured.
- Conversations are stored in-memory only; restart clears history.
