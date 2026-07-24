# Dashboard Service Compatibility Report

**Research / code date:** 2026-07-23

**Status:** adapter implemented; live production contract not asserted without a disposable test project.

## Source-observed contract

Default host:

```text
https://dashboard-service.k-n.io
```

Project base:

```text
{DASHBOARD_API}/projects/{PROJECT_ID}
```

Routes represented by the adapter:

```http
GET    /dashboards/{ID}
GET    /dashboards/{ID}/metadata
GET    /dashboards/metadata
PUT    /dashboards/{ID}
PUT    /dashboards/{ID}/metadata
DELETE /dashboards/{ID}
```

A full dashboard `PUT` sends JSON plus:

```http
X-Keen-Blob-Metadata: <JSON-STRINGIFIED-METADATA>
```

Read credentials and exact metadata fields must be confirmed against the current service. Writes/deletes are routed to a selected Master Key.

## Isolation

- separate base URL and adapter;
- explicit per-workspace feature switch;
- no `/3.0` suffix is appended to the dashboard host;
- local dashboard document is independent of remote shape;
- unknown metadata fields are preserved;
- remote failure never removes local dashboards;
- source-observed code does not enter the Analytics client.

## Live test checklist

- CORS/preflight from deployment origin;
- Read, restricted Access, and Master acceptance per read route;
- dashboard ID requirements;
- custom metadata header requirement and size limit;
- response status/body and timestamp units;
- zero/one/many list behavior;
- private/public read behavior;
- malformed/stale/missing/denied errors;
- dashboard body size limit;
- whether public keys are exposed to broad readers;
- delete atomicity;
- custom host behavior.

## Fallback

If any compatibility assumption fails, keep local or hybrid mode. Change the adapter and dated report rather than coupling UI components to a guessed contract.
