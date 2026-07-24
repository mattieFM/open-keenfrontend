# CI hotfix — post-Vitest typecheck, bundle, and Electron startup

**Date:** 2026-07-24

## Failure boundary

The supplied Actions excerpt shows that release validation, the release-pipeline self-test, ESLint, the dependency-light core test, and Vitest all completed successfully. The excerpt ends immediately after Vitest and does not contain the first diagnostic from the following static-audit, TypeScript, Electron bundle, or Playwright/Axe stage.

The source was therefore re-audited from the first command after Vitest through Electron startup. The following deterministic blockers and weak diagnostics were corrected.

## Corrections

### TypeScript 5.9 BufferSource compatibility

TypeScript is pinned exactly to `5.9.3` while the repository has no reviewed lockfile. Credential-vault byte arrays and streamed response chunks now use explicit `Uint8Array<ArrayBuffer>` views. Base64 decoding allocates an ArrayBuffer-backed view rather than returning a broadly typed `ArrayBufferLike` view.

### Host approval IPC completed

The preload and renderer already invoked `keen:approveHosts`, but the main process had no matching handler and did not pass the approved-base set into request validation. The main process now:

- accepts one to four explicit hosts;
- validates every host before replacing the approval set;
- records exact origin plus base-path identities;
- applies that set to every API request;
- returns target-validation failures as non-retryable validation errors rather than network errors.

### Sandboxed preload made CommonJS

The private window remains sandboxed and context-isolated. The preload build is now one self-contained CommonJS file named `out/preload/index.cjs`, and the main process points to that exact file. A post-build verifier rejects:

- a missing main, preload, or renderer entry;
- a main bundle that points elsewhere;
- ESM imports or exports in the sandboxed preload;
- a preload that does not use `require('electron')` and `contextBridge`;
- source-mode renderer HTML;
- multiple executable preload chunks.

### Accessibility smoke-test contrast

Muted text and primary-button colors now meet a 4.5:1 contrast floor against white. Text rendered over the connection-page gradient is opaque white, including its small footer and brand label. The hero is a named landmark, and the Linux verification image explicitly installs both `xvfb` and `xauth`. These conditions are enforced by the dependency-light workflow, static, and core checks before Playwright/Axe runs.

### Action diagnostics split by stage

The previous hosted command hid static audit, semantic typecheck, bundle, and Electron startup behind one `npm run ci:verify` step. The workflow now exposes separate steps for:

1. release-pipeline fixtures;
2. lint;
3. core invariants;
4. Vitest;
5. static audit;
6. TypeScript 5.9 semantic checking;
7. Electron bundle generation and bundle-contract verification;
8. Electron startup and Axe.

Every stage uses `set -o pipefail` and writes a log under `ci-logs/`. A failed verification job uploads those logs as `verification-logs-<run-id>-<attempt>`.

## Added regression gates

- TypeScript is exact-version pinned until a reviewed lockfile is committed.
- Release workflow validation rejects a hidden monolithic hosted verification command.
- Release fixtures verify a valid CommonJS preload and reject an ESM preload.
- Static audit scans `.d.ts` imports as well as executable TypeScript.
- Static and core tests verify Web Crypto buffer types, response chunk types, host approval wiring, preload output, bridge declaration resolution, and connection-page contrast.

## Local validation scope

Dependency-independent workflow validation, release fixtures, static source/import/security auditing, core invariants, JavaScript syntax checking, and patch/ZIP integrity are run for this hotfix. The local environment does not have the project dependency graph and cannot reach the npm registry, so the real dependency-backed ESLint, TypeScript 5.9 compiler, electron-vite bundle, authentic Electron launch, Playwright/Axe run, and native package matrix remain for GitHub-hosted execution.
