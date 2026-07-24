# GitHub Actions desktop builds and releases

The desktop pipeline lives at `.github/workflows/electron-build-release.yml`. It verifies the source, builds Electron packages on native operating systems, validates every expected package, and attaches the packages to a GitHub Release.

## Trigger behavior

| Event | Verification | Native packages | GitHub Release |
|---|---:|---:|---:|
| Push to any branch | yes | all four targets | unique continuous prerelease |
| Push of any user tag except reserved `build-*` | yes | all four targets | release from the pushed tag |
| Pull request | yes | all four targets | no; workflow artifacts only |
| Manual dispatch | yes | all four targets | unsigned continuous prerelease for the selected commit |

A branch push or any manual dispatch receives a generated release tag:

```text
build-RUN_NUMBER-SHORT_SHA
```

A single push event creates a release for that event's head commit, even when the push contains several commits. Deleted refs are ignored. Runs are intentionally not cancelled when a newer push arrives because the requested policy is one releasable build per push event.

Tag behavior is deliberately strict:

- `v<package-version>` must exactly match `package.json` or verification fails.
- A normal version such as `v0.2.0` is eligible to become Latest.
- A prerelease version such as `v0.2.0-beta.1` is published as a prerelease.
- A non-`v` tag is also published as a prerelease from that existing tag.

Pull requests never receive `contents: write` and never publish Releases. A manual dispatch always uses the unsigned continuous path for the selected commit. Selecting an existing tag does not refresh, replace, or sign that tag's Release; only an actual pushed `v*` tag can enter the production-signing path. The `build-*` namespace is reserved for workflow-generated continuous releases and does not trigger this workflow.

## Verification gate

Before native packaging begins, the Ubuntu verification job runs:

1. the release-workflow structural validator;
2. the dependency-free release-pipeline self-test, including tag guards, native manifests, eight-package assembly, checksums, provenance, and tamper rejection;
3. ESLint;
4. deterministic boot/read-only and security invariants;
5. Vitest;
6. the static source/import/secret audit;
7. strict TypeScript checking and the Electron/Vite production build;
8. an Electron startup and Axe accessibility smoke test under Xvfb.

No Keen Project ID or API key is required by this pipeline.

## Dependency consistency

`npm run ci:install` uses `npm ci` whenever `package-lock.json` or `npm-shrinkwrap.json` exists. If neither has been committed yet, only the verification job falls back to `npm install --package-lock=true`. It then uploads the generated lock as a private, one-day workflow artifact.

The workflow-generated `build-*` tag namespace is excluded from the push trigger, preventing a continuous Release tag from starting a duplicate native build. Every native job downloads that same lock, rejects an artifact digest mismatch, and installs with `npm ci`. This gives one workflow run a single resolved dependency graph across Linux, Windows, Intel macOS, and Apple Silicon macOS.

The fallback is a bootstrap aid, not the production standard. Commit and review `package-lock.json` before publishing a production version.

## Native build matrix

| Runner | Build architecture | Attached packages |
|---|---|---|
| Ubuntu 24.04 | x64 | AppImage and Debian package |
| Windows Server 2025 | x64 | NSIS installer and ZIP archive |
| macOS 15 Intel | x64 | DMG and ZIP archive |
| macOS 15 Apple Silicon | arm64 | DMG and ZIP archive |

`electron-builder` runs only on the matching native operating system. The helper rejects cross-platform or falsely labelled architecture builds.

Expected package names are exact and collision-resistant:

```text
Keen-Key-Console-0.1.0-linux-x64.AppImage
Keen-Key-Console-0.1.0-linux-x64.deb
Keen-Key-Console-0.1.0-win-x64.exe
Keen-Key-Console-0.1.0-win-x64.zip
Keen-Key-Console-0.1.0-mac-x64.dmg
Keen-Key-Console-0.1.0-mac-x64.zip
Keen-Key-Console-0.1.0-mac-arm64.dmg
Keen-Key-Console-0.1.0-mac-arm64.zip
```

Each package job checks the exact names, minimum nontrivial size, native architecture, and SHA-256 digest before upload. It also records whether that target was `unsigned`, `signed`, or `signed-and-notarized`.

## Release assembly and integrity

The release job runs only after verification and every native package job succeed. It downloads the four package sets, requires exactly eight installers/archives and four platform manifests, and rejects:

- missing or duplicate targets;
- unexpected files;
- path traversal in manifest filenames;
- version, architecture, byte-count, source-commit, or digest mismatches;
- an invalid `v` tag/package-version pairing.

Every Release contains:

- eight desktop packages;
- four native-build manifests;
- `release-manifest.json` with source, workflow, package, architecture, signing, size, and digest data;
- `SHA256SUMS.txt` covering all packages and manifests.

`electron-builder` always receives `--publish never`. Only the final GitHub CLI step can publish release assets.

## Signing and notarization

Continuous, non-version-tag, pull-request, and manual-dispatch builds are always unsigned. Signing secrets are exposed only to matching-platform steps during an actual pushed `v*` tag event.

### Windows secrets

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

`WIN_CSC_LINK` may use an electron-builder-supported certificate file, URL, or base64 value. Without it, the NSIS installer and ZIP are still produced and recorded as unsigned.

### macOS certificate secrets

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`

Without a Developer ID certificate, DMG and ZIP packages are produced as unsigned and notarization is disabled. Unsigned packages keep hardened runtime disabled; when a certificate is configured, the packaging helper explicitly enables hardened runtime before signing and before any notarization attempt.

### macOS notarization credentials

Use either the Apple ID set:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

or the App Store Connect API key set:

- `APPLE_API_KEY_BASE64` — base64-encoded contents of the `.p8` private key;
- `APPLE_API_KEY_ID`;
- `APPLE_API_ISSUER`;
- `APPLE_TEAM_ID`.

The packaging helper validates and decodes `APPLE_API_KEY_BASE64` into a dedicated mode-`0600` `.p8` file beneath the GitHub runner's temporary directory, outside the source checkout. It passes that absolute path to electron-builder through `APPLE_API_KEY` and removes the temporary directory in a `finally` block after packaging, including failed packaging attempts. The key file is never copied into a workflow artifact or Release asset. If both credential methods are configured, the API-key method takes precedence and the Apple ID values are removed from the packaging process environment. A configured certificate without a complete notarization set produces a signed but unnotarized package.

Never place certificate material or passwords directly in source, workflow YAML, logs, or release assets.

## Permissions and action supply chain

The workflow default is:

```yaml
permissions:
  contents: read
```

Only the final `release` job requests `contents: write`. It uses the workflow-scoped `GITHUB_TOKEN` through GitHub CLI; no personal access token or third-party release action is required.

All external Actions are restricted to the official `actions/*` organization and pinned to reviewed 40-character commit SHAs. Dependabot checks npm and GitHub Actions updates weekly, but a maintainer must review and intentionally update each pin.

The repository or organization policy must allow the workflow's release job to request write access.

### One-time repository setup

In the destination repository:

1. Enable GitHub Actions for the repository.
2. Under Actions workflow permissions, allow the workflow-scoped `GITHUB_TOKEN` to receive write access when a job explicitly requests `contents: write`.
3. Keep fork pull-request approval and secret policies restrictive; pull requests do not need signing secrets.
4. Protect `v*` tag creation with a repository ruleset and restrict who can change release workflows before adding production signing credentials.
5. Add the optional platform signing secrets only when production signing is ready.
6. Commit a reviewed `package-lock.json`; the no-lock bootstrap is intentionally a temporary migration path.

No personal access token is required for normal Release creation.

## Creating a versioned release

1. Update `package.json` and the reviewed lockfile.
2. Commit and push the version change. That branch push creates a continuous prerelease.
3. Create and push the exact matching tag:

```bash
npm version 0.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: 0.2.0"
git tag -a v0.2.0 -m "Keen Key Console v0.2.0"
git push origin HEAD
git push origin v0.2.0
```

Use a version such as `0.2.0-beta.1` and tag `v0.2.0-beta.1` for a versioned prerelease.

## Reruns and immutable Releases

A rerun keeps the original `build-RUN_NUMBER-SHORT_SHA` tag. Before replacing any existing Release asset, the workflow first requires the existing Git tag to resolve to the current `GITHUB_SHA`, then downloads the attached `release-manifest.json` and requires its `sourceCommit` to match as well. Missing provenance, a moved tag, or either commit mismatch stops publication. A same-commit rerun may then replace same-named assets with `gh release upload --clobber` and refresh the title, notes, channel, and Latest state.

When GitHub immutable Releases are enabled and the Release has already been published, replacement is impossible by design. The workflow detects that condition and fails with a clear error instead of pretending the assets were refreshed.

Do not manually replace release packages. Use a workflow rerun for the exact same source commit or publish a new version.

## Local equivalents

Validate the workflow without installing dependencies:

```bash
npm run validate:release-workflow
npm run test:release
npm run ci:install -- --dry-run
```

Run the complete verification gate after dependencies are installed:

```bash
npm run ci:install
npm run ci:verify
npm run test:e2e
```

Package only on the matching native operating system:

```bash
npm run ci:package -- --platform linux --arch x64
npm run release:collect -- --platform linux --arch x64 --source release --output ci-artifacts
```

Valid packaging platform values are `linux`, `win`, and `mac`. Collector platform values are `linux`, `windows`, and `macos`.

Release assembly requires all four platform package sets, so it normally runs only in GitHub Actions.

## Release-volume policy

One Release per push is useful for development handoff but creates many tags and prereleases. Repository maintainers should define a retention policy for old `build-*` Releases and tags. Never delete versioned release tags as part of that cleanup.
