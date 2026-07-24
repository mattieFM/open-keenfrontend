# Revalidation Report — 2026-07-23

## Why this report exists

An earlier delivery described the repository as broadly complete, but the first filesystem audit in this pass found only 11 files and unresolved imports for most claimed modules. This pass rebuilt the missing application structure and treats only observable source, deterministic checks, and explicitly identified test definitions as evidence.

## Specification baseline

The repository includes immutable copies of:

- `docs/specifications/agent-prompt.md`
- `docs/specifications/research-brief.md`

The implementation remains a project-key console. It does not imitate Keen account login, elevate supplied credentials, discover data outside the key’s scope, or claim parity with hosted-only billing/team/account features.

## Rebuilt scope

The current source includes:

- Electron main, preload, shared protocol/types, and private/public React bootstraps;
- startup connection, local workspace, encrypted credential-vault, and boot-time read-only flow;
- Streams, Explorer, saved queries, local/remote dashboards, Access Keys, event writer, extractions, maintenance, datasets, optional Organization Admin, settings, demo mode, and isolated public viewer;
- local-first dashboard model and separate source-observed Dashboard-service adapter;
- optional relay;
- unit, dependency-light core, Electron E2E/Axe, and opt-in live-contract test definitions;
- architecture, security, accessibility, environment, deployment, ADR, feature-status, and release documentation.

## Executed checks

### Dependency-light core self-test

Executed:

```bash
TS_NODE_TRANSPILE_ONLY=true node \
  --experimental-specifier-resolution=node \
  --loader /opt/nvm/versions/node/v22.16.0/lib/node_modules/ts-node/esm.mjs \
  tests/core/self-test.ts
```

Result:

```text
Core self-test passed: boot/read-only lock, explicit safe-test credential selection,
public bootstrap isolation, exact approved-base containment, URL redaction,
bounded response streaming, active request cancellation, one-attempt maintenance
arming, delete scope, query validation, funnel timeframe editing, sharing policy,
and internal imports.
```

### Static source audit

Executed:

```bash
TYPESCRIPT_PATH=/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript \
  node scripts/static-audit.mjs
```

Result:

```text
Static audit PASSED
- 64 executable TypeScript/TSX files
- 69 text/code files scanned
- 0 syntax diagnostics
- 0 unresolved internal imports
- 0 forbidden renderer Node imports
- 0 likely long secret literals
```

The same audit passed these source invariants:

- private launch forces `#/connect`;
- public viewer is lazy and separate from private workspace/vault bootstrap;
- loaded workspaces reset to `read-only`;
- Analytics mutations have a runtime-mode guard;
- maintenance permits only one attempt for an armed preview;
- active native requests are cancelled on workspace lock/change;
- Electron reads responses through a bounded stream;
- connection testing uses an explicitly selected credential and does not silently broaden to Master;
- renderer source contains no `localStorage`/`sessionStorage` credential path and no Node built-in import.

These are syntax, import, and invariant checks—not a substitute for TypeScript semantic checking, browser execution, Electron execution, or live API validation.

## Dependency installation result

The dependency install attempted during this pass did not create `node_modules` or `package-lock.json`. A final registry check produced:

```text
configured npm gateway: HTTP 503 Service Temporarily Unavailable
public npm registry:     EAI_AGAIN DNS resolution failure
```

The environment therefore could not execute or claim success for:

- `npm run typecheck`;
- `npm test`;
- `npm run lint`;
- `npm run build`;
- `npm run test:e2e`;
- Electron packaging/signing/notarization;
- dependency/license audit from an installed lock graph.

Run those commands in a networked build environment before release.

## Live Keen verification

No disposable Keen credentials were supplied. The read-only Analytics and Dashboard contract suites are present and skip without environment variables. No live schema/query, write, Access Key mutation, saved-query mutation, dashboard mutation, dataset mutation, Organization mutation, or destructive event test was executed.

The source-observed Dashboard service remains optional and isolated. Its current CORS behavior, accepted credential types, metadata shape/header behavior, limits, conflict semantics, public-key exposure, and delete behavior are not asserted as verified.

## Corrections and hardening completed in this pass

- private boot always presents the Project ID/key connection screen;
- every workspace session starts read-only and requires `ENABLE CHANGES` for that launch;
- safe connection testing uses one visibly selected key and never silently retries with a broader key;
- lock/workspace change clears credentials and query cache, cancels queued work, and aborts active native Analytics/Dashboard/Organization requests;
- approved custom hosts are bound to an exact origin and base path; traversal cannot escape `/3.0`;
- redacted diagnostics retain the legitimate `/3.0` path while hiding Authorization and Access Key path values;
- responses are stopped through bounded streaming before the 150,000,000-byte application limit is exceeded;
- oversized responses are non-retryable validation failures;
- filtered event DELETE cannot send a body or express an empty scope;
- whole-collection deletion is a separate code/UI path;
- maintenance final scope is hash-locked and can be submitted only once per preview;
- Explorer includes user-triggered stream/property suggestions, nested OR filters, multi-order clauses, shared/per-step funnel timeframes, and keyboard-operable funnel editing;
- result handling covers scalar, grouped, interval, record, unique, funnel, and multi-analysis shapes and refuses fake choropleth output without a real mapping;
- saved-query management includes display-name/tag search, tag/cache filters, A–Z/Z–A/observed-date sorting, full-definition cloning, and separate definition/result downloads;
- bulk event results expose an explicit one-time retry only for failed items that can be mapped unambiguously to the submitted payload;
- public viewer no longer initializes private workspace/vault state and accepts only the fixed Keen public service destinations in its direct-fetch path;
- packaged `file://` output is no longer represented as an internet-shareable iframe.

## Remaining parity and release gaps

The largest open items are tracked in `FEATURE_STATUS.md` and `RELEASE_CHECKLIST.md`. They include:

- dependency-backed semantic/type/lint/unit/E2E/accessibility/build/package verification;
- disposable-project contract tests for every key type and API surface;
- visual-regression review against publicly documented Keen project workflows without copying proprietary assets or account-only surfaces;
- fully schema-driven/type-aware controls in every nested query/funnel field;
- a reviewed GeoJSON mapping for choropleth and SVG chart export;
- transactional public publish/regenerate/private/delete recovery across Access Key and dashboard metadata operations;
- live Dashboard-service compatibility verification;
- localization string extraction and RTL automation;
- signed/notarized installers and platform smoke tests.

## Release conclusion

The repository is now a substantial, security-oriented implementation candidate with a deterministic boot/read-only safety baseline. It is not represented as a perfect visual copy, production-packaged release, or server-verified Keen replacement until the unchecked dependency, platform, accessibility, visual, and live-contract work is completed.
