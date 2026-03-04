# Frontend Guide

## Frontend Stack

- Angular 20 standalone components
- Angular Router with route guards
- HttpClient with interceptors
- Signals-based local state in several services
- Zoneless change detection with manual tick scheduling after HTTP completion

## Application Boot

Entry files:
1. `src/main.ts`
2. `src/app/app.config.ts`
3. `src/app/app.routes.ts`

Key providers:
1. `provideRouter(routes)`
2. `provideHttpClient(withFetch(), withInterceptors([...]))`

Interceptors:
1. `authInterceptor`: always sets `withCredentials`
2. `changeDetectionInterceptor`: schedules `ApplicationRef.tick()` after requests

## Routing

### Public route

1. `/login`

### Authenticated routes

1. `/home`
2. `/history`
3. `/history/:conversationId`
4. `/uploads`
5. `/uploads/:id`
6. `/evidence`
7. `/settings`

### Manager/Admin routes

1. `/dashboard`
2. `/frameworks`
3. `/framework-controls`
4. `/control-kb`
5. `/control-kb/:id`

### Admin-only routes

1. `/framework-controls/assign-topic`
2. `/control-kb/assign`

Guards:
1. `requireAuthGuard`
2. `redirectAuthGuard`
3. `requireKbGuard`
4. `requireAdminGuard`

## Core Services

### `ApiService`

Location: `src/app/services/api.service.ts`

Responsibilities:
1. Defines API DTOs used by pages/services.
2. Encapsulates all HTTP calls to backend endpoints.
3. Provides typed wrappers for auth, chat, uploads, control KB, dashboard, and settings.

### `AuthService`

Location: `src/app/services/auth.service.ts`

Responsibilities:
1. Holds current user in a signal.
2. Lazily checks existing session with `/api/auth/me`.
3. Handles login/logout flow.

### `ChatService`

Location: `src/app/services/chat.service.ts`

Responsibilities:
1. Holds conversations and active conversation state.
2. Adds/removes messages in local state.
3. Loads conversation + messages + uploads and merges them for chat viewing.

### `LayoutService`

Location: `src/app/services/layout.service.ts`

Responsibilities:
1. Sidebar open/close state
2. Right-panel open/close state

## Main Pages

### `ChatPageComponent`

Location: `src/app/pages/chat-page/`

Responsibilities:
1. Handles message sending and attachment uploads.
2. Triggers control-aware prompt flow.
3. Shows action buttons (submit evidence, partial, fix, skip, reevaluate).
4. Calls `evaluateControl` when control flow is active.

### `DashboardPageComponent`

Location: `src/app/pages/dashboard-page/`

Responsibilities:
1. Loads dashboard payload.
2. Renders KPI cards, compliance donut, risk heatmap, trends.
3. Supports drilldown routing to KB/uploads pages.

### `UploadsPageComponent`

Location: `src/app/pages/uploads-page/`

Responsibilities:
1. Lists and filters all accessible uploaded documents.
2. Supports status changes (`REVIEWED`, `SUBMITTED`) for manager/admin.
3. Supports compliance-status override for manager/admin.
4. Supports upload from manager/admin UI panel.

### `EvidencePageComponent`

Location: `src/app/pages/evidence-page/`

Responsibilities:
1. Shows Evidence V2 list with quality badges and filters.
2. Shows inbox buckets (pending review, expiring soon, overdue requests).
3. Opens evidence detail drawer with quality breakdown/reasons/fixes.
4. Triggers quality recompute, link-to-control, and create-evidence-request actions.

### `UploadDetailPageComponent`

Location: `src/app/pages/upload-detail-page/`

Responsibilities:
1. Displays detailed evidence metadata and analysis.
2. Supports download, reevaluate, status updates, delete.
3. Navigates to matched control KB records.

### `ControlKbPageComponent`

Location: `src/app/pages/control-kb-page/`

Responsibilities:
1. Lists controls with pagination and advanced filters.
2. Supports admin create/update/delete operations.
3. Supports manager/admin control activation toggle.
4. Navigates to detail and assignment pages.

### `ControlDetailPageComponent`

Location: `src/app/pages/control-detail-page/`

Responsibilities:
1. Shows full control detail and test components.
2. Supports admin edits and deletion.
3. Marks active framework references for visual context.
4. Renders compliance status banner with weak evidence count and \"Why Partial/Fail\" panel.

### `FrameworksPageComponent`

Location: `src/app/pages/frameworks-page/`

Responsibilities:
1. Lists frameworks.
2. Supports admin create/update/delete/toggle enabled status.

### `FrameworkControlsPageComponent`

Location: `src/app/pages/framework-controls-page/`

Responsibilities:
1. Lists topics under framework context.
2. Supports admin topic/control creation/editing.

### `AssignControlPageComponent`

Location: `src/app/pages/assign-control-page/`

Responsibilities:
1. Assigns a control to framework with reference code.
2. Optionally sets/changes primary topic mapping.

### `AssignTopicPageComponent`

Location: `src/app/pages/assign-topic-page/`

Responsibilities:
1. Syncs topic controls from source framework to target framework.

### `SettingsPageComponent`

Location: `src/app/pages/settings-page/`

Responsibilities:
1. Edits notification settings.
2. Edits AI preferences.
3. Manages team invitations and roles (manager/admin, role edit admin-only).

### `ChatHistoryPageComponent` and `ChatViewerPageComponent`

Responsibilities:
1. List persisted backend conversations.
2. Open own conversation in chat page or view-only page when needed.

## UI Shell

- `AppShellComponent` handles responsive shell layout and route title.
- `SidebarComponent` adapts visible navigation by role.

## Styling

Global styles in `src/styles.css` define:
1. CSS variable theme tokens
2. typography and layout baseline
3. shared utility/skeleton styles
4. print behavior for dashboard export

## Notes

- There is a legacy `DocumentsPageComponent` using a mock `UploadService`; it is not part of active route configuration.
- Active uploads flow uses backend APIs through `ApiService`.
