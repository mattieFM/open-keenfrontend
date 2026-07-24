# CI and Release Pipeline Validation — July 23, 2026

This report records what was validated locally for `.github/workflows/electron-build-release.yml` and what still requires execution in the destination GitHub repository.

## Passed locally

The dependency-free checks passed against the delivered source tree:

- release workflow structural validation: **10 immutable action pins** and **4 native package targets**;
- synthetic release pipeline: exact version-tag, channel, and signing guards; native artifact collection; **8 package files**; **4 native manifests**; aggregate provenance; **13 SHA-256 entries**; manifest identity checks; tamper detection; and unexpected-input rejection;
- static application audit: **64 TypeScript/TSX executable files**, **76 text/code files**, zero syntax diagnostics, zero unresolved internal imports, zero forbidden renderer Node imports, and zero likely long secret literals;
- JavaScript syntax checks for every release helper and release test;
- YAML parsing of all three workflow jobs;
- Bash syntax parsing for all 14 Bash/default-Linux workflow command blocks.

The workflow validator also enforces the following source invariants:

- all source branches and all non-reserved user tags are push triggers;
- generated `build-*` tags cannot retrigger the workflow;
- pull requests are build-only and manual dispatches are unsigned continuous builds;
- only the final release job receives `contents: write`;
- production signing is limited to actual pushed `v*` tags, and continuous/non-version release assembly rejects signed-state manifests;
- Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon packages use native runners;
- `electron-builder` cannot publish directly;
- App Store Connect API-key data is materialized only as a mode-`0600` runner-temporary `.p8` outside the checkout, passed as a path, and deleted in a `finally` block;
- macOS entitlements omit the unnecessary `allow-unsigned-executable-memory` capability;
- release publication waits for verification and every native package;
- dependency-lock artifacts and native package artifacts fail on digest mismatch;
- an existing mutable Release can be refreshed only when both its Git tag and attached provenance manifest resolve to the exact source commit.

## Dependency-lock status

No `package-lock.json` is present in this source snapshot. An offline package-lock-only install was attempted, but the npm cache contained no registry metadata and returned `ENOTCACHED` for `@axe-core/playwright`.

The workflow therefore has a bootstrap path: its verification job generates one lock graph and shares that exact graph with all four native jobs. This is within-run consistency, not a substitute for a reviewed committed lockfile. A reviewed `package-lock.json` remains required before treating a versioned build as production-ready.

## Not executed in this environment

The following require npm registry access and/or real GitHub-hosted operating systems and were not claimed as passing here:

- dependency installation;
- TypeScript semantic checking, ESLint, Vitest, or Electron/Playwright execution with installed dependencies;
- real AppImage, DEB, NSIS, ZIP, or DMG creation;
- Windows Authenticode signing;
- macOS Developer ID signing and Apple notarization;
- an actual GitHub Actions run, artifact transfer, or GitHub Release publication.

The first destination-repository run should remain a release gate. Confirm all four native jobs, inspect the attached manifests and signing states, verify `SHA256SUMS.txt`, and install-test each intended platform package before promoting a stable tag.
