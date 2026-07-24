# Build and release automation

The Electron application is built by `.github/workflows/electron-build-release.yml`. The complete trigger, runner, permission, signing, and recovery behavior is documented in [GitHub Actions desktop builds and releases](GITHUB_ACTIONS_RELEASES.md).

## Release channels

### Continuous prerelease

Every successful branch push creates a unique prerelease after verification and all four native package jobs pass:

```text
build-RUN_NUMBER-SHORT_SHA
```

These builds are intended for development handoff and validation. They are unsigned, never marked Latest, and identify the exact source commit and workflow run in their manifest.

Every manual dispatch uses this same unsigned continuous channel for the selected commit. Selecting an existing tag does not refresh, replace, or sign that tag's Release; only an actual pushed `v*` tag can enter the production-signing path.

### Tag release

Every user tag push outside the reserved workflow-generated `build-*` namespace is packaged and released from that existing tag. A tag beginning with `v` must exactly equal `v` plus the version in `package.json`:

```bash
npm version 0.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: 0.2.0"
git tag -a v0.2.0 -m "Keen Key Console v0.2.0"
git push origin HEAD
git push origin v0.2.0
```

A normal semantic version becomes the stable/Latest Release. A suffix such as `-beta.1` produces a versioned prerelease. Non-`v` tags are also prereleases.

## Release contents

A successful Release contains:

- Linux x64 AppImage and Debian package;
- Windows x64 NSIS installer and ZIP;
- macOS Intel DMG and ZIP;
- macOS Apple Silicon DMG and ZIP;
- one integrity/signing manifest per native target;
- aggregate `release-manifest.json`;
- `SHA256SUMS.txt`.

The final job refuses to publish until all eight package filenames, native architectures, sizes, source commits, and SHA-256 digests agree. Artifact filenames contain version, platform, and architecture, so downloads from separate jobs cannot overwrite one another during assembly.

## Required pre-release checks

Before pushing a production tag:

1. Commit and review `package-lock.json`.
2. Complete `docs/RELEASE_CHECKLIST.md`.
3. Run `npm run ci:verify` from a clean checkout where possible; its first stages validate the workflow and exercise release assembly with synthetic packages.
4. Confirm the previous continuous Release installs on intended platforms.
5. Configure signing/notarization secrets or plan to state clearly that packages are unsigned.
6. Verify the published files against `SHA256SUMS.txt`.
7. Confirm the release manifest points to the intended commit.

## Reruns

Continuous reruns reuse the original run/commit tag. Before a mutable Release is refreshed, the workflow confirms that the existing Git tag still resolves to the commit being rebuilt and that the attached `release-manifest.json` names that same `sourceCommit`. A moved tag, missing manifest, or either mismatch blocks replacement. A repository with immutable Releases enabled will reject replacement after publication; create a new version rather than disabling immutability.

Do not manually upload replacement binaries. Workflow manifests and checksums are generated from the package jobs and are part of the release trust boundary.

## Signing secrets

See [the Actions guide](GITHUB_ACTIONS_RELEASES.md#signing-and-notarization) for exact secret names and accepted credential sets. Secrets are available only to the matching platform's package step during an actual pushed `v*` tag event. Pull requests, manual dispatches, branch pushes, non-version tags, Linux jobs, and release metadata jobs receive no certificate secrets.

## Dependency lock

The workflow can bootstrap without a committed lockfile, but that is migration convenience rather than a production standard. The verification job shares its generated lock with all native jobs for within-run consistency. Commit the reviewed lock as soon as npm access is available:

```bash
npm install
npm run ci:verify
git add package-lock.json
git commit -m "chore: add reviewed npm lockfile"
```

## Cleanup of continuous Releases

The one-release-per-push policy intentionally creates many `build-*` prereleases and tags. Automate cleanup only for old `build-*` entries and preserve all versioned tags and Releases.
