# Contributing

## Safety first

Use synthetic fixtures and a disposable Keen project. Never commit Project IDs, keys, collection/property names from a live customer, event bodies, extraction files, dashboard documents, or raw server responses.

Do not add:

- Keen account-login imitation;
- hidden browser-session endpoints;
- automatic write/delete/update probes;
- mutation retries;
- a generic DELETE helper that can send filtered-event scope in a body;
- logs or diagnostics containing credentials or Access Key path values;
- remote scripts, runtime CDNs, third-party analytics, webviews, or renderer Node access.

## Development

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run test:e2e
```

The dependency-light invariants can be run with:

```bash
npm run test:core
```

## Pull-request expectations

- preserve strict TypeScript;
- add tests for protocol, encoding, redaction, and permission changes;
- preserve unknown Keen fields through read/edit/write cycles;
- update `FEATURE_STATUS.md` and the dated revalidation report;
- mark contracts as documented API, documented UI, source-observed, local, organization, or hosted-only;
- include keyboard and nonvisual behavior for new UI;
- document any current-server assumption with a disposable-project contract test and sanitized result.

## Live tests

Live tests skip unless explicit environment variables are supplied. New mutation tests must additionally require `KEEN_TEST_ENABLE_MUTATIONS=true`, use unique test prefixes, and clean up only resources created by that run. Destructive event/property/collection tests remain opt-in and must never target production.
## Releases

Every branch push is verified, packaged, and published as a uniquely tagged continuous prerelease. Every user tag push creates a prerelease or versioned Release from that existing tag; the generated `build-*` namespace is reserved and does not trigger another workflow; a `v*` tag must exactly match `package.json`. Pull requests package workflow artifacts but never publish a Release. Do not manually replace binaries or checksums—use the managed workflow rerun, or publish a new version when Releases are immutable. Follow [Build and release automation](docs/RELEASING.md) and complete [the release checklist](docs/RELEASE_CHECKLIST.md).

