# Architecture

## Objectives

The application is a project-scoped Keen API console, not an account-portal clone. It must be useful with only a Project ID and explicitly supplied project credentials while preserving least privilege and making unsupported account functions visible as out of scope.

## Process boundary

### Electron main

`src/main/index.ts` owns the only live network primitive.

- validates HTTPS and approved base-path containment;
- allows HTTP only for localhost in unpackaged development;
- injects `Authorization` from the preload request payload;
- removes cookie headers and uses `credentials: omit`;
- rejects redirects;
- disables persistent cache;
- enforces body and timeout limits;
- tracks `AbortController` by opaque request ID;
- returns status, safe headers, elapsed time, raw text, or base64 binary;
- never logs request URLs, headers, bodies, or credentials.

It also owns file open/save dialogs so the renderer receives no arbitrary filesystem access.

### Preload

`src/preload/index.ts` exposes a fixed API through `contextBridge`. No generic IPC sender, filesystem path, shell command, or Node object enters the renderer.

### Renderer

The React renderer owns presentation and domain state. It cannot import Electron, Node filesystem, or native networking.

## Client boundaries

### Analytics client — documented API

`KeenAnalyticsClient` maps project routes for schema, queries, saved queries, event recording, Access Keys, maintenance, and datasets. Every path segment is encoded independently.

### Dashboard adapter — source-observed

`DashboardServiceAdapter` is a separate client with a separate host. It implements only the routes observed in Keen-owned Dashboard Creator source. The local dashboard model does not depend on this adapter.

### Organization client

Not enabled in this release. Organization keys are modeled separately so Master can never be treated as Organization credential. A future module must use a separate client and route namespace.

## Credential vault

Credential metadata is stored with the workspace. Plaintext lives only in a module-private in-memory map.

- **memory**: plaintext disappears when the app process closes or workspace locks;
- **session**: currently equivalent to app-process memory; it deliberately does not use browser session storage;
- **encrypted**: ciphertext is stored in IndexedDB with a random 128-bit salt and 96-bit IV. PBKDF2-SHA-256 derives a non-exportable AES-256-GCM key. The derived key is never persisted.

The app does not infer key type. Credential routing returns ordered candidates, and the selected credential remains visible to the user.

## Request lifecycle

1. Feature selects an operation and credential reference.
2. Renderer retrieves plaintext only from the unlocked in-memory vault.
3. A redacted request model is created before IPC.
4. Safe reads enter the workspace scheduler.
5. Main validates the base URL and relative path.
6. Main performs the request with cancellation and timeout.
7. Renderer parses JSON without discarding raw text.
8. HTTP and parse errors are normalized with a redacted request.
9. Capability observation changes only after an attempted user operation.

Safe reads retry at most twice after the initial attempt for network, `429`, or `503` failures. Mutations have one attempt.

## Scheduler

A scheduler is keyed by workspace ID, approximating Keen's project-level limits rather than treating each key as an independent quota.

- conservative concurrency (default 4);
- identical in-flight read deduplication;
- pause after `429`;
- cancellation propagation;
- no mutation queue retry.

Future work can add a separate extraction queue and cross-window `BroadcastChannel` coordination without transmitting credentials or results.

## Local data model

Dexie/IndexedDB stores:

- workspace metadata;
- encrypted credential records;
- query drafts and redacted history summaries;
- local dashboards;
- known saved-query name history;
- redacted maintenance audit entries.

Raw events, extraction bodies, and query results are not persisted by default.

## Query model

`QueryDraft` stays API-shaped and contains an index signature so unknown fields survive. Form controls and raw JSON edit the same model. Validation prevents known-invalid combinations but server validation remains authoritative.

Result normalization detects scalar, grouped, interval, interval plus group, raw records, unique arrays, funnel, multi-analysis, and unknown shapes. Raw response remains available regardless of normalization.

## Dashboard model

A dashboard document contains version, identity, widgets, layout, settings, theme, metadata, revision, and timestamps. Persistence is independent:

- local repository;
- source-observed remote adapter;
- hybrid local recovery plus remote publish.

Runtime filter/date widgets create a patched query copy and never mutate saved-query definitions or the stored source query.

## Destructive invariant

Filtered event deletion is built only through `serializeDeleteEventsScope`. The client method has no body argument. Empty scope is rejected before the request. Whole-collection deletion has a different client method and UI path.

Maintenance previews clone the exact scope, run count and extraction samples, hash canonical JSON with SHA-256, lock inputs, and compare the final hash immediately before one submission.

## Public viewer isolation

`/public/:projectId/:dashboardId` does not load workspace IndexedDB or credential-vault modules. It receives a restricted key, dashboard/analytics hosts, and remote document. The key is held in component memory and removed from the URL fragment with `history.replaceState`.

In a production public deployment, split the viewer into a separate bundle/origin for stronger storage and CSP isolation.
