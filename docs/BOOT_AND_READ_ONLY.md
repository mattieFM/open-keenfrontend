# Boot Connection and Read-Only Invariant

**Validated:** 2026-07-23

## Required startup behavior

Every private/editor launch begins at `#/connect`, regardless of the last workspace or route. The connection screen accepts:

- a local workspace alias;
- Keen Project ID;
- Analytics API host;
- optional Dashboard API host;
- optional Organization ID;
- one or more explicitly typed and labeled Read, Write, Master, Access, or Organization keys;
- memory, app-session, or passphrase-encrypted storage;
- an optional safe schema test.

The user explicitly selects which configured key performs the safe test. The app sends exactly one read request and does not silently retry with another or broader credential. Its result remains visible before the user opens the saved workspace.

The safe test is only:

```http
GET /3.0/projects/{PROJECT_ID}/events?include_schema=false
```

No write, key-management, saved-query mutation, dashboard mutation, dataset mutation, Organization mutation, or maintenance capability is probed during connection.

## Read-only on every boot

`workspaceStore.load()` sets every loaded workspace runtime mode to `read-only`. The mode is runtime state only and is never persisted as enabled.

Remote mutations are rejected in both places:

1. feature UI gates keep mutation controls behind the workspace mode;
2. Analytics, Dashboard, and Organization clients reject a mutation before IPC unless runtime mode is `changes-enabled`.

To enable remote changes for the current renderer launch, the user must open the workspace mode control and type:

```text
ENABLE CHANGES
```

Locking or changing workspace:

- returns the workspace to read-only;
- clears decrypted in-memory credentials;
- cancels queued reads;
- aborts active native Analytics, Dashboard-service, and Organization bridge requests for that workspace;
- cancels/clears TanStack Query state;
- clears secret-bound selections in the workspace shell.

Local-only actions such as editing an IndexedDB dashboard remain available in read-only mode because they do not change the Keen project.

## Public-viewer exception

A deep link beginning with `#/public/` loads a separate lazy `PublicApp` bootstrap. It does not initialize the private workspace store, editor routes, IndexedDB workspace repository, or credential vault. The restricted bearer key is held in module memory and removed from the visible fragment immediately after parsing.

The direct public-viewer transport is fixed to the default Keen Analytics and Dashboard HTTPS destinations. It does not accept arbitrary host overrides from a public URL.

## Deterministic checks

The core/static checks assert:

- private boot redirection contains `#/connect`;
- the connection source exposes explicit safe-test credential selection and no silent broadening;
- public and private app bootstraps are separate;
- the private app does not route the public viewer;
- the public app does not import workspace/vault modules;
- stored workspaces are reset to `read-only`;
- mutation clients contain the runtime-mode guard;
- queued and active workspace requests have cancellation paths.
