# ADR 0001: Local-First Dashboard Persistence

- **Status:** accepted
- **Date:** 2026-07-23

## Context

Keen documents Dashboard Creator behavior, while the exact storage routes and `X-Keen-Blob-Metadata` behavior are primarily source-observed in Keen-owned frontend code. Their current production compatibility, accepted key types, CORS, metadata exposure, conflict semantics, and size limits cannot be assumed without a disposable-project contract test.

## Decision

1. The internal `DashboardDocument` is versioned and persistence-independent.
2. IndexedDB is the default and always-available store.
3. The Keen-compatible dashboard service is isolated in `DashboardServiceClient` and opt-in per workspace.
4. UI components never import dashboard-service fetch details.
5. Remote failure never deletes or blocks the local document.
6. Public sharing is disabled as a completed workflow unless an HTTPS viewer deployment is supplied and the remote service has been contract-tested.
7. The packaged Electron `file://` application is not presented as a public iframe deployment.

## Consequences

- Users can build and recover dashboards without the source-observed service.
- Remote parity requires live validation and may vary by Keen deployment.
- A separately deployed public viewer is required for internet-facing links/iframes.
- Conflict protection is local revision/hash based until a server ETag or revision contract is verified.
