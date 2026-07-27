# Keen Key Console

An unofficial, open-source Electron console for a developer or analyst who has a Keen **Project ID** plus one or more project keys, but does not have a Keen account session or project membership.

The application is a project-scoped API client. It does not imitate Keen login, bypass authorization, discover credentials, or reproduce account-only billing/team surfaces.

> This project is not affiliated with or endorsed by Keen.io. The UI follows the functional patterns of Keen’s documented project tools while using original source, styling, and assets.

## Startup behavior requested for handoffs

Every private launch opens the connection screen, not the last project page. It asks for:

- workspace name on this device;
- Keen Project ID;
- Analytics host and optional Dashboard host;
- one or more explicitly typed Read, Write, Master, Access, or Organization keys;
- credential storage mode;
- optional Organization ID;
- optional safe read-only schema test.

Every workspace starts in **read-only mode on every boot**. To permit any remote event write, resource mutation, key operation, dashboard publish, dataset change, Organization change, or maintenance request for that launch, the user must type:

```text
ENABLE CHANGES
```

The mode is not persisted. Locking or changing workspace returns to read-only and clears decrypted credentials, queued reads, and query-cache state. See [Boot and read-only invariants](docs/BOOT_AND_READ_ONLY.md).

## Implemented project-data workflows

The source includes:

- Streams/schema browsing and bounded recent-event extraction;
- Data Explorer for count, count unique, sum, average, minimum, maximum, median, percentile, select unique, standard deviation, extraction, funnel, and advanced multi-analysis;
- relative/absolute timeframes, timezone, interval, zero fill, nested filters/OR, grouping, multiple ordering clauses, limits, raw JSON, request/response inspection, cancellation, and scheduling;
- scalar/group/interval/record/funnel/multi-analysis normalization;
- metric, gauge, line, area, bar, pie, donut, funnel, heatmap, bubble, and table output with textual/table fallbacks and PNG/CSV/JSON export;
- known-name saved-query result access plus Master-key definition management;
- local-first dashboards with chart, safe Markdown, HTTPS image, string-filter, and date-range widgets;
- pointer and keyboard dashboard layout controls, local autosave/undo/import/export, and optional source-observed remote persistence;
- Access Key list/create/edit/clone-policy/revoke/unrevoke/delete flows and least-privilege templates;
- single/bulk event writer with JSON/NDJSON/CSV import, payload limits, partial-item status display, and zero automatic write retry;
- synchronous and email extraction workflows;
- guarded maintenance with count/sample preview, canonical SHA-256 scope lock, exact confirmation, one submission, and a dedicated query-string-only filtered-delete serializer;
- Early Release cached dataset workflows;
- separately credentialed optional Organization project administration;
- a synthetic offline demo workspace;
- an optional hardened relay for separately hosted web/public-viewer deployments.

A detailed, honest matrix is in [Feature status](docs/FEATURE_STATUS.md).

## Deliberate product boundary

A Project ID plus project key is not a Keen human identity. The app does not claim to provide:

- Keen sign-in, password recovery, SSO, profile, or account sessions;
- organization membership, invitations, roles, or complete team administration;
- billing, plans, invoices, or authoritative account usage;
- authoritative project display name/default keys/users from project keys alone;
- project provisioning without a separately supplied Organization ID and Organization Key.

A local **Workspace** replaces the hosted organization/project picker. Its name is explicitly local.

## Security model

The renderer has no Node access. Network and filesystem operations cross a typed preload boundary into Electron main.

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- no arbitrary navigation, popup window, webview, cookie forwarding, redirect following, or persistent HTTP cache
- restrictive CSP, no-referrer, nosniff, and denied device permissions
- Authorization headers for normal Keen requests
- credentials memory-only by default
- optional PBKDF2-SHA-256 plus AES-256-GCM IndexedDB ciphertext
- no plaintext key in `localStorage`
- Access Key path values and Authorization are redacted from diagnostics
- safe reads only receive bounded retries; mutations receive none
- request body guard of 10.5 MB and response guard of 150 MB
- filtered event deletion cannot send a body or express an empty scope
- public sharing rejects Master/default Read/Write/Organization keys by design

Read [Security](docs/SECURITY.md) and [Threat model](docs/THREAT_MODEL.md) before entering a Master or Organization Key.

## Architecture

```text
Electron main
  ├─ approved-host/base-path validation
  ├─ Authorization injection
  ├─ cancel/timeout/size controls
  ├─ cookie/redirect/cache exclusion
  └─ narrow file dialogs

Preload
  └─ typed DesktopBridge only

Private React bootstrap
  ├─ connect/workspaces/read-only runtime gate
  ├─ encrypted credential vault
  ├─ Analytics / Dashboard / Organization clients
  ├─ scheduler and result model
  └─ all editor/admin routes

Public React bootstrap
  └─ restricted-key dashboard viewer only; no workspace/vault initialization
```

See [Architecture](docs/ARCHITECTURE.md) and [API/credential matrix](docs/API_CREDENTIAL_MATRIX.md).

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- a supported Electron desktop platform
- a Keen Project ID and a lawfully supplied key for live use

No credential or live project data is bundled. Demo mode is synthetic and local.

## Install and run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Package an unpacked app or platform artifact:

```bash
npm run package
npm run dist
```

## Continuous builds and GitHub Releases

`.github/workflows/electron-build-release.yml` verifies and packages the Electron app on every branch push, every non-reserved tag push, pull request, and manual run. Native jobs produce Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon packages.

Every successful **eligible branch push** creates a uniquely tagged continuous GitHub prerelease with all desktop packages attached. Dependabot-triggered pushes still verify and package, but do not attempt Release publication because GitHub supplies those runs a read-only token. Every successful **user tag push** creates a release from that existing tag; the generated `build-*` namespace is reserved and excluded so a continuous Release tag cannot start a duplicate build. A `v<package-version>` tag must exactly match `package.json`. Pull requests build downloadable workflow artifacts but never publish a Release. Manual dispatch always creates or refreshes an unsigned continuous prerelease for the selected commit, even when the selected ref is a tag; it never replaces or signs that tag's Release. A push containing several commits releases the pushed head commit.

Continuous releases use tags such as:

```text
build-142-a1b2c3d
```

Create a stable version release with:

```bash
npm version 0.1.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: 0.1.0"
git tag -a v0.1.0 -m "Keen Key Console v0.1.0"
git push origin HEAD
git push origin v0.1.0
```

Each Release includes eight platform installers/archives, four native-build manifests, `release-manifest.json`, and `SHA256SUMS.txt`. CI resolves one npm lock graph and reuses it across every native runner. The resolved lock is uploaded immediately after installation, even when a later verification step fails. Official GitHub Actions are pinned to immutable commit SHAs. Only an actual pushed `v*` tag can receive optional macOS signing/notarization and Windows Authenticode signing; branch, pull-request, non-version-tag, and manual-dispatch builds are unsigned. See [Build and release automation](docs/RELEASING.md), [the complete Actions behavior](docs/GITHUB_ACTIONS_RELEASES.md), [the source-tracking CI hotfix](docs/CI_HOTFIX_2026-07-24.md), and [the post-Vitest build hotfix](docs/CI_POST_VITEST_HOTFIX_2026-07-24.md).

## First connection

1. Launch the app; it opens `/connect`.
2. Enter a local workspace alias and Project ID.
3. Keep Analytics at `https://api.keen.io/3.0` unless the project uses a reviewed custom host.
4. Add one or more keys and select each key type explicitly.
5. Keep **Memory only** unless encrypted persistence is required.
6. Optionally select the safe schema test.
7. Save the workspace.

The safe test performs only:

```http
GET /3.0/projects/{PROJECT_ID}/events?include_schema=false
```

A Write-only key cannot pass that read test, but it can still be saved for Event Writer.

## Least-privilege routing

| Operation | Candidate keys |
|---|---|
| Schema | schema Access, Read, Master |
| Analysis/extraction | query Access, Read, Master |
| Saved result | allowed saved/cached Access, Read, Master |
| Saved definition | query-definition Access, Master |
| Saved CRUD | Master |
| Dashboard read | Access/Read/Master, subject to source-observed service behavior |
| Dashboard remote write | Master |
| Event write | write Access, Write, Master |
| Access Key management | Master |
| Maintenance | Master |
| Dataset read | dataset Access, Read, Master |
| Dataset create/delete | Master |
| Organization project operations | Organization Key only |

The selected credential is visible per module. A denied restricted key is never silently replaced with Master.

## Dashboard persistence and public viewers

Dashboard modes:

- **Local** — IndexedDB plus JSON import/export; no Dashboard-service dependency.
- **Keen service** — isolated source-observed routes and metadata header; opt-in and live-test required.
- **Hybrid** — local recovery plus explicit remote publish.

The share dialog can create a dedicated restricted Access Key after analyzing chart sources. Saved/cached names are allow-listed; ad-hoc charts require mandatory enforced filters.

Important limitations:

- Dashboard-service acceptance of restricted public keys has not been live-tested here.
- Public publishing is not yet a transactional create-key/update-metadata/verify/revoke-old-key workflow.
- A packaged Electron `file://` page is not an internet-shareable deployment.
- A public link/iframe requires a separately hosted HTTPS public-viewer bundle and deployment CSP.
- The bundled viewer sends its key only to Keen’s default Analytics and Dashboard hosts; custom-host viewers require a separately reviewed deployment.

See [Dashboard compatibility](docs/DASHBOARD_COMPATIBILITY.md).

## Tests

After dependencies are installed:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Dependency-light invariants:

```bash
npm run test:core
```

Opt-in live read contracts skip without disposable credentials:

```text
KEEN_TEST_PROJECT_ID
KEEN_TEST_READ_KEY
KEEN_TEST_ACCESS_KEY
KEEN_TEST_ANALYTICS_HOST
KEEN_TEST_DASHBOARD_HOST
```

Reserved mutation variables are documented in [Environment variables](docs/ENVIRONMENT.md). Never run mutation tests against production.

### Verification result in this environment

The dependency-light core invariants, declaration-aware static TypeScript/import/security audit, release workflow validator, release fixtures, CommonJS preload contract fixture, exact host-approval checks, and connection-page contrast checks pass in this source tree. Hosted runs have independently reached and passed ESLint, the core suite, and Vitest. The latest supplied Actions excerpt ends after Vitest and does not include the first later diagnostic, so this hotfix audits and hardens the entire remaining typecheck/bundle/startup path rather than attributing the failure to an unseen line. This environment still has no installed project dependency graph because npm registry access is unavailable; real TypeScript 5.9 semantic checking, electron-vite output, authentic Electron startup, Playwright/Axe, native packaging, and live Keen contracts remain GitHub-hosted gates.

Read the dated [Revalidation report](docs/REVALIDATION_2026-07-23.md) and [Release checklist](docs/RELEASE_CHECKLIST.md).

## Optional relay

The Electron app normally needs no relay. A separate fixed-upstream relay is included for a hosted viewer or browser deployment where CORS requires it.

```bash
cp .env.example .env
npm run relay
```

It binds to localhost, requires an exact origin allow-list for browser requests, pins DNS, rejects private/reserved addresses by default, forwards no cookies, follows no redirects, limits streams, and logs no URL/host/Project ID/header/body/key. See [Relay deployment](docs/deployment/OPTIONAL_RELAY.md).

## Repository map

```text
src/main/                         Electron security/network/file boundary
src/preload/                      typed bridge
src/shared/                       protocol, domain, URL safety
src/renderer/src/app/             private and public bootstraps
src/renderer/src/features/        product modules
src/renderer/src/lib/api/         Analytics, Dashboard, Organization clients
src/renderer/src/lib/vault/       credential encryption/routing
src/renderer/src/lib/query/       validation/normalization/export
src/renderer/src/lib/dashboard/   document/runtime patching/sharing policy
apps/optional-relay/              fixed-upstream relay
tests/unit/                       deterministic domain/UI tests
tests/core/                       dependency-light invariant runner
tests/e2e/                        Electron + Axe startup flow
tests/live/                       opt-in read contracts
docs/                             architecture, security, status, ADRs
```

## Documentation

- [Boot and read-only behavior](docs/BOOT_AND_READ_ONLY.md)
- [Feature status](docs/FEATURE_STATUS.md)
- [Revalidation report](docs/REVALIDATION_2026-07-23.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API and credential matrix](docs/API_CREDENTIAL_MATRIX.md)
- [Security policy](docs/SECURITY.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Accessibility statement](docs/ACCESSIBILITY.md)
- [Dashboard compatibility](docs/DASHBOARD_COMPATIBILITY.md)
- [Environment variables](docs/ENVIRONMENT.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [GitHub Actions desktop builds and releases](docs/GITHUB_ACTIONS_RELEASES.md)
- [Dashboard persistence ADR](docs/ADRs/0001-dashboard-persistence.md)
- [Contributing](CONTRIBUTING.md)
- [Original implementation prompt](docs/specifications/agent-prompt.md)
- [Research brief](docs/specifications/research-brief.md)

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
