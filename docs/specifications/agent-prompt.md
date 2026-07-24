# Copy/Paste Agent Prompt: Build a Keen Key-Only Open-Source Frontend

You are the lead engineer and product designer responsible for building a production-quality, open-source frontend for **Keen.io**. Implement the application, tests, documentation, and deployment configuration—not merely a mockup or architecture memo.

## 1. Product objective

Build a self-hostable web application for people who have:

- a Keen **Project ID**; and
- one or more Keen project API keys, such as a Read Key, Write Key, Master Key, or restricted Access Key;

but who do **not** have a Keen account session and were **not** added as a human member of the Keen project.

The app must expose every useful project-level data workflow that the supplied credentials actually permit. It must not require or imitate Keen login. It must clearly separate project API capabilities from organization/account features.

The experience should feel like a complete alternative project console for key holders: connect, inspect streams, query and visualize data, manage saved queries and dashboards, create scoped access keys, send events, extract data, and—with strong safeguards—perform maintenance.

## 2. Ground truth and scope boundaries

Use Keen Analytics API v3 as the primary documented contract:

```text
Default Analytics API: https://api.keen.io/3.0
Project base:           https://api.keen.io/3.0/projects/{PROJECT_ID}
```

Use the `Authorization` header for credentials. Do not put credentials in query strings in the app's normal API client.

Keen project key types:

- **Master Key**: broad project API access; required for administration and destructive operations.
- **Read Key**: analyses, extractions, schema inspection, and saved-query results.
- **Write Key**: event recording.
- **Access Key**: custom restricted key with explicit permitted scopes/options; preferred for customer-facing/public experiences.
- **Organization Key**: separate credential for organization/project provisioning and metadata; optional extension only.

A Project ID plus project keys does not provide Keen account identity or all portal functions. Do not claim to support, and do not reverse-engineer:

- Keen sign-in, password recovery, profile, SSO, or account sessions;
- organization membership, roles, invitations, or full team management;
- billing, plans, invoices, or authoritative usage/account administration;
- authoritative project display name/default keys/users unless an optional Organization ID + Organization Key is supplied;
- project creation, rename, membership update, or deletion without the Organization credential.

Replace Keen's organization/project picker with a local **Workspace** containing a local alias, Project ID, service hosts, preferences, and encrypted credential references.

## 3. Confidence classes

Label API adapters and documentation internally with:

- `documented-api`: explicit Keen Analytics API contract;
- `documented-ui`: behavior described in Keen's public UI guides;
- `source-observed`: behavior seen in an official Keen open-source client but not prominently specified in the main API reference;
- `local`: no Keen backend dependency;
- `organization`: optional Organization API;
- `hosted-only`: unavailable to key-only users.

Do not mix `source-observed` dashboard storage code into the Analytics API client. Isolate it and provide a local fallback.

## 4. Required technology and repository shape

Use a modern strict TypeScript stack unless the existing repository mandates an equivalent:

- React;
- Vite;
- TanStack Query for server state;
- Zustand or Redux Toolkit for editor/session state;
- React Hook Form and Zod;
- IndexedDB repository layer;
- Web Crypto for credential encryption;
- Vitest + Mock Service Worker;
- Playwright;
- an accessibility test layer;
- a visualization adapter that can wrap Keen's open-source chart packages or a maintained alternative.

Recommended packages/apps:

```text
/apps/web
/apps/optional-relay
/packages/keen-analytics-client
/packages/keen-dashboard-adapter
/packages/keen-organization-client
/packages/credential-vault
/packages/query-model
/packages/result-normalizer
/packages/visualization-adapter
/packages/dashboard-model
/packages/ui
/packages/test-fixtures
```

Keep these dependency rules:

- UI imports domain interfaces, not raw `fetch`.
- Analytics, dashboard, and organization clients remain separate.
- Credential vault has no feature imports.
- Query/result models have no chart-library dependency.
- Dashboard documents are independent of persistence.
- Preserve unknown API fields through read/edit/write cycles.

## 5. API hosts and clients

Implement independently configurable clients:

```text
ANALYTICS_API = https://api.keen.io/3.0
DASHBOARD_API = https://dashboard-service.k-n.io
ORGANIZATION_API = https://api.keen.io/3.0/organizations
```

The Dashboard API value is source-observed and must be feature-flagged and live contract-tested. Do not append `/3.0` to it.

Every client must support:

- `Authorization` header;
- request cancellation;
- strict host normalization;
- safe path encoding;
- redacted request inspection;
- structured errors;
- bounded retry only for safe/idempotent reads and network/`429`/`503` conditions;
- zero automatic retries for writes, updates, or deletes;
- raw response preservation alongside parsed output;
- custom Keen hosts.

Use this error model or an equivalent:

```ts
type KeenApiError = {
  kind: 'network' | 'cors' | 'abort' | 'http' | 'parse' | 'validation';
  status?: number;
  errorCode?: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: unknown;
  redactedRequest: unknown;
};
```

Handle at least `400`, `401`, `403`, `404`, `429`, `500`, `503`, and `504` distinctly.

## 6. Credential vault and capability model

Default credentials to memory-only. Offer:

- tab memory;
- browser session;
- encrypted IndexedDB protected by a passphrase;
- no secret persistence.

Use AES-GCM through Web Crypto. Use a modern password KDF and never persist the derived key. Do not store plaintext credentials in `localStorage`.

Allow multiple labeled credentials per workspace. Never infer key type from length or shape. Mask keys by default and redact them from:

- URLs;
- console and application logs;
- error reports;
- request history;
- copied cURL;
- telemetry;
- DOM attributes;
- test snapshots;
- developer-tool state integrations.

Represent capability state as:

```ts
type CapabilityState = 'unknown' | 'allowed' | 'denied';
```

There is no dependable arbitrary-key introspection endpoint. Learn capabilities only from user-requested operations or explicit safe tests. Do not auto-test writes or mutations.

Safe connect test:

```http
GET /3.0/projects/{PROJECT_ID}/events?include_schema=false
```

Optional explicit Master check:

```http
GET /3.0/projects/{PROJECT_ID}/keys?per_page=1
```

Route to least privilege:

- scoped Access Key for public/customer viewer;
- Read Key for analyses;
- Write Key for events;
- Master only when required;
- Organization Key only in the optional organization module.

Never silently fall back from a denied restricted Access Key to Master when that would broaden data access. Require explicit credential selection.

## 7. Required routes

Implement at least:

```text
/
/connect
/workspaces
/w/:workspaceId
/w/:workspaceId/streams
/w/:workspaceId/streams/:collection
/w/:workspaceId/query/new
/w/:workspaceId/query/:draftId
/w/:workspaceId/saved-queries
/w/:workspaceId/dashboards
/w/:workspaceId/dashboards/:dashboardId/view
/w/:workspaceId/dashboards/:dashboardId/edit
/w/:workspaceId/access-keys
/w/:workspaceId/events/write
/w/:workspaceId/extract
/w/:workspaceId/maintenance
/w/:workspaceId/datasets
/w/:workspaceId/settings
/public/:projectId/:dashboardId
```

Never include a secret in path or search parameters.

## 8. Feature requirements and exact backend mappings

### 8.1 Connect and workspace overview

Create a connect wizard with:

- local workspace name;
- Project ID;
- Analytics host;
- optional Dashboard host;
- one or more labeled keys;
- storage mode;
- optional Organization ID/Key section behind a feature switch;
- safe schema test;
- explicit Master capability test;
- clear CORS/network/auth/permission outcomes.

Workspace overview shows only derived/local facts:

- local alias and Project ID;
- configured hosts and masked credentials;
- capability badges;
- collection count if fetched;
- recent local drafts/history;
- dashboard storage mode;
- Master/Organization storage warning;
- links to every module.

Do not invent project name, plan, quota, members, or billing data.

### 8.2 Streams and schema

Implement:

```http
GET /3.0/projects/{PROJECT_ID}/events?include_schema=true|false
GET /3.0/projects/{PROJECT_ID}/events/{COLLECTION}
GET /3.0/projects/{PROJECT_ID}/events/{COLLECTION}/properties/{PROPERTY}
```

Credentials: Read, Master, or Access Key with `schema`.

Features:

- collection list, search, refresh, schema-loaded state;
- collection detail with flattened property paths and inferred types;
- property search/type filter/copy;
- shortcuts to use a property as target/group/filter/order field;
- manual entry fallback;
- up to 5,000 collections;
- display the 1,000-unique-property collection limit;
- preserve unknown types.

Recent values are not a schema response. Use a bounded extraction:

```http
POST /3.0/projects/{PROJECT_ID}/queries/extraction
{
  "event_collection": "...",
  "timeframe": "this_14_days",
  "latest": 25,
  "property_names": ["keen.timestamp", "..."]
}
```

Provide table and JSON-tree views. Do not persist raw events unless the user downloads them.

### 8.3 Complete Data Explorer

Run analyses with:

```http
POST /3.0/projects/{PROJECT_ID}/queries/{ANALYSIS_TYPE}
Authorization: <query-capable-key>
Content-Type: application/json
```

Support these documented user-facing analyses:

- `count`;
- `count_unique`;
- `sum`;
- `average`;
- `minimum`;
- `maximum`;
- `median`;
- `percentile`;
- `select_unique`;
- `standard_deviation`;
- `extraction`;
- `funnel`.

Add `multi_analysis` as an advanced API-completeness feature.

Support common parameters:

- `event_collection`;
- `target_property`;
- `timeframe`;
- `timezone`;
- `filters`;
- `group_by`;
- `order_by`;
- `limit`;
- `interval`;
- `zero_fill`;
- `include_metadata`;
- extraction options;
- funnel steps;
- multi-analysis named analyses.

#### Timeframes

Support:

- absolute `{start, end}` ISO-8601; end is exclusive;
- relative `this_N_minutes|hours|days|weeks|months|years`;
- relative `previous_N_...`;
- convenience strings such as today, yesterday, previous week/month/year;
- IANA timezone or seconds offset for relative timeframes;
- disable timezone control for absolute ranges because the API ignores the separate timezone parameter there.

Intervals:

- minutely, hourly, daily, weekly, monthly, yearly;
- custom `every_N_units` where accepted;
- warn before approaching the 9,000-interval limit.

#### Filters

Normal filter arrays are ANDed. Support nested OR:

```json
{
  "operator": "or",
  "operands": [
    {"property_name":"country","operator":"eq","property_value":"CA"},
    {"property_name":"country","operator":"eq","property_value":"US"}
  ]
}
```

Expose:

- String: `eq`, `ne`, `lt`, `gt`, `exists`, `in`, `contains`, `not_contains`, `regex`.
- Number: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `exists`, `in`.
- Boolean: `eq`, `exists`, `in`.
- Geo: `within` with coordinates/distance.

Regex is RE2-compatible. Geo filtering cannot be combined with `group_by`; validate before request.

#### Group/order/limit

- one or multiple `group_by` properties;
- advanced raw objects for numeric ranges/buckets;
- order by `result` or grouped fields;
- `ASC` default and `DESC` option;
- multiple order clauses;
- limit;
- explain response-size multiplication for interval × group;
- zero fill toggle.

#### Funnel

Each step supports:

```ts
type FunnelStep = {
  event_collection: string;
  actor_property: string;
  timeframe?: string | { start: string; end: string };
  filters?: KeenFilter[];
  optional?: boolean;
  inverted?: boolean;
};
```

Provide reorder, duplicate, delete, shared/step timeframe, filters, optional/inverted flags, actor consistency guidance, and a 1,000,000-actor warning. Funnel has no interval/group-by UI.

#### Execution experience

- explicit Run by default;
- optional debounced auto-run with warning;
- cancel;
- deduplicate identical in-flight reads;
- per-workspace query scheduler;
- redacted request inspector;
- cURL copy with `${KEEN_KEY}` placeholder;
- raw response;
- server metadata such as processing/scanned properties when returned;
- local history/drafts/undo/redo/import/export;
- filter suggestions only on explicit action or an opt-in setting because suggestions consume query capacity.

#### Result normalization and charts

Preserve scalar, grouped, interval, interval+group, unique array, extraction, funnel, multi-analysis, and metadata shapes.

Support chart types through an adapter:

- area;
- bar;
- bubble;
- choropleth;
- donut;
- funnel;
- gauge;
- heatmap;
- line;
- metric;
- pie;
- table.

Semantic defaults:

- numeric scalar → metric;
- one categorical group → bar;
- time interval → line;
- interval + group → multi-series line;
- funnel → funnel;
- raw records/select unique → table/list;
- always provide a table/JSON fallback;
- disable incompatible chart choices with an explanation.

Local exports:

- CSV and JSON;
- SVG/PNG where the renderer permits;
- query definition file without credentials.

### 8.4 Saved and cached queries

Implement:

```http
PUT    /3.0/projects/{PROJECT_ID}/queries/saved/{NAME}
GET    /3.0/projects/{PROJECT_ID}/queries/saved
GET    /3.0/projects/{PROJECT_ID}/queries/saved/{NAME}
GET    /3.0/projects/{PROJECT_ID}/queries/saved/{NAME}/result
DELETE /3.0/projects/{PROJECT_ID}/queries/saved/{NAME}
```

Permission rules:

- create/update/list definitions/delete: Master;
- one definition: Master or Access Key with `query_definition`;
- result: Read/Master or appropriately permitted `saved_queries`/`cached_queries` Access Key.

Do not show an authoritative empty list when a Read/Access Key cannot list definitions. Provide **Open known saved query name** and maintain a clearly local history of names successfully opened.

Saved query body:

```json
{
  "query": {
    "analysis_type": "count",
    "event_collection": "purchases",
    "timeframe": "this_14_days"
  },
  "refresh_rate": 0,
  "metadata": {
    "display_name": "Purchases — 14 days",
    "tags": ["commerce"]
  }
}
```

API names may contain alphanumerics, hyphens, and underscores. Preserve arbitrary metadata.

Frontend features:

- search;
- A–Z/date sorting;
- tag and cache-status filtering;
- detail preview and parameters;
- local auto-run-on-select toggle;
- create, edit, clone, delete;
- result/definition download;
- add to dashboard;
- share definition without credentials.

Caching uses `refresh_rate`. Public Keen documentation has conflicting historical upper bounds. Do not hardcode an uncertain upper maximum. Offer conservative presets beginning at four hours, submit the value, and surface server validation.

### 8.5 Dashboards

Implement local dashboards first, then a source-observed Keen-compatible adapter.

Required management behavior:

- create;
- list/grid;
- title and tags;
- search/sort/filter;
- view/edit;
- clone, private by default;
- delete;
- autosave and recovery;
- theme;
- public/share/embed.

Required widget types from Keen's documented dashboard editor:

1. Chart.
2. Rich text.
3. Remote image.
4. String-property filter.
5. Date range.

#### Chart widget

Support ad-hoc query, linked saved query, and detached copy. Use the complete query editor. Allow compatible chart type, title/subtitle/formatting, refresh/cancel, raw response/request, move/resize/clone/delete, and table fallback.

A linked saved query may propagate changes. Make linkage visible and support detach.

#### Text widget

Use safe Markdown or constrained rich-text JSON. Sanitize output. No script, event handler, iframe, form, or dangerous URL execution.

#### Image widget

HTTPS URL, required alt text unless decorative, fit/caption/link, load error state, `referrerpolicy="no-referrer"`, and no dangerous schemes. Explain remote-host network disclosure.

#### Filter widget

- select stream and a string schema property;
- select compatible charts using that stream;
- one filter can target many charts;
- one chart can have multiple filters;
- no funnel compatibility;
- manual or explicitly fetched unique options;
- runtime query patch only—do not mutate saved-query definitions;
- combine with original filters using AND.

#### Date-range widget

- relative/absolute range and relative timezone;
- one widget targets multiple charts;
- a chart can belong to only one date-range widget;
- runtime override and clear-to-original behavior.

#### Layout/editor

- toolbar add and drag/drop;
- resize chart/image/text;
- keyboard move/resize alternatives;
- clone chart/text/image;
- delete with undo;
- separate edit and preview modes;
- debounced serialized autosave;
- local recovery journal;
- conflict UI rather than silent overwrite;
- responsive preview;
- accessible themes and table fallbacks.

#### Internal dashboard document

Create a versioned internal model and migrations. Keep the remote serializer separate. Include widgets, layout, settings, theme, and unknown metadata.

#### Persistence modes

- local IndexedDB + JSON import/export;
- Keen-compatible service;
- hybrid local recovery + publish/sync.

Local mode must work even when the Keen dashboard service is unavailable or incompatible.

#### Source-observed Keen dashboard contract

Default host observed in official Keen source:

```text
https://dashboard-service.k-n.io
```

Base:

```text
{DASHBOARD_API}/projects/{PROJECT_ID}
```

Routes observed in Keen's official Dashboard Creator client:

```http
GET    /dashboards/{ID}
GET    /dashboards/{ID}/metadata
GET    /dashboards/metadata
PUT    /dashboards/{ID}
PUT    /dashboards/{ID}/metadata
DELETE /dashboards/{ID}
```

Read calls use a configured read/access key. Writes/deletes use Master. The full `PUT` sends dashboard JSON and:

```http
X-Keen-Blob-Metadata: <JSON-STRINGIFIED-METADATA>
```

Observed metadata fields include:

```ts
type KeenDashboardMetadata = {
  id: string;
  title: string | null;
  widgets: number;
  queries: number;
  tags: string[];
  lastModificationDate: number | null;
  isPublic: boolean;
  publicAccessKey: string | null;
};
```

Treat this entire contract as `source-observed`. Preserve unknown fields, put it behind an adapter/feature flag, and create live tests for CORS, auth, IDs, headers, metadata shape, size limits, errors, and delete behavior. Never block local dashboards on it.

### 8.6 Public dashboard sharing

Use a dedicated least-privilege Access Key per public dashboard/security boundary.

Publishing algorithm:

1. Analyze dashboard query sources.
2. Prefer saved/cached query allow-lists.
3. For unrestricted ad-hoc charts, offer conversion to saved queries or require enforced tenant filters.
4. Create Access Key with only required permissions/options.
5. Store compatible public metadata only after key creation.
6. Create a public viewer route.

Recommended link:

```text
/public/{projectId}/{dashboardId}#key={RESTRICTED_ACCESS_KEY}
```

The viewer reads the fragment into memory and immediately removes it with `history.replaceState`. Set `Referrer-Policy: no-referrer`. Explain that the key remains a browser-visible bearer credential and is safe only because it is narrowly scoped.

Never publish with Master, default Read, Write, or Organization keys.

Regeneration:

- create new key;
- update metadata;
- verify new viewer;
- revoke/delete old key;
- surface recovery if any step fails.

Making private revokes the key and updates metadata. Dashboard deletion cleans up app-owned public keys and reports orphaned-key failures.

Generate public iframe and authenticated-host embed examples. Recommend runtime key injection for logged-in host applications.

### 8.7 Access Key manager

Implement:

```http
POST   /3.0/projects/{PROJECT_ID}/keys
GET    /3.0/projects/{PROJECT_ID}/keys?name=&page=&per_page=
GET    /3.0/projects/{PROJECT_ID}/keys/{CUSTOM_KEY}
POST   /3.0/projects/{PROJECT_ID}/keys/{CUSTOM_KEY}
POST   /3.0/projects/{PROJECT_ID}/keys/{CUSTOM_KEY}/revoke
POST   /3.0/projects/{PROJECT_ID}/keys/{CUSTOM_KEY}/unrevoke
DELETE /3.0/projects/{PROJECT_ID}/keys/{CUSTOM_KEY}
```

Credential: Master only.

Support fields/scopes:

- `name`, maximum 256;
- `is_active`;
- `permitted`: writes, queries, saved_queries, cached_queries, datasets, schema, query_definition when accepted;
- `options` with write autofill, mandatory query filters, saved/cached allowed/blocked names, saved filters, and dataset operations/restrictions;
- raw JSON mode;
- preserve unknown properties.

Features:

- pagination, search, mask/reveal;
- policy summary;
- create/edit/clone policy;
- revoke/unrevoke/delete;
- conflict validation;
- warning for unrestricted query permission;
- templates for one saved query, cached dashboard, tenant-filtered dashboard, write-only autofill, and dataset viewer.

An Access Key cannot perform Master-only admin/delete operations. Never present it as admin.

### 8.8 Event writer

Implement:

```http
POST /3.0/projects/{PROJECT_ID}/events/{COLLECTION}
POST /3.0/projects/{PROJECT_ID}/events
```

Credentials: Write, Master, or write-scoped Access Key.

Single body is one event object. Bulk body maps collection names to event arrays.

Features:

- JSON and assisted form;
- single/bulk tabs;
- JSON/NDJSON/CSV import with preview;
- collection validation/manual entry;
- `keen.timestamp` helper;
- enrichment/add-on helper;
- approximate 900,000-byte event and 10,000,000-byte bulk payload counters;
- recommend batches no larger than 5,000 events;
- inspect each bulk item status even on HTTP 200;
- no automatic write retry;
- explicit retry only for clearly identified failed items;
- explain no new event database ID is returned;
- explain query visibility can lag by about ten seconds;
- generate cURL/fetch/keen-tracking/Kafka snippets with environment placeholders.

Do not load or run user tracking code inside this admin app.

### 8.9 Extractions

Use:

```http
POST /3.0/projects/{PROJECT_ID}/queries/extraction
```

Support:

- collection, timeframe, timezone, filters;
- latest;
- property names;
- content type and gzip;
- include metadata;
- local synchronous download;
- async/email extraction.

Display limits:

- synchronous scan up to 1,000,000 events;
- synchronous return up to 100,000 events;
- asynchronous file up to 10,000,000 events and 2 GB;
- CSV, line-oriented JSON/JSON stream, and gzip options;
- emailed link documented as valid for 30 days.

Tell the user when their email address will be sent to Keen. Do not invent a polling API.

### 8.10 Maintenance danger zone

Credential: Master. Updates may not be enabled for the project.

Every operation requires:

1. exact scope;
2. count preview;
3. small extraction preview;
4. immutable preview hash;
5. target Project ID and workspace display;
6. typed confirmation;
7. one submission;
8. no automatic retry;
9. redacted local audit entry.

#### Delete matching events

```http
DELETE /3.0/projects/{PROJECT_ID}/events/{COLLECTION}
  ?filters=<URL_ENCODED_JSON>
  &timeframe=<URL_ENCODED_JSON_OR_STRING>
  &timezone=<URL_ENCODED_VALUE>
```

Critical invariant: Keen ignores a DELETE body. Filters/timeframe must be query parameters. Bad/missing encoding can delete the entire collection.

Therefore:

- use a dedicated serializer with exhaustive tests;
- display encoded and decoded scope;
- generic filtered-delete UI cannot have empty scope;
- whole-collection delete is a separate action/code path;
- never retry.

#### Delete property

```http
DELETE /3.0/projects/{PROJECT_ID}/events/{COLLECTION}/properties/{PROPERTY}
```

#### Delete collection

```http
DELETE /3.0/projects/{PROJECT_ID}/events/{COLLECTION}
```

Keep it separate from filtered delete in UI and logic despite the overlapping route.

#### Update matching events

```http
PUT /3.0/projects/{PROJECT_ID}/events/{COLLECTION}
{
  "property_updates": [
    {
      "property_name": "description",
      "property_value": "Invalid event",
      "upsert_property": true
    }
  ],
  "timeframe": {"start":"...","end":"..."},
  "filters": []
}
```

Show server-disabled state, non-atomic warning, preview, and `updated_events` response.

### 8.11 Cached datasets, optional advanced module

Implement after core features:

```http
PUT    /3.0/projects/{PROJECT_ID}/datasets/{NAME}
GET    /3.0/projects/{PROJECT_ID}/datasets
GET    /3.0/projects/{PROJECT_ID}/datasets/{NAME}
GET    /3.0/projects/{PROJECT_ID}/datasets/{NAME}/results
DELETE /3.0/projects/{PROJECT_ID}/datasets/{NAME}
```

Support create, list, get/status, indexed result retrieval, and delete. Mark Early Release.

Rules:

- relative timeframe must match interval constraints accepted by API;
- no funnel;
- up to three `index_by` fields;
- create-only definition behavior unless live verification proves update;
- hourly refresh;
- last 48 hours recomputed, so late older events may not appear;
- statuses Created, Bootstrapping, OK, BootstrappingFailed, Warn, and unknown;
- dataset Access Keys can be limited to read/list/retrieve.

### 8.12 Kafka and integration helper

Generate configuration only; do not attempt browser TCP Kafka.

Document:

```text
Inbound brokers:  b1/b2/b3.kafka-in.keen.io:9092
Outbound brokers: b1/b2/b3.kafka-out.keen.io:9092
SASL_SSL / PLAIN
Username: Project ID
Inbound password: Write Key
Outbound password: Read Key
Topic: collection name
```

Warn that outbound Kafka may require enablement on Keen's Streams page and may not have a project-key API toggle.

### 8.13 Optional Organization Admin

Only when Organization ID and Organization Key are separately configured, add a clearly isolated module for documented project get/list/create/update/delete operations under:

```text
https://api.keen.io/3.0/organizations/{ORG_ID}/projects/...
```

Do not treat Master as Organization Key. Warn that project user updates may require sending the complete replacement user list. Do not claim billing/profile/SSO parity.

## 9. API limits and scheduling

Surface and design around:

- ad-hoc queries: 200/minute/project;
- extractions: 200/minute/project;
- updates: 10/minute;
- deletes: 10/minute;
- collection delete: 100/minute;
- event size: 900,000 bytes;
- bulk payload: 10,000,000 bytes;
- 1,000 unique properties per collection;
- schema list up to 5,000 collections;
- response error above about 150 MB;
- query maximum around five minutes;
- maximum 9,000 intervals;
- maximum 1,000,000 group combinations;
- maximum 1,000,000 funnel actors;
- count unique/median/percentile may become approximate at high scan volume;
- project-level rate limits and organization-level fuzzy concurrency limits;
- cached query/dataset result lookups do not count as ad-hoc query rate in the documented limit table.

Implement a project/workspace scheduler:

- conservative concurrent query cap;
- separate extraction queue;
- dashboard refresh batching;
- cancel stale requests;
- deduplicate identical requests;
- pause after `429`;
- manual resume;
- hidden-tab polling pause;
- optional `BroadcastChannel` coordination without sharing secrets/results.

Do not label local request counters as billing usage.

## 10. Security requirements—release blockers

1. Credentials are memory-only by default.
2. Encrypted persistence only; no plaintext localStorage.
3. Authorization headers only in the normal app client.
4. No secrets in logs, URLs, telemetry, errors, copied examples, or service worker.
5. No third-party analytics by default.
6. Strong CSP, no-referrer, nosniff, and restricted permissions policy.
7. Sanitize rich text and imported content.
8. Validate image/link schemes; remote images use no-referrer.
9. Public dashboards use dedicated narrow Access Keys.
10. Public viewer cannot access editor/vault state.
11. No mutating capability probes.
12. No automatic mutation retries.
13. Filtered event deletion never sends a body.
14. Whole-collection deletion has a separate code path.
15. Final maintenance request must match the preview hash.
16. Cross-workspace navigation cancels requests and clears secret-bound state.
17. Optional relay is allow-listed, cookie-free, non-persistent, size-limited, redacted, and SSRF-resistant.
18. Imported workspace hosts require explicit approval before connection.

Suggested headers:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; connect-src 'self' https://api.keen.io https://dashboard-service.k-n.io; img-src 'self' https: data:
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Adapt `frame-ancestors` for an explicit embed deployment.

## 11. Accessibility and UX quality

Target WCAG 2.2 AA.

- every chart has a title, textual summary, and table/JSON fallback;
- keyboard-operable query builder and dashboard editor;
- non-drag controls for move/resize;
- visible focus;
- proper live regions and field-linked errors;
- no color-only meaning;
- contrast-safe themes;
- reduced motion;
- locale-aware display and machine-safe copied values;
- timezone clarity;
- externalized translations and RTL testability;
- virtualized tables that retain semantics;
- required alt-text workflow for images;
- distinct loading, empty, denied, rate-limited, timeout, offline, conflict, and error states.

Use precise permission language. Examples:

- “This operation requires a Master Key,” not “You are not an admin.”
- “This key was denied for schema access,” not “No streams exist.”
- “Enter a known saved-query name; this credential cannot list definitions,” not an empty list.
- “Dashboard service unavailable; local dashboards still work,” not “No dashboards.”
- “This public link contains a restricted bearer key,” not “anonymous.”

## 12. Testing requirements

### Unit

Test:

- host/path normalization;
- encoding;
- DELETE query serialization including nested OR, Unicode, arrays, dates, and reserved characters;
- credential routing/redaction;
- query form/raw JSON synchronization;
- timeframe/filter/funnel validation;
- result shapes and chart compatibility;
- metadata/unknown-field round trips;
- dashboard migrations and runtime filter/date patching;
- Access Key permission diff;
- encryption/lock;
- service-worker exclusions.

### Mock integration

Cover:

- success/empty/partial bulk success;
- all major HTTP errors;
- non-JSON/malformed responses;
- cancellation;
- large schema/results;
- restricted Access Keys;
- disabled updates;
- dashboard-service failure/CORS-like network errors;
- autosave races/conflicts;
- public-key lifecycle recovery.

Use synthetic fixtures only.

### End-to-end

Cover:

- key-only connect;
- read-only restricted user;
- all analysis builders;
- result/chart/export;
- known saved-query flow;
- Master saved-query CRUD;
- all dashboard widgets and connections;
- local export/import;
- service fallback;
- Access Key CRUD;
- event single/bulk;
- extraction;
- maintenance preview/no-request-on-mismatch;
- keyboard-only flow;
- vault lock;
- public viewer isolation.

### Live contract tests

Use only explicitly supplied disposable environment variables and skip otherwise:

```text
KEEN_TEST_PROJECT_ID
KEEN_TEST_READ_KEY
KEEN_TEST_WRITE_KEY
KEEN_TEST_MASTER_KEY
KEEN_TEST_ACCESS_KEY
KEEN_TEST_ANALYTICS_HOST
KEEN_TEST_DASHBOARD_HOST
```

Separate Analytics and Dashboard suites. Mutations use unique prefixes and clean up only test-created resources. Destructive event tests remain disabled by default. Never print credentials or live event data.

For the dashboard service, verify:

- CORS;
- accepted key types per read route;
- UUID IDs;
- custom metadata header;
- response/status behavior;
- metadata shape/timestamps;
- list behavior;
- public/private access;
- size limits;
- errors;
- deletion;
- whether public keys are exposed to broad readers.

## 13. Delivery sequence

Implement in this order:

### Phase 0

- repository foundation;
- Analytics client and safe schema/count spike;
- CORS/error characterization;
- credential vault skeleton;
- dashboard service contract spike;
- local dashboard proof;
- ADRs for visualization and dashboard compatibility.

### Phase 1

- connect/workspaces;
- Streams/schema/recent extraction;
- complete Explorer;
- core charts/table/raw inspector/export;
- capabilities/errors/rate scheduler.

### Phase 2

- saved/cached queries;
- extraction wizard;
- all visualization types through adapter.

### Phase 3

- local dashboard management/editor;
- all five widgets;
- themes/layout/recovery/accessibility;
- verified Keen dashboard adapter.

### Phase 4

- Access Key manager;
- least-privilege public sharing;
- public viewer/embed;
- key lifecycle recovery.

### Phase 5

- event writer/bulk import/snippets/Kafka helper;
- maintenance danger zone and review.

### Phase 6

- datasets;
- optional Organization extension;
- optional relay;
- localization/PWA polish.

Keep every phase shippable. Do not block the read-only core on Master-only or dashboard compatibility work.

## 14. Deliverables

Produce:

1. Working source code.
2. README with mission, key-only scope, setup, self-hosting, and security warnings.
3. Architecture documentation and ADRs.
4. Environment-variable reference.
5. Static-host deployment examples.
6. Optional relay deployment and threat model.
7. API feature/credential matrix in docs.
8. Dashboard compatibility report with tested date and sanitized results.
9. Test suites and synthetic fixtures.
10. Accessibility statement.
11. Security policy and vulnerability-reporting instructions.
12. License/third-party notices, especially for reused Keen packages.
13. A generated demo mode using local synthetic data only.
14. Release checklist proving no secrets or live data are committed.

## 15. Definition of done

The release is complete only when:

- no Keen account/session is required for project-level use;
- Project ID + Read/Access Key can inspect permitted streams and run permitted queries;
- a known saved query can be opened without definition-list privilege;
- every denied feature explains the required credential;
- all documented analyses and common query parameters work;
- raw request/response and accessible table fallbacks exist;
- local dashboards support chart/text/image/filter/date widgets;
- Keen dashboard persistence is isolated, tested, and optional;
- Access Key CRUD and least-privilege sharing work with Master;
- event bulk partial failures are visible;
- extraction limits/modes are represented;
- maintenance preview/lock/no-retry invariants pass;
- no plaintext keys or secret leakage paths remain;
- public dashboards never use a broad default key;
- keyboard and accessibility tests pass;
- static deployment works;
- local dashboard mode remains functional when every source-observed dashboard request fails.

## 16. Implementation behavior

Start by inspecting the repository and writing a concise gap analysis against this specification. Then implement Phase 0 and continue through the phases without replacing working code with throwaway mockups. Make reasonable defaults when details are not material. Where a Keen contract is uncertain, create an adapter, a contract test, a documented fallback, and an ADR rather than guessing or coupling the app to the uncertainty.

Use only official Keen documentation and Keen-owned open-source repositories as protocol authorities. Treat current server responses as the final validation source. Never bypass authorization or attempt to discover data outside the supplied credential's scope.

