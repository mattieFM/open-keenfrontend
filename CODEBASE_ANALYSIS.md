# Keen Key Console — Exhaustive Codebase Analysis

**Generated:** 2026-08-05  
**Project:** `keen-key-console-electron` v0.1.0  
**License:** MIT (unofficial, not affiliated with Keen.io)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Directory Structure](#4-directory-structure)
5. [Electron Main Process](#5-electron-main-process)
6. [Preload Bridge](#6-preload-bridge)
7. [Renderer Application](#7-render-application)
8. [Shared Types & Contracts](#8-shared-types--contracts)
9. [Library Modules](#9-library-modules)
10. [Feature Modules](#10-feature-modules)
11. [Security Model](#11-security-model)
12. [Credential & Vault System](#12-credential--vault-system)
13. [Dashboard System](#13-dashboard-system)
14. [Query & Analysis Engine](#14-query--analysis-engine)
15. [Build, Test & CI/CD Pipeline](#15-build-test--cicd-pipeline)
16. [Optional Relay Server](#16-optional-relay-server)
17. [Documentation Artifacts](#17-documentation-artifacts)
18. [Key Design Decisions & Invariants](#18-key-design-decisions--invariants)
19. [Known Limitations & Out-of-Scope](#19-known-limitations--out-of-scope)
---
## 1. Project Overview
Keen Key Console is an **unofficial, open-source Electron desktop application** that serves as a project-scoped API client for [Keen.io](https://keen.io/) analytics. It is designed for developers and analysts who possess a **Keen Project ID** and one or more **project keys** (Read, Write, Master, Access, Organization) but do **not** have a Keen account session or project membership.

### Core Identity

- **Not** an account portal clone — no login, SO, billing, team management, or password recovery.
- **Not** affiliated with or endorsed by Keen.io.
- A **local workspace** replaces the hosted organization/project picker; workspace names are explicitly local.
- Every launch starts at the connection screen (`#/connect`) in **read-only mode**. Mutations require explicit user opt-in per session.
- Includes a synthetic **offline demo workspace** for evaluation without live credentials.

### Supported Platforms
- Linux x64
- Windows x64
- macOS Intel (x64)
- macOS Apple Silicon (arm64)
### Requirements
- Node.js ≥ 22
- npm ≥ 10
- A supported Electron desktop platform
- A Keen Project ID and lawfully supplied key(s) for live use
---
## 2. Architecture

```
┌────────────────────────────────┐
│                   Electron Main Process                 │
│  ┌────────────────────────────────┐ │
│  │ • Approved-host/base-path validation                │ │
│ │ • Authorization header injection                    │ │
│  │ • Request cancellation / timeout / size controls    │ │
│  │ • Cookie / redirect / cache exclusion               │
│  │ • Native file open/save dialogs                     │
│  │ • Security headers (CSP, nosniff, no-referrer)     │ │
│  │ • Permission denial (camera, mic, geolocation)      │ │
│ └────────────────────────────┘ │
├────────────────────────────────┤
│                  Preload Bridge                        │
│  ┌────────────────────────────────┐ │
│  │ contextBridge.exposeInMainWorld('keenDesktop', …)   │ │
│  │ Typed DesktopBridge only — no generic IPC, no Node  │ │
│  └────────────────────────────────┘ │
├────────────────────────────────┤
│              Renderer (React SPA)                        │
│ ┌────────────────────┐ ┌────────────────┐ │
│  │  Private Bootstrap  │   Public Bootstrap      │
│  │ • Connect/Workspace │  │  • Restricted-key        │ │
│  │ • Credential Vault  │    dashboard viewer only │ │
│  │ • Analytics/Dash/   │  • No workspace/vault   │ │
│  │   Org clients       │  • Fixed HTTPS targets   │
│  │  • Scheduler        │  │                         │ │
│  │ • All editor/admin  │  │                          │ │
│  │    routes            │                          │
│  └──────────────┘  └──────────────────────────┘ │
└────────────────────────────────┘
``

### Process Boundary Enforcement

| Boundary | Rule |
|----------|------|
| Main → Network | Only validated HTTPS (HTTP localhost in dev), Authorization injected, cookies stripped, redirects rejected, persistent cache disabled |
| Main → Filesystem | Only via native `dialog.showOpenDialog` / `dialog.showSaveDialog`; renderer never receives arbitrary paths |
| Preload → Renderer | Fixed typed API via `contextBridge`; no generic IPC sender, no filesystem path, no shell command, no Node object |
| Renderer → Main | All network and file operations cross the typed preload boundary |
| Public Viewer | Separate lazy bootstrap; does not initialize workspace store, vault, or editor routes |
---
## 3. Technology Stack
### Runtime & Framework

| Layer | Technology | Version |
|-------|-----------|
| Desktop Shell | Electron | ^35.0 |
| Build Tool | electron-vite | ^3.1.0 |
| Bundler | Vite | ^6.0.5 |
| Language | TypeScript | 5.9.3 |
| UI Framework | React | ^18.3.1 |
| Routing | react-router-dom | ^6.28.1 (HashRouter) |
| State Management | Zustand | ^5.0.2 |
| Server State | @tanstack/react-query | ^5.62.8 |
| Database (Client) | Dexie (IndexedDB) | ^4.0.11 |
| Charts | ECharts + echarts-for-react | ^5.1 / ^3.0.2 |
| Dashboard Grid | react-grid-layout | ^1.5.0 |
| Forms | react-hook-form | ^7.54.2 |
| Validation | Zod | ^3.24.1 |
| Markdown | react-markdown + remark-gfm | ^9.0.1 / ^4.0 |
| HTML Sanitization | DOMPurify | ^3.2.3 |
| CSV Parsing | PapaParse | ^5.4.1 |
| Icons | lucide-react | ^0.468.0 |
| Resizable Panels | react-resizable | ^3.0.5 |

### Dev & Testing
| Tool | Version |
|---------|
| Vitest | ^2.1.8 |
| Playwright | ^1.49.1 |
| @axe-core/playwright | ^4.10.2 |
| @testing-library/react | ^16.1.0 |
| @testing-library/jest-dom | ^6.6.3 |
| ESLint (flat config) | ^9.17.0 |
| typescript-eslint | ^8.18.0 |
| jsdom | ^25.0.1 |
| fake-indexeddb | ^6.0.0 |
| tsx | ^4.19.2 |
| electron-builder | ^25.1.8 |

---

## 4. Directory Structure

``
open-keenfrontend/
├── apps/
│  └── optional-relay/server.ts          # Standalone hardened relay server
├── build/                                # Electron builder resources
│  ├── entitlements.mac.inherit.plist
│   └── entitlements.mac.plist
├── docs/                                  # Comprehensive documentation
│  ├── ADRs/0001-dashboard-persistence.md
│  ├── deployment/OPTIONAL_RELAY.md
│  ├── specifications/
│   │   ├── agent-prompt.md
│   │  └── research-brief.md
│   ├── ACCESSIBILITY.md
│   ├── API_CREDENTIAL_MATRIX.md
│   ├── ARCHITECTURE.md
│   ├── AUTOMATIC_DASHBOARDS.md
│   ├── BOOT_AND_READ_ONLY.md
│   ├── CI_*.md                           # Multiple CI hotfix docs
│   ├── DASHBOARD_*.md
│   ├── ENVIRONMENT.md
│   ├── FEATURE_STATUS.md
│  ├── GITHUB_ACTIONS_RELEASES.md
│   ├── RELEASE_CHECKLIST.md
│   ├── RELEASING.md
│   ├── SECURITY.md
│   └── THREAT_MODEL.md
├── scripts/                               # CI/build/release automation
│   ├── ci-install.mjs
│   ├── collect-release-artifacts.mjs
│   ├── package-ci.mjs
│   ├── prepare-ci-release.mjs
│   ├── release-pipeline-self-test.mjs
│   ├── static-audit.mjs
│   ├── validate-release-workflow.mjs
│  ├── verify-electron-bundle.mjs
│  └── verify-release-tag.mjs
├── src/
│  ├── main/index.ts                      # Electron main process
│   ├── preload/
│   │   ├── global.d.ts                    # Type declarations for window.kenDesktop
│   │  └── index.ts                       # Context bridge
│   ├── renderer/
│  │   ├── index.html
│  │   └── src/
│   │      ├── main.tsx                   # React entry point
│   │       ├── styles.css                # Global styles
│   │      ├── vite-env.d.ts
│  │       ├── app/
│  │       │  ├── App.tsx                # Private app router
│  │       │  ├── PublicApp.tsx          # Public viewer bootstrap
│   │       │   └── WorkspaceLayout.tsx    # Workspace shell/nav
│  │       ├── components/ui.tsx          # Shared UI primitives
│   │      ├── features/                 # Feature modules (see §10)
│   │      └── lib/                       # Library modules (see §9)
│   └── shared/
│       ├── types.ts                       # Shared type definitions
│       └── url.ts                         # URL validation & serialization
├── tests/                                 # Test suites
│  ├── setup.ts
│   ├── core/self-test.ts                 # Static invariant checks
│  ├── e2e/electron.spec.ts               # Playwright E2E
│   ├── live/                              # Live contract tests
│  │   ├── analytics.contract.test.ts
│   │   └── dashboard.contract.test.ts
│  └── unit/                              # Unit tests (14 files)
├── electron.vite.config.ts
├── eslint.config.js
├── package.json
├── playwright.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

## 5. Electron Main Process

**File:** `src/main/index.ts`

### Responsibilities

The main process owns **the only live network primitive** in the entire application. It enforces all security boundaries for HTTP communication and filesystem access.
### Network Request Handler (`keen:request`)

| Control | Detail |
|---------|--------|
| Host validation | Only pre-approved base URLs via `keen:approveHosts` |
| Protocol | HTTPS required; HTTP allowed only for localhost in unpackaged dev |
| Authorization | Injected from preload payload; never returned to renderer |
| Cookies | Stripped; `credentials: 'omit'` |
| Redirects | Rejected entirely |
| Cache | Persistent cache disabled |
| Body limit | 10.5 MB (`MAX_REQUEST_BYTES = 10_500_000`) |
| Response limit | 150 MB (`MAX_RESPONSE_BYTES = 150_000`) with streaming byte counter |
| Timeout | Default 310 seconds (`DEFAULT_TIMEOUT_MS = 310_000`) |
| Cancellation | `AbortController` tracked by opaque request ID; cancel via `keen:cancel` |
| Logging | Never logs URLs, headers, bodies, or credentials |
| Response types | Text (`rawText`) or binary (`binaryBase64`) |

### Response Streaming

Uses `ReadableStream` reader with incremental byte counting. Throws `ResponseLimitError` if declared `Content-Length` exceeds limit or accumulated bytes exceed limit during streaming. Properly cancels and releases the reader lock on error.

### Security Headers
Injected via `session.defaultSession.webRequest.onHeadersReceived`:

- **CSP:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'`
- **Referrer-Policy:** `no-referrer`
- **X-Content-Type-Options:** `nosniff`
- **Permissions-Policy:** `camera=(), microphone=(), geolocation=()`

### Window Configuration

- Size: 1500×960, min 1100×720
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`
- External links opened via `shell.openExternal` (HTTPS only)
- Navigation blocked except same-page
- Webviews prevented
- DevTools enabled only in development
### IPC Channels

| Channel | Type | Purpose |
|---------|------|---------|
| `app:version` | handle | Returns app version |
| `shell:openExternal` | handle | Opens HTTPS URLs externally |
| `file:saveText` | handle | Save text file via native dialog (mode 0o600) |
| `file:saveBinary` | handle | Save base64 binary via native dialog (mode 0o600) |
| `file:openText` | handle | Open text/JSON/CSV file via native dialog (size-limited) |
| `keen:approveHosts` | handle | Register 1–4 approved service host identities |
| `keen:cancel` | on (fire-and-forget) | Abort in-flight request by ID |
| `keen:request` | handle | Execute validated HTTP request |

---

## 6. Preload Bridge

**File:** `src/preload/index.ts`

Exposes a fixed, typed `DesktopBridge` interface via `contextBridge.exposeInMainWorld('keenDesktop', bridge)`.

### Bridge API

```typescript
interface DesktopBridge {
  getVersion(): Promise<string>;
  approveHosts(hosts: string[]): Promise<void>;
  request(payload: ApiRequestPayload): Promise<ApiBridgeResult>;
  cancel(requestId: string): void;
  saveText(input: { suggestedName: string; content: string }): Promise<{ saved: boolean; path?: string }>;
  saveBinary(input: { suggestedName: string; base64: string }): Promise<{ saved: boolean; path?: string }>;
 openText(): Promise<{ opened: boolean; path?: string; content?: string }>;
 openExternal(url: string): Promise<void>;
}
```

**No generic IPC sender, filesystem path, shell command, or Node object enters the renderer.**

---

## 7. Renderer Application

### Entry Points

| Bootstrap | Route Prefix | Purpose |
|-----------|-------------|---------|
| `App.tsx` | `/` (HashRouter) | Private editor/admin console |
| `PublicApp.tsx` | `/public/` | Restricted-key dashboard viewer |

### Private App Routes

| Path | Component | Description |
|------|-------------|
| `/` | → `/workspaces` | Redirect |
| `/connect` | `ConnectPage` | Workspace creation/connection |
| `/workspaces` | `WorkspacesPage` | Workspace list/selection |
| `/w/:workspaceId` | `WorkspaceLayout` | Workspace shell with nav |
| `/w/:workspaceId/` | `OverviewPage` | Workspace overview |
| `/w/:workspaceId/streams` | `StreamsPage` | Stream/collection list |
| `/w/:workspaceId/streams/:collection` | `StreamDetailPage` | Schema + recent events |
| `/w/:workspaceId/query/new` | `ExplorerPage` | New query |
| `/w/:workspaceId/query/:draftId` | `ExplorerPage` | Edit draft query |
| `/w/:workspaceId/saved-queries` | `SavedQueriesPage` | Saved query management |
| `/w/:workspaceId/dashboards` | `DashboardsPage` | Dashboard list |
| `/w/:workspaceId/dashboards/:id/view` | `DashboardViewerPage` | View dashboard |
| `/w/:workspaceId/dashboards/:id/edit` | `DashboardEditorPage` | Edit dashboard |
| `/w/:workspaceId/access-keys` | `AccessKeysPage` | Access key CRUD |
| `/w/:workspaceId/events/write` | `EventWriterPage` | Event writer |
| `/w/:workspaceId/extract` | `ExtractionsPage` | Data extraction |
| `/w/:workspaceId/backfill` | `BackfillPage` | Backfill workflow |
| `/w/:workspaceId/maintenance` | `MaintenancePage` | Maintenance operations |
| `/w/:workspaceId/datasets` | `DatasetsPage` | Dataset management |
| `/w/:workspaceId/settings` | `SettingsPage` | Workspace settings |

### Read-Only Gate
Every workspace loads in `read-only` mode. Remote mutations are rejected at two levels:
1. **UI gates** hide/disable mutation controls
2. **Client guards** in Analytics, Dashboard, and Organization clients reject mutations before IPC

To enable changes, user must type `ENABLE CHANGES` in the workspace mode control. Mode resets on lock/workspace change.

---

## 8. Shared Types & Contracts

**Files:** `src/shared/types.ts`, `src/shared/url.ts`

### Core Type Hierarchy

#### Credential Types
```typescript
type CredentialType = "read" | "write" | "master" | "access" | "organization";
type StorageMode = "memory" | "session" | "encrypted" | "plaintext";
type CapabilityState = "unknown" | "allowed" | "denied";
type RuntimeMode = "read-only" | "changes-enabled";
```

#### Operations (Capability Model)
```typescript
type Operation =
 | "schema.read" | "query.run" | "saved.result.read"
  | "saved.definition.read" | "saved.manage" | "dashboard.read"
 | "dashboard.manage" | "event.write" | "accessKey.manage"
  | "maintenance" | "dataset.read" | "dataset.manage"
  | "organization.manage";
```

#### Workspace Record
Contains: `id`, `localName`, `projectId`, `analyticsBaseUrl`, `dashboardBaseUrl?`, `dashboardServiceEnabled`, `organizationId?`, `credentials[]`, `capabilities{}`, `preferences{}`, `demo?`, timestamps.

Preferences include: `defaultTimezone`, `queryConcurrency`, `includeSchemaOnStreamList`, `dashboardPersistence` ("local" | "keen-service" | "hybrid"), auto-dashboard settings.

#### API Bridge Types
- `ApiRequestPayload`: requestId, baseUrl, path, method, authorization?, headers?, body?, responseType?, timeoutMs?
- `ApiBridgeResponse`: status, ok, headers, rawText?, binaryBase64?, elapsedMs
- `ApiBridgeResult`: Discriminated union `{ok: true, response}` | `{ok: false, error}`
- Error kinds: `network`, `abort`, `validation`

#### Query & Analysis Types
- `QueryDraft`: Full analysis parameter set including filters, group_by, order_by, interval, zero_fill, funnel steps, multi-analysis
- `KeenFilter`: Normal filter or OR-combined nested filters
- `FunnelStep`: event_collection, actor_property, timeframe?, filters?, optional?, inverted?
- `SemanticResult`: Discriminated union of scalar/grouped/interval/records/unique/funnel/multi/unknown

#### Dashboard Types
- `DashboardWidget`: Union of ChartWidget | TextWidget | ImageWidget | FilterWidget | DateRangeWidget
- `ChartWidget`: Ad-hoc query or saved query source, chart type, value format, table fallback
- `DashboardDocument`: schemaVersion 1, widgets[], layout[], settings{}, theme{}, metadata{}, revision tracking
- `DashboardLayoutItem`: Grid position (i, x, y, w, h, minW?, minH?)

#### Confidence Classification
```typescript
type ConfidenceClass =
 | "documented-api"    // Official Keen API docs
 | "documented-ui"     // Observed in Keen UI
  | "source-observed"   // Reverse-enginered from network traffic
  | "local"             // Pure client-side feature
 | "organization"      // Organization API
 | "hosted-only";      // Requires Ken account session
```

### URL Safety (`url.ts`)
- `normalizeBaseUrl()`: Validates protocol, strips credentials/hash/search, normalizes analytics path
- `validateApprovedTarget()`: Enforces approved base containment, prevents path traversal, rejects credentials in URLs
- `serializeDeleteEventsScope()`: Encodes filtered delete scope as query string (body is ignored by Keen); rejects empty scope
- `safeDisplayUrl()`: Redacts key values and api_key params for diagnostics
- `buildSafeCurl()`: Generates redacted curl command with `${KEEN_KEY}` placeholder

---

## 9. Library Modules

### `lib/api/` — API Clients

| File | Purpose |
|------|---------|
| `KeenClient.ts` | Primary Analytics API client; wraps preload bridge with credential routing, error normalization, retry bounds for safe reads |
| `DashboardServiceClient.ts` | Source-observed dashboard service client; separate credential/host handling |
| `OrganizationClient.ts` | Organization administration client; requires Organization Key |
| `credentialRouter.ts` | Selects appropriate credential for each operation based on capability model |
| `requestScheduler.ts` | Concurrency limiter with rate-limit backoff; respects `queryConcurrency` preference |
| `useWorkspace.ts` | React hook for active workspace context, runtime mode, credential access |

### `lib/db/` — Persistence
| File | Purpose |
|------|---------|
| `database.ts` | Dexie database definition; tables: workspaces, secrets, dashboards, queryDrafts, etc. |
| `workspaceStore.ts` | Zustand store backed by IndexedDB; manages workspace CRUD, runtime mode, initialization state |
### `lib/vault/` — Credential Vault

| File | Purpose |
|------|---------|
| `credentialVault.ts` | Encrypted credential storage/retrieval; PBKDF2-SHA-256 key derivation (310,000 iterations), AES-256-GCM encryption, random salt (16B) and IV (12B), memory-only map for runtime access |

### `lib/query/` — Query Processing

| File | Purpose |
|------|---------|
| `normalizer.ts` | Transforms raw Keen API responses into `SemanticResult` discriminated union |
| `queryClient.ts` | TanStack Query integration; cache keys, invalidation, prefetch strategies |
| `validation.ts` | Query parameter validation using Zod schemas |
| `csv.ts` | CSV export generation from query results |

### `lib/dashboard/` — Dashboard Engine

| File | Purpose |
|------|---------|
| `model.ts` | Dashboard document model operations; widget CRUD, layout management, revision tracking |
| `autoDashboard.ts` | Deterministic automatic dashboard generation per stream/event type; specialized session templates |
| `sharing.ts` | Public sharing logic; restricted Access Key creation, fragment-based viewer URL generation |
### `lib/security/` — Security Utilities

Redaction helpers, diagnostic sanitizers, safe display formatters.
### `lib/schema/` — Schema Processing

Stream/collection/property schema normalization and caching.
### `lib/maintenance/` — Maintenance Helpers

Filtered delete scope serialization, preview hash computation, confirmation flow utilities.

### `lib/demo/` — Demo Mode

Synthetic offline data generator for demo workspace; no network calls.

---

## 10. Feature Modules

All features reside in `src/renderer/src/features/`.

| Module | Pages/Components | Key Capabilities |
|--------|------------------|
| `connect/` | `ConnectPage` | Workspace creation, key entry, storage mode selection, safe schema test, host approval |
| `workspaces/` | `WorkspacesPage` | Workspace list, selection, deletion, locking |
| `overview/` | `OverviewPage` | Workspace summary, capability status, quick links |
| `streams/` | `StreamsPage`, `StreamDetailPage` | Collection list with search, full schema browsing, property details, bounded recent-event extraction |
| `explorer/` | `ExplorerPage` | 13 analysis types, visual filter builder (AND/OR/nested), funnel builder, raw JSON mode, result visualization, export |
| `savedQueries/` | `SavedQueriesPage` | Known-name result access, Master-key definition CRUD, metadata management |
| `dashboards/` | `DashboardsPage`, `DashboardEditorPage`, `DashboardViewerPage` | Full visual dashboard studio, guided chart queries, widget library, grid layout, themes, autosave/undo, import/export, keyboard alternatives, remote persistence opt-in |
| `accessKeys/` | `AccessKeysPage` | List/search/create/edit/clone-policy/revoke/unrevoke/delete; least-privilege templates |
| `eventWriter/` | `EventWriterPage` | Single/bulk event write, JSON/NDJSON/CSV import, byte counters, partial result display, zero automatic retry |
| `extractions/` | `ExtractionsPage` | Synchronous result/download, email extraction request |
| `backfill/` | `BackfillPage` | Backfill workflow management |
| `maintenance/` | `MaintenancePage` | Filtered delete, collection delete, property delete, update; SHA-256 scope lock, exact confirmation, one submission |
| `datasets/` | `DatasetsPage` | Create/list/get/results/delete (Early Release warning) |
| `organization/` | Organization admin components | Separate credential, project administration |
| `publicViewer/` | Public dashboard viewer | Fragment-based, restricted key, no workspace/vault access |
| `settings/` | `SettingsPage` | Workspace preferences, timezone, concurrency, persistence mode |
---
## 1. Security Model

### Defense-in-Depth Layers

1. **Electron Hardening**: sandbox, context isolation, no nodeIntegration, webSecurity enabled
2. **Network Isolation**: Only main process makes HTTP requests; renderer has no fetch/XHR to external hosts
3. **Host Approval**: User must explicitly approve 1–4 service hosts before any connection
4. **Path Containment**: Validated base-path prevents traversal outside approved service root
5. **Credential Isolation**: Keys never enter renderer as plaintext; Authorization injected in main
6. **Cookie/Redirect Exclusion**: No cookie forwarding, no redirect following
7. **Size Limits**: 10.5 MB request body, 150 MB response
8. **CSP**: Restrictive Content-Security-Policy with no external script sources
9. **Permission Denial**: Camera, microphone, geolocation always denied
10. **Sanitization**: DOMPurify for rich text; HTTPS-only images with no-referrer
1. **Read-Only Default**: Every boot starts read-only; mutations require explicit opt-in
12. **No Auto-Retry on Mutations**: Safe reads have bounded retries; writes/updates/deletes have none
13. **Filtered Delete Safety**: Dedicated serializer ensures scope is in URL (body ignored by Keen); empty scope rejected
14. **Diagnostic Redaction**: Keys redacted from URLs, logs, errors, copied commands
15. **Public Sharing**: Rejects Master/default Read/Write/Organization keys; requires dedicated restricted Access Key

### Threat Model Highlights

- Credentials are memory-only by default
- Encrypted persistence uses authenticated encryption (AES-256-GCM)
- No plaintext key in localStorage
- Locking clears decrypted keys, cancels requests, resets mode
- Optional relay is allow-listed, cookie-free, size-limited, SSRF-resistant
- Imported hosts require explicit approval
---
## 12. Credential & Vault System

### Storage Modes
| Mode | Storage | Persistence | Security |
|------|---------|-------------|----------|
| `memory` | Module-private Map | Process lifetime | Highest; nothing on disk |
| `session` | Module-private process memory | App session | High; cleared on app exit |
| `encrypted` | IndexedDB (AES-256-GCM) | Cross-session | Strong; PBKDF2-SHA-256, 310K iterations |
| `plaintext` | IndexedDB (unencrypted) | Cross-session | Development/debug only |

### Encryption Details

- **KDF:** PBKDF2 with SHA-256, 310,000 iterations
- **Cipher:** AES-256-GCM
- **Salt:** 16 bytes, cryptographically random per credential
- **IV:** 12 bytes, cryptographically random per encryption
- **Key Derivation:** From user passphrase (min 10 chars for encrypted mode)
- **Passphrase:** Never persisted; derived key exists only in memory during encrypt/decrypt
### Credential Lifecycle
1. **Entry:** Password inputs disable autocomplete; key type declared by user
2. **Storage:** Written to memory map + optionally to IndexedDB
3. **Use:** Passed to preload bridge → main injects as Authorization header; header never returned
4. **Lock:** Clears memory map; encrypted records remain but are inaccessible without passphrase
5. **Delete:** Removes encrypted record and local content; never deletes Ken project data
### Capability Routing

The `credentialRouter` selects the appropriate credential for each operation:

| Operation | Candidate Keys (priority order) |
|-----------|----------------------------|
| Schema read | schema Access → Read → Master |
| Analysis/extraction | query Access → Read → Master |
| Saved result | allowed saved/cached Access → Read → Master |
| Saved definition | query-definition Access → Master |
| Saved CRUD | Master |
| Dashboard read | Access → Read → Master |
| Dashboard remote write | Master |
| Event write | write Access → Write → Master |
| Access Key management | Master |
| Maintenance | Master |
| Dataset read | dataset Access → Read → Master |

---

## 13. Dashboard System
### Widget Types

| Widget | Description |
|-------------|
| `chart` | Ad-hoc or saved-query sourced visualization; 12 chart types |
| `text` | Safe Markdown content (sanitized via DOMPurify) |
| `image` | HTTPS-only image with alt text, fit modes, caption |
| `filter` | String filter widget targeting specific widgets; manual or query-sourced options |
| `date-range` | Timeframe selector targeting specific widgets |

### Chart Types
metric, gauge, line, area, bar, pie, donut, funnel, heatmap, bubble, choropleth, table

### Persistence Modes

| Mode | Description |
|-------------|
| `local` | IndexedDB only; full CRUD, import/export, autosave, undo |
| `keen-service` | Source-observed Ken dashboard service API (opt-in) |
| `hybrid` | Local primary with optional remote sync |

### Automatic Dashboards
Deterministic generation for every discovered stream and event type:
- Per-stream overview dashboard
- Per-event-type detail dashboard
- Specialized `slack_stream` session overview template
- `session_start` and `session_end` templates for documented `session.*` fields
- Customized documents are preserved during regeneration
- Protected template refresh prevents overwriting user modifications

### Layout System

- `react-grid-layout` for drag/resize grid
- Keyboard alternatives: explicit move and resize buttons
- Configurable: grid gap, background colors, tile radius, theme palette
- Responsive within min-width constraints

### Public Sharing

- Creates dedicated restricted Access Key
- Allow-list/filter policy on the key
- Fragment-based viewer URL (`#/public/...`)
- Bearer key removed from visible fragment after parsing
- Public viewer uses fixed HTTPS destinations; no host overrides

---

## 14. Query & Analysis Engine
### Supported Analysis Types

1. Count
2. Count Unique
3. Sum
4. Average
5. Minimum
6. Maximum
7. Median
8. Percentile
9. Select Unique
10. Standard Deviation
11. Extraction
12. Funnel
13. Multi-Analysis (advanced)

### Query Parameters
- Relative and absolute timeframes
- Timezone support
- Interval with zero-fill
- Nested filters (AND/OR groups)
- Group-by (single, multi, nested)
- Multiple ordering clauses
- Limits
- Raw JSON mode preserving unknown fields
- Request/response inspection
- Cancellation support
- Scheduling

### Result Normalization
All API responses are normalized into `SemanticResult`:
- `scalar`: Single numeric/string/boolean/null value
- `grouped`: Array of grouped records
- `interval`: Time-series data points
- `records`: Raw event records
- `unique`: Distinct value list
- `funnel`: Ordered step conversion counts
- `multi`: Named sub-analysis results
- `unknown`: Fallback for unrecognized shapes

### Export Formats

- CSV (via `csv.ts`)
- JSON (raw or normalized)
- Query definition (reproducible request)
- PNG/SVG (renderer-dependent, adapter-ready)

---

## 15. Build, Test & CI/CD Pipeline

### Scripts

| Script | Command | Purpose |
|--------|---------|
| `dev` | `electron-vite dev` | Development server with HMR |
| `build` | `typecheck && build:bundle` | Production build |
| `build:bundle` | `electron-vite build && verify-electron-bundle.mjs` | Bundle + verification |
| `preview` | `electron-vite preview` | Preview production build |
| `package` | `build && electron-builder --dir` | Unpacked app |
| `dist` | `build && electron-builder` | Platform installer |
| `dist:*` | Platform-specific dist commands | Linux/Windows/macOS targets |
| `test` | `vitest run` | Unit tests |
| `test:core` | `tsx tests/core/self-test.ts` | Static invariant checks |
| `test:e2e` | `playwright test` | End-to-end tests |
| `lint` | `eslint .` | Linting |
| `typecheck` | `tsc --noEmit` | Type checking |
| `ci:verify` | Full pipeline | Validate + test + lint + audit + typecheck + build |
| `relay` | `tsx apps/optional-relay/server.ts` | Start optional relay |
### CI/CD Workflow

**File:** `.github/workflows/electron-build-release.yml`

| Trigger | Behavior |
|---------|----------|
| Branch push | Verify + package 4 targets → continuous prerelease (`build-{run}-{sha}`) |
| Non-reserved tag push | Verify + package → versioned release |
| Pull request | Build artifacts only; no release publication |
| Manual dispatch | Unsigned continuous prerelease for selected commit |
| Dependabot push | Verify + package; no release (read-only token) |

### Release Artifacts
Each release includes:
- 8 platform installers/archives (Linux x64, Windows x64, macOS Intel, macOS ARM, each as installer + archive)
- 4 native-build manifests
- `release-manifest.json`
- `SHA256SUMS.txt`

### Signing

- Only pushed `v*` tags receive optional macOS signing/notarization and Windows Authenticode
- Branch, PR, non-version-tag, and manual builds are unsigned

### Automation Scripts

| Script | Purpose |
|--------|---------|
| `ci-install.mjs` | Deterministic dependency installation |
| `package-ci.mjs` | CI-specific packaging |
| `prepare-ci-release.mjs` | Release preparation |
| `collect-release-artifacts.mjs` | Artifact aggregation |
| `validate-release-workflow.mjs` | Workflow integrity check |
| `verify-release-tag.mjs` | Tag/version consistency |
| `verify-electron-bundle.mjs` | Bundle completeness check |
| `static-audit.mjs` | Static security/compliance audit |
| `release-pipeline-self-test.mjs` | Pipeline self-validation |

---

## 16. Optional Relay Server
**File:** `apps/optional-relay/server.ts`

A separately deployable hardened HTTP relay for scenarios where the Electron app cannot directly reach Keen services (e.g., CORS-restricted web deployments, public viewers).

### Security Properties

- Allow-listed target hosts only
- Cookie-free forwarding
- Size-limited proxying
- Redacted logging
- SSRF-resistant URL validation
- No credential storage; passes through Authorization header

---

## 17. Documentation Artifacts

| Document | Content |
|----------|---------|
| `ARCHITECTURE.md` | Process boundaries, security model, bootstrap separation |
| `SECURITY.md` | Security policy, vulnerability reporting, release blockers, secret lifecycle |
| `THREAT_MODEL.md` | Threat enumeration and mitigations |
| `FEATURE_STATUS.md` | Implementation status matrix (implemented/adapter/local/scaffolded/out-of-scope) |
| `API_CREDENTIAL_MATRIX.md` | Complete API endpoint → credential mapping with confidence classes |
| `BOOT_AND_READ_ONLY.md` | Startup behavior, read-only invariant, public viewer exception |
| `AUTOMATIC_DASHBOARDS.md` | Auto-dashboard generation rules and templates |
| `DASHBOARD_COMPATIBILITY.md` | Dashboard feature compatibility notes |
| `DASHBOARD_AUTOMATION_VALIDATION_2026-07-31.md` | Dashboard automation test results |
| `ACCESSIBILITY.md` | Accessibility features and compliance |
| `ENVIRONMENT.md` | Environment configuration |
| `RELEASING.md` | Release process documentation |
| `GITHUB_ACTIONS_RELEASES.md` | Complete CI/CD behavior specification |
| `RELEASE_CHECKLIST.md` | Pre-release verification checklist |
| `CI_HOTFIX_2026-07-24.md` | Source-tracking CI fix |
| `CI_POST_VITEST_HOTFIX_2026-07-24.md` | Post-Vitest build fix |
| `CI_RELEASE_VALIDATION_2026-07-23.md` | Release validation results |
| `CI_VITEST_VITE_TYPE_HOTFIX_2026-07-24.md` | Vitest/Vite type compatibility fix |
| `REVALIDATION_2026-07-23.md` | Revalidation results |
| `ADRs/0001-dashboard-persistence.md` | Architecture Decision Record for dashboard persistence |
| `deployment/OPTIONAL_RELAY.md` | Relay deployment guide |
| `specifications/agent-prompt.md` | AI agent prompt specification |
| `specifications/research-brief.md` | Research brief |
---
## 18. Key Design Decisions & Invariants

### Boot Invariant
Every private launch opens `/connect`, never the last workspace. This prevents stale credential use and ensures conscious workspace selection.

### Read-Only Invariant
Every workspace loads in read-only mode. The mode is runtime-only, never persisted. Mutations require explicit `ENABLE CHANGES` typing. Locking or switching workspaces resets to read-only and clears all sensitive state.

### No Mutating Probes
Connection testing uses exactly one read request (`GET /projects/{id}/events?include_schema=false`). No write, key-management, dashboard, dataset, organization, or maintenance capability is probed during connection.

### Filtered Delete Safety
Keen's filtered DELETE ignores the request body. All scope must be in the URL query string. The app's `serializeDeleteEventsScope()` is a security boundary that rejects empty scopes and encodes filters/timeframe/timezone as query parameters.

### Public/Private Separation
The public viewer (`PublicApp`) is a completely separate bootstrap that does not import workspace store, vault, or editor modules. It uses fixed HTTPS destinations and holds the restricted bearer key in module memory only.

### Credential Type Declaration
Key type is always explicitly declared by the user, never inferred from format or behavior. This prevents accidental privilege escalation.

### No Automatic Write Retry
Safe reads may retry within bounded limits. Mutations (writes, updates, deletes) never auto-retry to prevent duplicate events or unintended data modification.

### Dependency Policy
- Lock versions for releases
- No remote module, webviews, or renderer Node integration
- Bundled assets instead of runtime CDNs
- Review Electron, Markdown, chart, grid, and sanitizer updates as high-impact
---
## 19. Known Limitations & Out-of-Scope

### Out of Scope (by design)

- Keen sign-in, password recovery, SSO, profile, or account sessions
- Organization membership, invitations, roles, or complete team administration
- Billing, plans, invoices, or authoritative account usage
- Authoritative project display name/default keys/users from project keys alone
- Project provisioning without separately supplied Organization ID and Key
- Kafka TCP streaming (browser TCP Kafka intentionally absent)
### Scaffolded / Adapter Status

- **Datasets:** API-shaped workflows exist but carry Early Release warnings; live verification needed
- **Dashboard Service:** Source-observed routes behind opt-in; not officially documented API
- **Heatmap/Bubble/Choropleth charts:** Adapter names retained for compatibility; implementation status varies

### Platform Notes

- macOS signing/notarization and Windows Authenticode only available for `v*` tag releases
- DevTools disabled in packaged builds
- Spellcheck enabled by default

---

*This document was generated by exhaustive analysis of the source code, configuration files, test suites, and documentation artifacts present in the repository as of 2026-08-05.*