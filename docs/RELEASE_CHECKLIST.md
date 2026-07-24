# Release Checklist

**Snapshot:** 2026-07-23

## Executed in this environment

- [x] Repository contains no bundled Keen credential or live fixture under the deterministic scanner’s rules.
- [x] Private boot forces the connection screen.
- [x] Project ID and multiple explicitly typed/labeled key inputs are present.
- [x] Safe connection test uses one explicitly selected credential and does not silently broaden to Master.
- [x] Runtime mode resets to read-only on every app start.
- [x] Analytics, Dashboard, and Organization mutations have client-side runtime gates.
- [x] Public viewer uses a separate lazy bootstrap and does not import private workspace/vault modules.
- [x] Lock/workspace change has queued and active request cancellation paths.
- [x] Approved service origins are constrained to exact base paths; path traversal is rejected.
- [x] Filtered-delete scope is query-string only and empty scope is rejected.
- [x] Whole-collection deletion is a distinct client/UI path.
- [x] Maintenance scope is hash-locked and limited to one attempt per preview.
- [x] Request diagnostics preserve `/3.0` and redact Authorization/Access Key path values.
- [x] Responses use bounded streaming with a 150,000,000-byte application limit.
- [x] Oversized responses are non-retryable validation failures.
- [x] Dependency-light core self-test passed.
- [x] Static audit passed across 64 executable TypeScript/TSX files and 76 scanned text/code files.
- [x] TypeScript syntax transpilation reported zero diagnostics.
- [x] Internal TypeScript module-resolution check reported zero missing imports.
- [x] Renderer source reported zero Node built-in imports and zero plaintext web-storage paths.
- [x] Original specifications are copied into the repository.

## Defined but not executed here

- [ ] `npm install` completes and produces a reviewed lockfile.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes without release-blocking findings.
- [ ] `npm test` passes, including vault/IndexedDB, event-retry, client, query, dashboard, and URL tests.
- [ ] `npm run build` produces main, preload, private renderer, and isolated public renderer bundles.
- [ ] `npm run test:e2e` passes on supported platforms.
- [ ] Axe and keyboard-only checks pass across all editor/viewer routes.
- [ ] `npm run package` succeeds and signed/notarized platform artifacts are produced.
- [ ] Dependency audit and license report are reviewed.
- [ ] Dedicated relay SSRF/integration tests pass.

The configured npm gateway returned HTTP 503 and the public npm registry could not resolve in this environment, so these items remain genuinely unverified.

## Disposable-project live contracts

- [ ] Analytics schema and every analysis type are verified.
- [ ] Read, Write, Master, and restricted Access Key allow/deny behavior is verified.
- [ ] Saved-query CRUD/result/cache behavior is verified.
- [ ] Access Key option shapes and lifecycle are verified.
- [ ] Single/bulk write and partial-success response shapes are verified.
- [ ] Explicit failed-item retry is verified against current bulk response semantics.
- [ ] Synchronous and email extraction behavior/headers are verified.
- [ ] Dataset create/list/status/result/delete behavior is verified.
- [ ] Organization project list/get/create/update/delete behavior is verified.
- [ ] Dashboard-service CORS, key acceptance, metadata header/shape, body limits, public/private reads, and delete behavior are verified.
- [ ] Public restricted-key viewer works against a verified remote dashboard document.
- [ ] Mutations clean up only test-created resources.
- [ ] Destructive event/property/collection tests remain disabled unless the project is disposable and a second explicit gate is enabled.

## Product parity sign-off

- [ ] Every nested Explorer/filter/funnel property selector is schema-driven and type-aware, with manual fallback.
- [ ] Choropleth has an explicit reviewed GeoJSON mapping.
- [ ] SVG export is implemented or documented as intentionally excluded for release.
- [x] Saved-query display-name/tag search, tag/cache filters, observed-date sorting, and full-definition clone are present in source.
- [ ] Saved-query add-to-dashboard/share-definition workflows receive final UX and live-contract review.
- [ ] Public publish/regenerate/private/delete lifecycle is transactional and recoverable.
- [ ] Localization strings and RTL tests are complete.
- [ ] Cross-platform visual-regression screenshots are reviewed against public Keen workflow references without copying proprietary assets, trademarks, or account-only UI.

A release must not be called “perfect,” “complete parity,” or “server verified” while any relevant item above remains unchecked.

## Automated build and release gate

- [x] Every branch push, every non-reserved user tag push, pull request, and manual run executes the verification and native packaging workflow definition; generated `build-*` tags are deliberately excluded.
- [x] Every successful eligible branch push publishes a uniquely tagged continuous prerelease; Dependabot pushes build artifacts without attempting a read-only-token Release; every successful user tag push outside the reserved `build-*` namespace publishes from that tag; pull requests never publish.
- [x] Manual dispatch publishes an unsigned continuous prerelease for the selected commit and cannot replace or sign a version-tag Release.
- [x] Every non-reserved user-pushed tag publishes from that existing tag; `v*` tags must exactly match `v` plus the `package.json` version.
- [x] Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon package jobs use native GitHub-hosted runners.
- [x] Package filenames contain version, platform, and architecture and cannot collide during release assembly.
- [x] electron-builder implicit publishing is disabled with `--publish never`.
- [x] Only the final release job receives `contents: write`; verification and packaging remain read-only.
- [x] Continuous/version prereleases are never marked as the latest stable release.
- [x] Release publication waits for verification and all native package jobs.
- [x] A single resolved npm lock graph is shared with every native job inside a workflow run.
- [x] Third-party GitHub Actions are pinned to reviewed full commit SHAs.
- [x] Native manifests, aggregate source/build/signing metadata, and SHA-256 checksums are attached to every Release.
- [x] A rerun can replace an existing release only when both its Git tag and attached provenance manifest name the exact source commit being rebuilt.
- [x] Release helpers reject tag/version mismatches, missing or unexpected artifacts, path traversal, size mismatches, source-commit disagreement, and SHA-256 tampering in dependency-independent fixtures.
- [x] Generated-directory ignores are root-anchored; `.gitignore` cannot silently exclude a source subtree named `release`.
- [x] Release tooling is validated before dependency installation, and its self-test lives with the release scripts rather than depending on an optionally copied test subtree.
- [x] A generated npm lockfile is uploaded immediately after dependency installation so it can be recovered from a later failed run.
- [x] Non-production no-lock builds emit a notice; pushed `v*` releases require a committed reviewed lockfile before dependency installation.
- [x] Existing mutable Releases are rerun-safe through same-name asset replacement; immutable Releases fail clearly instead of silently diverging.
- [x] Signing credentials are scoped to matching-platform steps on actual pushed `v*` tags and remain optional; manual dispatch is always unsigned.
- [x] Unsigned macOS development builds do not attempt Developer ID signing or notarization; version builds enable signing/notarization only when the matching secrets are complete.
- [x] Continuous and non-version Release assembly rejects any package manifest that claims a signed state.
- [x] App Store Connect API-key material is written only to a mode-`0600` runner-temporary `.p8` outside the checkout and removed in a `finally` block.
- [x] macOS entitlements omit `allow-unsigned-executable-memory` for the Electron 35 application.
- [ ] The GitHub-hosted workflow has completed successfully in the destination repository.
- [ ] A reviewed `package-lock.json` is committed so the verification job also uses `npm ci` rather than its bootstrap fallback.
- [ ] Production macOS artifacts are signed and notarized, or the release prominently documents that they are unsigned.
- [ ] Production Windows artifacts are Authenticode-signed, or the release prominently documents that they are unsigned.
