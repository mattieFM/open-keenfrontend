# Environment Variables

No live credential is required to build the application. Never commit a populated `.env` file.

## Live contract tests

| Variable | Purpose |
|---|---|
| `KEEN_TEST_PROJECT_ID` | Disposable Keen project ID |
| `KEEN_TEST_READ_KEY` | Read-only Analytics contract checks |
| `KEEN_TEST_WRITE_KEY` | Reserved for explicit write contract checks |
| `KEEN_TEST_MASTER_KEY` | Reserved for explicitly enabled administrative checks |
| `KEEN_TEST_ACCESS_KEY` | Restricted-key and Dashboard read checks |
| `KEEN_TEST_ANALYTICS_HOST` | Analytics base; defaults to `https://api.keen.io/3.0` |
| `KEEN_TEST_DASHBOARD_HOST` | Dashboard base; defaults to `https://dashboard-service.k-n.io` |
| `KEEN_TEST_ENABLE_MUTATIONS` | Must be exactly `true` before any future mutation suite may run; current live suites are read-only |

Live suites skip when the required variables are absent. They must use a disposable project and must never print key values or response event data.

## Optional relay

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `8787` | Local listen port; relay binds to `127.0.0.1` |
| `RELAY_ALLOWED_ORIGINS` | empty | Comma-separated exact browser origins; empty denies requests carrying an Origin header |
| `RELAY_ANALYTICS_UPSTREAM` | Keen Analytics default | Fixed HTTPS Analytics upstream |
| `RELAY_DASHBOARD_UPSTREAM` | Keen Dashboard default | Fixed HTTPS Dashboard upstream |
| `RELAY_MAX_REQUEST_BYTES` | `10500000` | Maximum inbound body |
| `RELAY_MAX_RESPONSE_BYTES` | `150000000` | Maximum streamed upstream response |
| `RELAY_TIMEOUT_MS` | `310000` | Upstream timeout |
| `RELAY_ALLOW_PRIVATE_DNS` | `false` | Development-only override for private/reserved DNS targets |

The relay does not accept an arbitrary upstream URL from the caller. The route prefix chooses one of the two configured upstreams.

## Electron development

`ELECTRON_RENDERER_URL` is supplied by `electron-vite` during development. HTTP service hosts are accepted only in unpackaged development, and should be limited to localhost.
