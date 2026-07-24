# Security Policy

## Supported status

This is pre-1.0 community software. Treat a Master Key as a root secret and validate your deployment before production use.

## Reporting a vulnerability

Do not open a public issue containing a Project ID, key, event schema, request body, dashboard, extraction, or proof-of-concept against a live project. Report privately to the repository maintainer's security contact. Until a project-specific security address exists, create a private GitHub security advisory in the repository that hosts this code.

Include:

- affected commit/version and platform;
- impact and prerequisite credential type;
- synthetic reproduction steps;
- whether a secret entered a URL, log, cache, clipboard, DOM attribute, file, or network destination;
- suggested remediation if known.

## Release blockers

1. Credentials remain memory-only by default.
2. Encrypted persistence is authenticated encryption; no plaintext localStorage.
3. Normal clients use only the Authorization header.
4. Logs, URLs, errors, telemetry, copied commands, and audits contain no secrets.
5. No third-party analytics by default.
6. Electron sandbox and context isolation remain enabled.
7. Rich text and imported content cannot execute scripts.
8. Remote images require HTTPS and `no-referrer`.
9. Public dashboards use dedicated restricted Access Keys.
10. Public viewer does not read workspace/vault storage.
11. No mutating capability probe.
12. No automatic write/update/delete retry.
13. Filtered delete sends no body.
14. Whole-collection delete is a separate method and screen mode.
15. Final maintenance scope hash equals preview hash.
16. Locking clears decrypted keys.
17. Optional relay is allow-listed, cookie-free, size-limited, redacted, and SSRF-resistant.
18. Imported hosts require explicit approval before connection.

## Secret lifecycle

### Entry

Password inputs disable browser autocomplete. Key type is declared by the user and never inferred.

### Storage

- Memory mode: module-private map only.
- App-session mode: module-private process memory only.
- Encrypted mode: AES-GCM ciphertext in IndexedDB, PBKDF2-SHA-256 key derivation, random salt and IV.

The passphrase and derived key are not persisted.

### Use

The renderer passes the credential only to the typed preload bridge. Main uses it as the Authorization header. The header is not returned to the renderer.

### Lock/delete

Lock removes memory values. Workspace deletion removes encrypted records and local content. Deleting a local workspace never deletes the Keen project.

## Dependency policy

- lock dependency versions for releases;
- run audit and secret scanning;
- review Electron, Markdown, chart, grid, and sanitizer updates as high-impact;
- do not enable remote module, webviews, arbitrary preload code, or renderer Node integration;
- use bundled assets instead of runtime CDNs.

## Public links

A URL fragment is not sent in the HTTP request or normal referrer, but a recipient/browser can still read it. A public key is therefore safe only to the degree that its Access Key policy is narrow. Do not grant `writes`, `schema`, unrestricted `queries`, or `query_definition` unless a widget strictly requires it.

## Maintenance

Keen's filtered event DELETE contract is unusually hazardous because the request body is ignored. All filter/timeframe scope must be encoded in the URL. The app's dedicated serializer is a security boundary; changes require exhaustive tests and manual review.
