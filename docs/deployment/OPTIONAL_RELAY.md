# Optional Relay Deployment

The Electron application normally does not need a CORS relay: the sandboxed renderer sends typed IPC requests to the Electron main process, which performs HTTPS requests after host and path validation.

The relay exists only for separately hosted web/public-viewer deployments or custom environments where browser CORS prevents direct access.

## Security properties

- exactly two configured HTTPS upstreams: Analytics and Dashboard;
- caller cannot supply an arbitrary upstream host;
- DNS is resolved and pinned for the request;
- private, local, reserved, documentation, and multicast addresses are rejected by default;
- redirects are not followed;
- cookies and hop-by-hop headers are not forwarded;
- only the minimum Keen headers are accepted/exposed;
- request and response sizes are bounded;
- response streaming avoids duplicate in-memory copies;
- logs contain method, status, and elapsed time only—not URL, host, Project ID, headers, body, or key;
- browser origins are exact-match allow-listed;
- service binds to `127.0.0.1` and should sit behind a hardened HTTPS reverse proxy.

## Start locally

```bash
cp .env.example .env
# export or load the variables with your process manager
npm run relay
```

A browser Analytics route begins with `/3.0`; a Dashboard-service route begins with `/projects`.

## Production checklist

1. Terminate TLS at a maintained reverse proxy.
2. Set a nonempty `RELAY_ALLOWED_ORIGINS` list.
3. Keep `RELAY_ALLOW_PRIVATE_DNS=false`.
4. Run under an unprivileged OS account with no persistent request logging.
5. Restrict inbound network access to the intended frontend and health tooling.
6. Apply process memory, CPU, connection, and rate limits.
7. Verify proxy logs redact `Authorization` and do not record full paths containing Project IDs.
8. Test DNS-rebinding, IPv4-mapped IPv6, oversized bodies, aborted streams, redirects, and malformed paths.
9. Do not turn the relay into a server-side login/session system.

## Residual risk

The relay handles bearer credentials transiently in process memory. A compromised relay host or reverse proxy can read them. Direct browser-to-Keen access or the Electron main-process boundary is preferable when available.
