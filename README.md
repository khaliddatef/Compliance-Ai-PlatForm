# Compliance AI Platform (Frontend)

Premium Angular 20 chat experience for a compliance assistant. Built with standalone components, CSS-only styling, and mock services for chat, compliance summaries, and document uploads.

## Getting Started

```bash
npm install
npm start   # runs ng serve on http://localhost:4200
```

Other scripts:
- `npm run build` – production build
- `npm test` – unit tests

## App Structure

- `src/app/app.routes.ts` – routes: chat (`/`) and documents (`/documents`), wrapped by `AppShellComponent`.
- Shell & layout: `components/app-shell`, `components/sidebar`.
- Chat experience: `pages/chat-page`, `components/chat-header`, `message-list`, `message-bubble`, `composer`.
- Compliance summary: `components/right-panel`, `standard-selector`.
- Documents workflow: `pages/documents-page`, `components/upload-dropzone`, `uploaded-files-list`.
- Services: `services/api.service.ts` (mock assistant + compliance), `chat.service.ts` (conversations + localStorage), `upload.service.ts` (mock progress + localStorage).
- Models: `models/` for messages, conversations, compliance results, and uploads.

## Mock / API Configuration

- Backend base URL placeholder lives in `src/app/services/api.service.ts` (`baseUrl` constant). Replace when wiring to a real API.
- Chat and compliance calls use RxJS `delay` to mimic latency; uploads simulate progress via `interval`.

## UI/UX Notes

- Light theme with CSS variables in `src/styles.css` (no Tailwind/SCSS).
- Responsive layout: collapsible sidebar, right-panel drawer on small screens, adaptive chat area.
- Assistant actions: copy, thumbs up/down (UI only), typing indicator, markdown-like bullets/citations rendering.
- Documents page: drag & drop or picker for PDF/DOCX/XLSX, status chips (Uploaded/Processing/Failed), removable entries.
- Accessibility: visible focus states, aria labels on controls, keyboard-friendly interactions.

## Development Tips

- Conversations and uploads persist locally via `localStorage`; clear storage to reset.
- Animations are CSS-based (transitions, subtle fades/slides).
- To add more standards or mock responses, extend `ApiService`.
