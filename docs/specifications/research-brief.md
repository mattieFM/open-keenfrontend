# Keen Key-Only Open-Source Frontend
## End-to-End Feature, API, Security, and Implementation Brief

**Research date:** July 23, 2026  
**Target platform:** Keen.io Analytics API v3  
**Audience:** product, design, and engineering agents building an open-source alternative to the Keen project frontend  
**Primary user:** someone who has a Keen Project ID and one or more project API keys, but does **not** have a Keen account session and has **not** been added as a human member of the project  
**Status:** implementation-ready research brief; dashboard persistence includes one source-observed compatibility contract that must be live-tested before it is treated as stable

---

## 0. Executive decision

A useful key-only Keen frontend is feasible, but it must be designed as a **project-scoped API client**, not as a clone of Keen's account portal.

With a Project ID plus suitable project keys, the app can support nearly all data-plane work:

- inspect event streams and inferred schemas;
- view recent events by running extractions;
- build, run, visualize, export, and share ad-hoc analyses;
- retrieve saved-query results and, with a Master Key, create, edit, clone, list, and delete saved/cached queries;
- build dashboards containing charts, text, images, string filters, and date-range controls;
- create and manage restricted Access Keys when a Master Key is available;
- record single or bulk events when a Write, Master, or appropriately scoped Access Key is available;
- run synchronous or asynchronous extractions;
- perform carefully guarded data maintenance with a Master Key;
- optionally manage cached datasets;
- optionally generate Kafka and tracking-integration snippets.

Project keys do **not** reproduce Keen account identity or organization privileges. A key-only app must not pretend it can provide:

- Keen login, account recovery, profile, SSO, or account sessions;
- organization selection, membership, roles, invitations, or team management;
- billing, subscription, invoices, or plan administration;
- authoritative project display name, default project keys, project users, or organization metadata;
- creation, renaming, moving, or deletion of projects unless the user separately supplies an Organization ID and Organization Key;
- hosted-portal usage-limit checks that depend on organization/account context.

Replace the hosted portal's organization/project picker with a local **Workspace** concept: a user-supplied Project ID, local alias, API hosts, and zero or more labeled keys.

The hardest compatibility area is dashboard persistence. Keen's public UI documentation describes dashboard behavior, while the exact dashboard storage routes are visible in Keen's official open-source Dashboard Creator client rather than prominently specified in the main Analytics API reference. Implement those routes behind a feature flag and adapter, run live contract tests, and always provide a local IndexedDB plus JSON import/export fallback.

---

## 1. Research method and confidence labels

This brief reconstructs the documented and source-observable Keen frontend surface from Keen's official API reference, official product guides, and Keen-owned open-source repositories. It does not claim access to a private, authenticated Keen portal or undocumented server internals.

Every feature below is assigned one of these confidence classes:

| Label | Meaning | Engineering treatment |
|---|---|---|
| **[API]** | Explicitly documented in Keen's public Analytics API reference | Implement as a supported contract; still test normal error cases |
| **[UI]** | Explicitly described in Keen's public frontend/product documentation | Reproduce behavior using the mapped API or local state |
| **[SRC]** | Observed in an official Keen open-source frontend/client | Treat as a compatibility target; isolate behind an adapter and contract-test |
| **[LOCAL]** | Open-source frontend behavior with no Keen backend dependency | Implement locally and document its storage/security model |
| **[ORG]** | Requires Organization ID + Organization Key, not merely project keys | Optional extension, disabled unless both are supplied |
| **[HOSTED]** | Depends on Keen account/session/billing/team systems with no project-key equivalent identified | Out of scope for the key-only app; show a transparent explanation |

### Important interpretation rule

“Feature parity” means parity for **project data and project API workflows available through supplied keys**. It does not mean reverse-engineering Keen's login-protected account portal or bypassing project membership.

---

## 2. Product mission, users, and non-goals

### 2.1 Mission

Build a static-first, self-hostable, open-source web application that lets a user connect directly to a Keen project using their Project ID and API keys. It should expose every safe, useful project-level workflow supported by those credentials, clearly label permission requirements, and avoid requiring the user to be added to the project as a Keen account member.

### 2.2 Primary personas

1. **Read-only analyst** — has a Read Key or restricted Access Key; inspects streams, runs analyses/extractions, views saved results, and uses shared dashboards.
2. **Customer-facing viewer** — has a narrowly scoped Access Key; views only allowed queries/datasets and cannot administer the project.
3. **Event producer** — has a Write Key or write-scoped Access Key; tests and sends events.
4. **Project operator** — has a Master Key; manages saved queries, access keys, dashboards, and guarded maintenance.
5. **Organization operator, optional** — separately has Organization ID + Organization Key and chooses to enable organization/project administration.

### 2.3 Non-goals

- Do not ask for a Keen username/password or copy Keen's private authentication flow.
- Do not infer that possession of a Project ID means permission to read data.
- Do not attempt to retrieve keys the user did not supply.
- Do not use hidden browser-session endpoints.
- Do not put API keys in query strings except where a legacy external integration absolutely requires a URL; the app's own HTTP client must use the `Authorization` header.
- Do not auto-probe writes, updates, deletes, project deletion, or any other mutating capability.
- Do not make destructive APIs convenient at the expense of safety.
- Do not commit credentials, project IDs, event payloads, API responses, or live contract-test artifacts to the repository.

---

## 3. Keen credential and authorization model

### 3.1 Key types

| Credential | Intended capability | Key-only frontend use |
|---|---|---|
| **Master Key** | Can authenticate project API calls broadly and is required for administrative/destructive project operations | Saved-query definitions and CRUD, Access Key CRUD, dashboard writes where supported, schema/query work, maintenance. Treat as a root secret. |
| **Read Key** | Queries, extractions, schema inspection, and saved-query results | Default analytical key. Do not expose it in public URLs. |
| **Write Key** | Records events | Event composer, bulk importer, generated tracking snippets. It is not a read credential. |
| **Access Key** | Custom key with explicit `permitted` scopes and optional enforced restrictions/autofill | Preferred credential for customer-facing viewers and public dashboards. It can be intentionally narrower than a Read/Write Key. |
| **Organization Key** | Organization and project provisioning/metadata operations | Optional organization-admin plugin only. It is not interchangeable with a Master Key. |

### 3.2 Access Key scope vocabulary

Support these documented high-level permissions in the Access Key editor:

- `writes`
- `queries`
- `saved_queries`
- `cached_queries`
- `datasets`
- `schema`
- `query_definition` where supported by the API reference for reading saved-query definitions

Support the documented option families without discarding unknown properties:

- `options.writes.autofill`
- `options.queries.filters`
- `options.saved_queries.allowed`
- `options.saved_queries.blocked`
- `options.saved_queries.filters`
- `options.cached_queries.allowed`
- `options.cached_queries.blocked`
- `options.datasets.operations`
- `options.datasets.allowed`
- `options.datasets.blocked`
- `options.datasets.filters` or index restrictions as returned by the service

An Access Key cannot be used for Master-only administration or destructive operations. The UI must not show Access Key possession as “admin access.”

### 3.3 No reliable key-introspection flow

No general endpoint was identified that accepts an arbitrary project key and returns “this is a Read Key with these capabilities.” Access Key administration endpoints require a Master Key, and a restricted Access Key should not be expected to inspect itself.

Represent every capability as a tri-state:

```ts
type CapabilityState = 'unknown' | 'allowed' | 'denied';
```

Update state only after a relevant user-requested operation or an explicitly selected capability test. A `401` means authentication failure; a `403` generally means the presented key is valid but not permitted for that operation; a `404` can be either a missing resource or a deliberately hidden resource, so do not automatically interpret it as a permission result.

### 3.4 Safe and unsafe capability tests

| Test | Automatic? | Rationale |
|---|---:|---|
| `GET /projects/{id}/events?include_schema=false` | Yes, after user presses **Connect** | Read-only, low payload; tests schema-list access |
| User-created harmless count query | Only when user presses **Run** | A query can incur compute cost and rate use |
| `GET /projects/{id}/dashboards/metadata` on the dashboard host | Yes only when dashboard compatibility is enabled | Read-only, but uses source-observed service |
| `GET /projects/{id}/keys?per_page=1` | Only after explicit **Check Master access** | Reveals key-management data; Master-only |
| Send a test event | Never automatically | Mutates project data |
| Create/update/delete a saved query or dashboard | Never automatically | Mutates project resources |
| Update/delete events, property, collection, dataset, project | Never automatically | Destructive or materially mutating |

---

## 4. API topology and client boundaries

Define independent configurable service clients. Do not concatenate all routes under one host.

```text
ANALYTICS_API = https://api.keen.io/3.0
DASHBOARD_API = https://dashboard-service.k-n.io          # source-observed; no /3.0 prefix
ORGANIZATION_API = https://api.keen.io/3.0/organizations  # optional org extension
```

Support custom Analytics and Dashboard hosts for Keen custom-domain deployments. Validate hosts as HTTPS by default. Allow HTTP only in an explicit local-development mode.

### 4.1 Standard Analytics API route

```text
{ANALYTICS_API}/projects/{PROJECT_ID}/...
```

Use:

```http
Authorization: <KEY>
Content-Type: application/json
Accept: application/json
```

Use API v3 routes. Do not build new work on deprecated v1/v2 forms.

### 4.2 Dashboard service route, source-observed

```text
{DASHBOARD_API}/projects/{PROJECT_ID}/dashboards/...
```

Reads use the configured dashboard read/access key. Writes use the configured Master Key in Keen's official Dashboard Creator source. Dashboard save includes metadata in a custom header; preserve this behind the dashboard adapter rather than spreading it through UI code.

### 4.3 Kafka clusters, non-browser integration

The official API reference describes:

```text
Inbound producer brokers: b1.kafka-in.keen.io:9092, b2..., b3...
Outbound consumer brokers: b1.kafka-out.keen.io:9092, b2..., b3...
Mechanism: SASL_SSL / PLAIN
Username: Project ID
Inbound password: Write Key
Outbound password: Read Key
Topic: event collection name
```

A browser frontend cannot directly act as a conventional Kafka producer/consumer over these TCP brokers. Provide code/config generators, copyable environment-variable templates, and setup guidance; do not attempt direct browser Kafka connectivity.

---

## 5. Master feature-to-backend map

Legend: **A** = Analytics API, **D** = dashboard service adapter, **L** = local-only, **O** = optional Organization API.

| Frontend area | Feature | Backend interaction | Credential | Class | Notes |
|---|---|---|---|---|---|
| Connect | Add local workspace | L: IndexedDB/session memory | None | [LOCAL] | Local alias, Project ID, hosts, labeled keys |
| Connect | Test schema access | A: `GET /projects/{id}/events?include_schema=false` | Read, Master, or Access Key with `schema` | [API] | Do not call until user submits |
| Connect | Test Master access | A: `GET /projects/{id}/keys?per_page=1` | Master | [API] | Explicit opt-in test only |
| Project header | Show project name | L alias; O project metadata if org extension enabled | None or Organization Key | [LOCAL]/[ORG] | Project key alone does not provide an authoritative human name |
| Streams | List event collections | A: `GET /projects/{id}/events?include_schema=true|false` | Read/Master/schema Access Key | [API] | Up to 5,000 collections returned |
| Streams | Search/sort/filter collections | L over fetched schema list | None | [LOCAL] | Preserve server response order but offer name/property filters |
| Stream detail | Collection schema | A: `GET /projects/{id}/events/{collection}` | Read/Master/schema Access Key | [API] | Returns flattened property paths and inferred types |
| Stream detail | Property detail | A: `GET /projects/{id}/events/{collection}/properties/{property}` | Read/Master/schema Access Key | [API] | Encode each path segment safely |
| Stream detail | Recent event values | A: `POST /projects/{id}/queries/extraction` with `latest` and limited `property_names` | Read/Master/query Access Key | [API]/[UI] | Schema endpoint does not return recent values |
| Stream detail | Copy property path/type | L | None | [LOCAL] | Dot paths represent nested properties |
| Data Explorer | Run analysis | A: `POST /projects/{id}/queries/{analysis_type}` | Read/Master/query Access Key | [API]/[UI] | Prefer POST to avoid long URLs |
| Data Explorer | Query builder controls | L creates request body; schema calls supply choices | None plus schema/read key | [LOCAL]/[API] | Analysis, stream, target, timeframe, filters, group, order, limit, interval, timezone |
| Data Explorer | Filter value suggestions | A: small `select_unique` query or extraction; L cache | Query key | [API]/[LOCAL] | Off by default or user-triggered because suggestions consume query capacity |
| Data Explorer | Execution metadata | A query body `include_metadata: true` | Query key | [API] | Show processing time and scan stats when returned |
| Data Explorer | Result visualization | L transforms query response | None | [LOCAL]/[UI] | Metric, table, line, area, bar, pie, donut, funnel, gauge, heatmap, bubble, choropleth where compatible |
| Data Explorer | CSV/JSON result export | L from response; extraction may stream native formats | None / query key | [LOCAL]/[API] | Never re-upload exported data |
| Data Explorer | Chart image export | L, SVG/canvas serialization | None | [LOCAL]/[UI] | Add accessible table companion |
| Saved Queries | Create/update | A: `PUT /projects/{id}/queries/saved/{name}` | Master | [API] | Body contains `query`, optional `refresh_rate`, `metadata` |
| Saved Queries | List definitions | A: `GET /projects/{id}/queries/saved` | Master | [API] | Access/read keys cannot assume list access |
| Saved Queries | Read one definition | A: `GET /projects/{id}/queries/saved/{name}` | Master or Access Key with `query_definition` | [API] | Use this for allowed-name workflows when full list is unavailable |
| Saved Queries | Run/retrieve result | A: `GET /projects/{id}/queries/saved/{name}/result` | Read/Master or allowed saved/cached Access Key | [API] | Cached and non-cached permission differs for Access Keys |
| Saved Queries | Clone | L read definition, then A PUT under a new name | Master | [API]/[LOCAL] | Preserve unknown metadata fields |
| Saved Queries | Delete | A: `DELETE /projects/{id}/queries/saved/{name}` | Master | [API] | Confirm by exact name |
| Saved Queries | Search/sort/tags/cache filter/auto-run toggle | L | None | [LOCAL]/[UI] | Tags can live in user metadata; auto-run is a local preference |
| Dashboards | List metadata | D: `GET /projects/{id}/dashboards/metadata` | Dashboard read/access key | [SRC] | Contract-test; provide local dashboard list fallback |
| Dashboards | Load dashboard | D: `GET /projects/{id}/dashboards/{dashboardId}` | Dashboard read/access key | [SRC] | Chart data then comes from Analytics API |
| Dashboards | Load one metadata record | D: `GET /projects/{id}/dashboards/{dashboardId}/metadata` | Dashboard read/access key | [SRC] | Used by public viewer and management UI |
| Dashboards | Create/save/autosave | D: `PUT /projects/{id}/dashboards/{dashboardId}` | Master | [SRC]/[UI] | Save dashboard JSON and compatible metadata header; debounce and serialize writes |
| Dashboards | Update metadata | D: `PUT /projects/{id}/dashboards/{dashboardId}/metadata` | Master | [SRC] | Name, tags, public state, key metadata |
| Dashboards | Delete | D: `DELETE /projects/{id}/dashboards/{dashboardId}` | Master | [SRC] | Also revoke/delete share key if the app owns it |
| Dashboards | Local-only mode | L: IndexedDB + JSON import/export | None | [LOCAL] | Required fallback when D contract/CORS is unavailable |
| Dashboard chart | Ad-hoc chart data | A: analysis endpoint | Query key | [API]/[UI] | Query stored inside dashboard document |
| Dashboard chart | Saved-query chart data | A: saved result endpoint; optional definition endpoint for editing | Read/access; Master or query-definition Access Key to edit definition | [API]/[UI] | Allow detach to make a dashboard-local query |
| Dashboard text | Rich text | L, stored in dashboard document | None | [LOCAL]/[UI] | Sanitize; no executable HTML |
| Dashboard image | Remote image URL | Browser fetches remote asset; config stored in dashboard document | None | [LOCAL]/[UI] | HTTPS only by default; no-referrer; failed-image UI |
| Dashboard filter | Cross-chart string filter | L patches compatible chart query bodies before A requests | Query key for reruns | [LOCAL]/[UI] | Same collection only; funnels excluded; string schema properties only |
| Dashboard date range | Cross-chart timeframe override | L patches associated chart queries before A requests | Query key for reruns | [LOCAL]/[UI] | Maximum one date-range widget per chart |
| Dashboard sharing | Create restricted public key | A: `POST /projects/{id}/keys` | Master | [API]/[UI]/[SRC] | Generate least-privilege Access Key, not a Read or Master Key |
| Dashboard sharing | Toggle public / regenerate | A key CRUD plus D metadata update | Master | [API]/[SRC] | Revoke/delete old key before or after atomic metadata transition, with recovery UI |
| Dashboard sharing | Public viewer | D load + A chart requests | Embedded restricted Access Key | [SRC]/[LOCAL] | Put token in URL fragment or inject at runtime; immediately remove fragment from visible history |
| Access Keys | Create | A: `POST /projects/{id}/keys` | Master | [API]/[UI] | JSON and form modes |
| Access Keys | List/search/page | A: `GET /projects/{id}/keys?name=&page=&per_page=` | Master | [API] | `per_page` maximum/default documented as 200 |
| Access Keys | Read one | A: `GET /projects/{id}/keys/{key}` | Master | [API] | Treat key path as secret; redact logs |
| Access Keys | Update | A: `POST /projects/{id}/keys/{key}` | Master | [API] | Preserve unknown options |
| Access Keys | Revoke/unrevoke | A: `POST /projects/{id}/keys/{key}/revoke` or `/unrevoke` | Master | [API] | Prefer revoke over delete for recoverability |
| Access Keys | Delete | A: `DELETE /projects/{id}/keys/{key}` | Master | [API] | Irreversible; exact-name/key confirmation |
| Event writer | Send one event | A: `POST /projects/{id}/events/{collection}` | Write/Master/write Access Key | [API] | JSON body; event may become queryable after a short delay |
| Event writer | Send bulk events | A: `POST /projects/{id}/events` | Write/Master/write Access Key | [API] | Inspect every per-event status even on HTTP 200 |
| Event writer | Event/code snippet generator | L | None | [LOCAL] | cURL, JavaScript, Node, Kafka configuration; credentials as environment placeholders |
| Extractions | Synchronous extraction | A: `POST /projects/{id}/queries/extraction` | Read/Master/query Access Key | [API] | Inline response; honor scan/result limits |
| Extractions | Asynchronous/email extraction | A same endpoint with `email` and format options | Read/Master/query Access Key | [API] | Keen emails a temporary download link; disclose email transfer |
| Maintenance | Preview affected records | A count + extraction | Read/Master | [API] | Required step before a mutation |
| Maintenance | Delete matching events | A: `DELETE /projects/{id}/events/{collection}?filters=...&timeframe=...&timezone=...` | Master | [API] | Body is ignored; malformed/missing query scope can delete far more data |
| Maintenance | Delete property | A: `DELETE /projects/{id}/events/{collection}/properties/{property}` | Master | [API] | Irreversible |
| Maintenance | Delete collection | A: `DELETE /projects/{id}/events/{collection}` | Master | [API] | Subject to collection-size/rate limits |
| Maintenance | Update matching events | A: `PUT /projects/{id}/events/{collection}` | Master and server-side feature enablement | [API] | Non-atomic; disabled by default on many projects |
| Datasets | Create | A: `PUT /projects/{id}/datasets/{name}` | Master | [API] | Early Release; create-only definition behavior |
| Datasets | List/get/results | A: `GET /datasets`, `/datasets/{name}`, `/datasets/{name}/results` | Read/Master/allowed dataset Access Key | [API] | Indexed cached query results |
| Datasets | Delete | A: `DELETE /projects/{id}/datasets/{name}` | Master | [API] | Confirm name; early-release feature |
| Project admin | Get/create/update/delete project | O: `/organizations/{orgId}/projects...` | Organization Key | [ORG] | Optional plugin only |
| Account/team/billing | Login, members, plan, invoices, profile, SSO | No supported project-key API identified | Keen account/session | [HOSTED] | Explain as unavailable; never simulate |

---
## 6. Detailed functional specification

## 6.1 Connect and local workspaces

### User flow

1. User opens the app and chooses **Add Keen workspace**.
2. User enters:
   - a local display name;
   - Project ID;
   - Analytics API host, prefilled with `https://api.keen.io/3.0`;
   - optional Dashboard API host, prefilled with `https://dashboard-service.k-n.io` but disabled until compatibility is accepted;
   - one or more labeled credentials: Read, Write, Master, Access, or Organization;
   - optional Organization ID, shown only when the organization extension is enabled.
3. User chooses storage mode:
   - **This tab only** — credentials remain in memory;
   - **This browser session** — encrypted session persistence;
   - **Encrypted on this device** — IndexedDB ciphertext protected by a passphrase-derived key;
   - **No credential storage** — retain only non-secret workspace metadata.
4. On **Connect**, perform only the selected safe read test. Show the exact operation before it runs.
5. Land on the workspace overview with capability badges: Unknown, Available, Denied, or Not configured.

### Requirements

- Permit multiple keys of the same type with user-defined labels, because an Access Key may be more appropriate for one dashboard than another.
- Never identify key type by string length or appearance.
- Route each operation to the least-privileged configured credential that can satisfy it.
- Let the user explicitly override credential selection per request.
- Show only the first and last four characters in normal UI; require a deliberate reveal action.
- Do not include any secret in URL state, Redux/Zustand devtools, telemetry, crash reports, or console output.
- Offer encrypted workspace export with secrets excluded by default. A plaintext secret export must require a separate, strongly worded action.
- A local alias is not the project's authoritative name. Label it **Workspace name on this device**.
- Support custom Analytics hosts without silently appending duplicate `/3.0` path segments.
- Detect likely CORS/network failure separately from `401`, `403`, or server errors. Offer a documented, optional same-origin relay deployment rather than weakening browser security.

### Optional relay

The core app should work as a static SPA when Keen permits the browser origin. Provide an optional minimal relay for deployments that need custom CORS handling. The relay must:

- be disabled by default;
- accept only allow-listed upstream Keen hosts;
- never store credentials or bodies;
- strip cookies;
- set request-size limits;
- redact authorization data from logs;
- prevent SSRF through DNS/IP validation;
- preserve status code, response body, and safe headers;
- never turn a project key into a multi-user server-side session.

## 6.2 Workspace overview

Show a local, derived overview rather than making up unavailable account data:

- workspace alias and Project ID;
- active API hosts;
- configured credential labels, masked;
- capability status by module;
- schema collection count when available;
- recent local query history and drafts;
- dashboard storage mode: Keen service compatible, local-only, or hybrid;
- warnings for Master/Organization keys stored on device;
- latest observed API error/rate-limit state;
- links to Streams, Explorer, Saved Queries, Dashboards, Access Keys, Event Writer, Extraction, Maintenance, Datasets, and Settings.

Do not display billing tier, remaining event quota, organization name, or project members unless an explicit organization/account API supplies those values.

## 6.3 Streams and schema browser

### Collection list

Use:

```http
GET /3.0/projects/{projectId}/events?include_schema=false
Authorization: <read-or-schema-capable-key>
```

Fetch `include_schema=true` only when the property inventory is needed, because it can be substantially larger. The API returns up to 5,000 collections.

Collection-list features:

- search by collection name;
- optional search by flattened property path after full schema is loaded;
- display property count, schema loaded state, and last locally observed activity;
- refresh and cancel;
- copy collection name;
- open in Explorer;
- open recent events;
- open event composer prefilled to this collection;
- Master-only guarded delete action in a separate danger menu.

### Collection detail

Use:

```http
GET /3.0/projects/{projectId}/events/{encodedCollection}
```

Render a sortable table of flattened property path and inferred type. The documented primitive schema types are string, number/`num`, boolean/`bool`, and array/list forms. Preserve any unrecognized type string returned by the server.

Nested event objects are addressed in queries with dot paths such as `customer.id`. A literal period must not be treated as a valid new property-name character merely because schema paths contain periods.

Features:

- search properties;
- filter by type;
- copy path;
- open one-property detail;
- add property as Explorer target, group, filter, or order field;
- show type-specific compatible operators;
- show that schema is inferred from events and can evolve;
- do not imply nullability or strict schema enforcement from the inferred type list.

### Recent events

The Streams UI described by Keen shows property values from recent events. Implement that through a bounded extraction, not through schema inspection:

```http
POST /3.0/projects/{projectId}/queries/extraction
{
  "event_collection": "purchases",
  "timeframe": "this_14_days",
  "latest": 25,
  "property_names": ["keen.timestamp", "customer.id", "amount"]
}
```

Requirements:

- default to a small recent count, such as 25;
- expose 10/25/50/100 presets;
- require explicit approval before extracting hundreds of properties;
- start with `keen.timestamp` plus visible columns;
- allow column selection and virtualized rows;
- provide JSON-tree and table views;
- redact nothing automatically, because the frontend cannot know business sensitivity, but display a persistent warning that raw events may contain personal data;
- do not cache raw event bodies in a service worker;
- allow local download only after user action.

## 6.4 Data Explorer

The Explorer is the core feature and must be usable with only a Project ID and a query-capable key.

### 6.4.1 Analysis types

| Analysis | Endpoint suffix | Required query-specific fields | Typical result |
|---|---|---|---|
| Count | `count` | `event_collection`, `timeframe` | scalar, grouped values, or intervals |
| Count Unique | `count_unique` | plus `target_property` | scalar/grouped/interval |
| Sum | `sum` | numeric `target_property` | scalar/grouped/interval |
| Average | `average` | numeric `target_property` | scalar/grouped/interval |
| Minimum | `minimum` | target property | scalar/grouped/interval |
| Maximum | `maximum` | target property | scalar/grouped/interval |
| Median | `median` | numeric target property | scalar/grouped/interval; may be approximate at scale |
| Percentile | `percentile` | numeric target and percentile parameter as required by the API | scalar/grouped/interval; may be approximate at scale |
| Select Unique | `select_unique` | `target_property` | unique value array, optionally grouped/interval-shaped where accepted |
| Standard Deviation | `standard_deviation` | numeric target property | scalar/grouped/interval |
| Extraction | `extraction` | event collection/timeframe; optional latest/properties/format/email | raw events or extraction job response |
| Funnel | `funnel` | ordered `steps`, each with collection and actor property; timeframe | array of step counts |
| Multi-analysis, advanced | `multi_analysis` | collection/timeframe plus named analyses map | object of multiple results, grouped/interval variants |

The official Data Explorer guide describes 12 user-facing analysis types including extraction and funnel. Treat multi-analysis as an advanced API-completeness extension rather than claiming it is part of the documented Explorer UI.

### 6.4.2 Query draft model

Keep one canonical API-shaped query object, plus local visualization settings:

```ts
type RelativeTimeframe = string;
type AbsoluteTimeframe = { start: string; end: string };

type KeenFilter =
  | {
      property_name: string;
      operator: string;
      property_value?: unknown;
    }
  | {
      operator: 'or';
      operands: KeenFilter[];
    };

type QueryDraft = {
  analysis_type: string;
  event_collection?: string;
  target_property?: string;
  timeframe?: RelativeTimeframe | AbsoluteTimeframe;
  timezone?: string | number;
  filters?: KeenFilter[];
  group_by?: string | string[] | Record<string, unknown> | Array<string | Record<string, unknown>>;
  order_by?: Array<{ property_name: string; direction?: 'ASC' | 'DESC' }>;
  limit?: number;
  interval?: string;
  zero_fill?: boolean;
  include_metadata?: boolean;
  latest?: number;
  property_names?: string[];
  steps?: FunnelStep[];
  analyses?: Record<string, Record<string, unknown>>;
  [unknownParameter: string]: unknown;
};

type VisualizationDraft = {
  type: 'metric' | 'table' | 'line' | 'area' | 'bar' | 'pie' | 'donut' |
        'funnel' | 'gauge' | 'heatmap' | 'bubble' | 'choropleth';
  title?: string;
  subtitle?: string;
  valueFormat?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  [unknownSetting: string]: unknown;
};
```

Never destructively normalize away API fields that the current app version does not understand. Provide a raw JSON editor synchronized with the form and validate before execution.

### 6.4.3 Form behavior

1. **Analysis** — controls which fields are visible and required.
2. **Event stream** — schema-backed combobox with manual entry fallback.
3. **Target property** — filter choices by compatible inferred type but allow manual override.
4. **Timeframe**:
   - relative builder for `this_N_units` and `previous_N_units`;
   - convenience values such as today/yesterday/previous week;
   - absolute start/end with timezone-bearing ISO-8601 values;
   - end is exclusive; communicate this in the UI.
5. **Timezone**:
   - available for relative timeframes;
   - IANA timezone name or numeric seconds offset where accepted;
   - ignored by the API for absolute timeframes, so disable it rather than implying an effect;
   - use `Intl.supportedValuesOf('timeZone')` when available and a bundled fallback list, not a Keen account endpoint.
6. **Interval**:
   - minutely, hourly, daily, weekly, monthly, yearly;
   - custom `every_N_minutes|hours|days|weeks|months|years` where accepted;
   - warn before combinations likely to create thousands of intervals; API limit is 9,000 intervals.
7. **Filters** — nested builder plus raw JSON mode.
8. **Group by** — one or more properties, plus an advanced raw mode for numeric ranges/buckets.
9. **Order by** — available when grouping supports it; order by result or group properties; ascending default.
10. **Limit** — available with grouped/orderable results; validate positive integer.
11. **Zero fill** — default true when supported; warn that interval × group combinations can inflate response size.
12. **Metadata** — optional diagnostics switch.
13. **Run** — never execute on every keystroke by default. Provide an optional debounced auto-run preference with an explicit cost/rate warning.

### 6.4.4 Filter operator matrix

Use schema types to offer sensible operators, while preserving raw API capability:

| Type | Operators to expose |
|---|---|
| String | `eq`, `ne`, `lt`, `gt`, `exists`, `in`, `contains`, `not_contains`, `regex` |
| Number | `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `exists`, `in` |
| Boolean | `eq`, `exists`, `in` |
| Array/list | operators only when documented/verified for the element type; otherwise raw mode |
| Geographic coordinate | `within` with coordinates and distance |
| Any | top-level/nested `or` group whose `operands` contain normal filters |

Normal filter arrays are ANDed. An `or` filter contains its alternatives in `operands`. The regex engine is RE2-compatible; reject unsupported constructs only when confidently detectable. Geographic filtering is incompatible with `group_by`; show a validation error before the request.

### 6.4.5 Funnel editor

Each step contains at minimum:

```ts
type FunnelStep = {
  event_collection: string;
  actor_property: string;
  timeframe?: RelativeTimeframe | AbsoluteTimeframe;
  filters?: KeenFilter[];
  optional?: boolean;
  inverted?: boolean;
  [key: string]: unknown;
};
```

Requirements:

- drag/reorder steps;
- duplicate/remove step;
- select a collection and actor property per step;
- set shared timeframe with step override where accepted;
- set step filters;
- expose optional and inverted states;
- explain actor identity consistency;
- no interval or group-by controls for funnel;
- warn that the documented funnel actor maximum is 1,000,000;
- chart as funnel and always provide a step-count/conversion table.

### 6.4.6 Query execution

Prefer:

```http
POST /3.0/projects/{projectId}/queries/{analysisType}
Authorization: <query-capable-key>
Content-Type: application/json

{ ...queryBodyWithoutAnalysisType }
```

Implementation requirements:

- use `AbortController` for cancel;
- generate a stable request fingerprint that excludes the credential;
- deduplicate identical in-flight reads;
- do not run duplicate retries concurrently;
- retry only idempotent reads and only for network failures, `429`, or `503`, using bounded exponential backoff with jitter;
- do not automatically retry a POST query unless the client can guarantee it is a pure read and the user has not cancelled; even then, cap retries and surface them;
- never retry write, update, or delete calls automatically;
- show elapsed client time and server metadata when returned;
- show the exact redacted request in a request inspector;
- copy cURL with `Authorization: ${KEEN_KEY}`, never the real key;
- keep raw response available beside normalized results.

### 6.4.7 Result normalization and chart compatibility

Do not force every response into one lossy schema. Detect and preserve:

- scalar envelope: `{ "result": 123 }`;
- grouped rows: `{ "result": [{ "country": "CA", "result": 12 }] }`;
- interval rows: objects containing a timeframe and `value`;
- interval + group: interval `value` arrays;
- unique arrays;
- extraction arrays or streamed formats;
- funnel step arrays;
- multi-analysis result objects;
- metadata fields adjacent to `result`.

Suggested chart rules:

| Semantic shape | Default | Alternatives |
|---|---|---|
| Single numeric scalar | Metric | Gauge, table |
| One categorical grouping | Bar | Pie, donut, table |
| Two categorical dimensions | Table | Heatmap when the value is numeric |
| Time interval + scalar | Line | Area, bar, table |
| Time interval + categorical groups | Multi-series line | Area, grouped/stacked bar, table |
| Funnel | Funnel | Table |
| Extraction / arbitrary records | Table/JSON | No misleading aggregate chart |
| Select unique | Table/list | Bar only if transformed into counts through a different query |
| Geographic category/value | Choropleth only when a supported geographic identifier mapping exists | Table/bar |
| Three or more meaningful numeric dimensions | Bubble, after explicit mapping | Table |

Always show a table/JSON fallback. Disable incompatible chart choices instead of producing nonsense. Explain why a chart is unavailable.

### 6.4.8 Explorer local features

These do not need Keen APIs:

- draft autosave;
- undo/redo;
- query history with timestamps and redacted credential label;
- duplicate draft;
- compare two result snapshots locally;
- pin to local dashboard;
- export query JSON;
- import query JSON;
- share a query definition through a local URL-safe document that excludes credentials, or a downloadable file;
- optional chart embed code that expects Project ID/key to be injected at runtime.

## 6.5 Saved and cached queries

### Create/update

```http
PUT /3.0/projects/{projectId}/queries/saved/{queryName}
Authorization: <master-key>
Content-Type: application/json

{
  "query": {
    "analysis_type": "count",
    "event_collection": "purchases",
    "timeframe": "this_14_days"
  },
  "refresh_rate": 0,
  "metadata": {
    "display_name": "Purchases — 14 days",
    "tags": ["commerce", "core"]
  }
}
```

Names are restricted to alphanumeric characters, hyphens, and underscores. Keep the API name separate from a human-readable display name in metadata.

### List and detail behavior

Reproduce the documented Saved Queries frontend features:

- centralized list;
- search by name/display name;
- sort alphabetically or by observed/metadata date;
- filter by user tags;
- filter by cached/not cached/error status when determinable;
- selected-query preview with chart, raw result, and query parameters;
- local auto-run-on-select toggle, default on only if the user accepts it;
- clone;
- edit;
- delete;
- download result and definition;
- share definition without a credential;
- add to dashboard.

### Permission-dependent list strategy

- With a Master Key, use `GET /queries/saved` to list definitions.
- With a Read Key, do not assume definition-list access. Allow the user to enter a known saved query name and retrieve `/result`.
- With an Access Key, allow known names, and use definition retrieval only when `query_definition` is permitted. A key may allow a subset of saved/cached names.
- Keep a local index of successfully opened known query names, clearly labeled as local history rather than authoritative server inventory.

### Caching

A saved query becomes cached through `refresh_rate`. Official documentation contains an inconsistency in the stated upper refresh interval: one general limits section describes a range above four hours and below 24 hours, while another cached-query section has historically shown an upper value corresponding to 48 hours. Do not hardcode a disputed upper boundary. Validate a positive integer, suggest conservative presets beginning at four hours, submit to the server, and show server validation verbatim.

When caching is on:

- mark result retrieval as cached when the response or definition makes that clear;
- display refresh rate and last/next known refresh only when provided or reliably derived;
- do not imply immediate recomputation after definition changes;
- distinguish Access Key `saved_queries` permission from `cached_queries` permission.

### Metadata preservation

Treat `metadata` as user-defined JSON. The UI can conventionally use `display_name`, `tags`, visualization settings, and notes, but it must round-trip unknown keys exactly.

## 6.6 Dashboard management and editor

### 6.6.1 Dashboard list

Reproduce documented management behavior:

- new dashboard;
- list/grid view;
- search by title;
- sort most recent, oldest, A–Z, Z–A;
- filter by tag and public/private state;
- title and tags;
- open view mode;
- edit;
- clone;
- delete;
- share/public settings;
- embed snippet;
- dashboard-level theme preview.

A clone must receive a new ID and must be private by default even if the source was public.

### 6.6.2 Dashboard document

Use an internal versioned document independent of the persistence adapter:

```ts
type DashboardDocument = {
  schemaVersion: number;
  id: string;
  title: string;
  tags: string[];
  widgets: DashboardWidget[];
  layout: Array<{
    widgetId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    minWidth?: number;
    minHeight?: number;
  }>;
  settings?: {
    gridGap?: number;
    background?: string;
    fonts?: Record<string, unknown>;
    tile?: Record<string, unknown>;
    [key: string]: unknown;
  };
  theme?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
```

Build migration functions from each old local schema version. Keep the Keen-compatible serializer/deserializer in the dashboard adapter.

### 6.6.3 Widget types

#### A. Chart widget

Data source modes:

1. **Ad-hoc query** — query body is stored in the dashboard document and executed through the Analytics API.
2. **Saved query** — stores saved-query name and uses the saved result endpoint.
3. **Detached saved query** — copies the definition into a local ad-hoc query so later server changes no longer propagate.

Features:

- use the full Explorer editor in a modal/drawer;
- chart type constrained by semantic result shape;
- title, subtitle, value/axis/legend formatting;
- loading, empty, error, partial, and stale states;
- retry/cancel;
- refresh one/all;
- inspect redacted request and raw response;
- clone and delete;
- resize and move;
- keyboard reordering and resize alternatives;
- table fallback.

When a chart remains linked to a saved query, server-side definition edits can propagate. The dashboard should make the link visible and provide **Detach from saved query**.

#### B. Rich-text widget

Features:

- headings, paragraphs, bold, italic, links, lists, alignment, size, and color;
- safe Markdown or constrained rich-text JSON;
- sanitize rendered output;
- strip scripts, inline event handlers, iframes, forms, and dangerous URLs;
- external links use `rel="noopener noreferrer"`;
- no arbitrary untrusted HTML mode by default.

#### C. Image widget

Features:

- HTTPS source URL;
- alt text required unless marked decorative;
- fit modes: contain, cover, original;
- optional caption/link;
- load error placeholder;
- `referrerpolicy="no-referrer"`;
- no `javascript:`, `file:`, or arbitrary executable data URLs;
- explain that the image host receives the viewer's network request.

#### D. Filter widget

Reproduce the documented dashboard filter semantics:

- choose one event collection;
- choose a string property from its schema;
- choose one or more chart widgets using the same collection;
- funnel charts are not eligible;
- a filter can target multiple charts;
- a chart can receive multiple filter widgets;
- filter values may come from manual options or an explicit `select_unique` request;
- support single-select, multi-select, clear, default value, and search;
- combine filter-widget constraints with the chart's own filters using AND, preserving nested OR groups;
- visibly distinguish persistent query filters from temporary dashboard filters.

Do not modify and save the original saved-query definition merely because a viewer changes a dashboard filter. Patch the runtime request only.

#### E. Date-range widget

Features:

- relative and absolute controls;
- timezone for relative ranges;
- choose one or more charts;
- maximum one date-range widget per chart;
- override only the runtime timeframe/timezone;
- restore the chart's configured timeframe when cleared;
- show inherited versus overridden state.

### 6.6.4 Editor behavior

- Add widgets by toolbar click and drag/drop.
- Drag and resize chart, image, and text widgets; filter/date widgets may have constrained sizing.
- Clone chart, text, and image widgets. Do not clone filter/date-range widgets unless intentionally improving beyond Keen parity and clearly handling connections.
- Delete with undo toast before persistence settles.
- Preview/view mode separate from edit mode.
- Autosave changes, but debounce and serialize writes. Never allow an older response to overwrite a newer local revision.
- Show saving, saved, offline/local-only, conflict, and failed states.
- Keep a local recovery journal before sending remote writes.
- For major changes, expose **Clone before editing**.
- Support grid zoom, mobile breakpoint preview, and deterministic layout reflow.

### 6.6.5 Themes

Support dashboard-level customization comparable to the official source model:

- page background;
- grid gap;
- font families;
- title/subtitle/legend typography;
- tile background, border, radius, width, padding, and shadow;
- color palette;
- chart-specific overrides.

Provide accessible presets with adequate contrast. A theme must not remove focus indicators or make status colors the only signal.

### 6.6.6 Persistence modes

1. **Keen-compatible service mode [SRC]** — uses the source-observed dashboard service contract.
2. **Local mode [LOCAL]** — IndexedDB, JSON export/import, no Keen dashboard API dependency.
3. **Hybrid mode [LOCAL]** — local draft/recovery plus explicit publish/sync to the dashboard service.

The app must remain useful when dashboard-service access is denied, unavailable, CORS-blocked, or changed.

## 6.7 Public dashboard sharing

### Recommended secure flow

1. Master user selects **Make public**.
2. App analyzes every chart data source and computes the least privilege needed.
3. Prefer saved/cached query allow-lists. If a chart uses an unrestricted ad-hoc query, offer:
   - convert it to a saved query;
   - create a filtered `queries` Access Key only when tenant restrictions are known;
   - keep the dashboard private.
4. Create one dedicated Access Key named for the dashboard and include only required scopes/options.
5. Store only the required compatibility metadata in the dashboard service. Keep a local record that this app owns the generated key.
6. Generate a public route such as:

```text
/public/{projectId}/{dashboardId}#key={restrictedAccessKey}
```

7. Public viewer reads the fragment into memory and immediately uses `history.replaceState` to remove it from the visible URL. Set `Referrer-Policy: no-referrer`.
8. Public viewer loads dashboard layout from the dashboard service and chart data from the Analytics API.

A URL fragment reduces accidental transmission in HTTP requests and referrers, but the key is still a bearer credential delivered to the browser. Its real protection is narrow Access Key scope.

### Regenerate/private transitions

- **Regenerate**: create replacement key, update dashboard metadata, verify new viewer, then revoke/delete old key. If any step fails, show recovery actions and never silently leave two active public keys.
- **Make private**: revoke key first, update metadata second, and preserve enough local state to retry metadata cleanup.
- **Delete dashboard**: revoke/delete an app-owned share key before or as part of the delete workflow. If remote dashboard deletion succeeds but key deletion fails, surface an orphaned-key cleanup task.
- Never delete a key the app did not create unless the user explicitly selects it and confirms.

### Embed

Generate two embed modes:

- **Public-link iframe** — simple but exposes the narrowly scoped key to the viewer by design.
- **Authenticated host integration** — recommended; the host application injects a short-lived or appropriately scoped Access Key into the viewer at runtime.

Do not embed a Master, Read, Write, or Organization Key.

## 6.8 Access Key management

### List

```http
GET /3.0/projects/{projectId}/keys?name={optional}&page={n}&per_page={1..200}
Authorization: <master-key>
```

Features:

- paginated list;
- search by name;
- active/revoked state;
- permission chips;
- view structured options and raw JSON;
- copy/reveal with deliberate action;
- edit, clone policy, revoke, unrevoke, delete;
- identify keys created by this app using a naming convention/local registry without assuming server metadata not documented.

### Create/update form

Form sections:

1. Name, maximum 256 characters.
2. Active state.
3. High-level permissions.
4. Write autofill JSON.
5. Mandatory query filters.
6. Saved-query allowed/blocked names and filters.
7. Cached-query allowed/blocked names.
8. Dataset operations and allowed/blocked/index restrictions.
9. Raw JSON preview/editor.
10. Effective-policy summary in plain language.

Validation rules:

- blocked/allowed conflicts must be surfaced;
- mandatory filters must be valid Keen filter objects;
- never claim that a UI preview proves the server's final enforcement;
- preserve unknown options returned by the API;
- allow users to revoke rather than delete;
- show a warning when granting unrestricted `queries` because it may expose all queryable project data.

### Access Key templates

Provide templates, all editable:

- read-only schema + ad-hoc query;
- one saved query only;
- cached dashboard allow-list;
- tenant-filtered dashboard using an enforced `customer.id = ...` filter;
- write-only key with tenant autofill;
- dataset viewer with retrieve-only operations.

## 6.9 Event writer and instrumentation tools

### Single event

```http
POST /3.0/projects/{projectId}/events/{collection}
Authorization: <write-capable-key>
Content-Type: application/json

{
  "customer": { "id": "abc" },
  "amount": 42.5,
  "keen": {
    "timestamp": "2026-07-23T12:00:00.000Z"
  }
}
```

### Bulk event

```http
POST /3.0/projects/{projectId}/events
Authorization: <write-capable-key>
Content-Type: application/json

{
  "purchases": [{ "amount": 10 }, { "amount": 20 }],
  "signups": [{ "plan": "pro" }]
}
```

Features:

- collection selector/manual name;
- structured JSON editor and form-assisted mode;
- single/bulk tabs;
- import newline-delimited JSON/JSON array/CSV with mapping preview;
- `keen.timestamp` helper;
- documented enrichment/add-on JSON helper without forcing add-ons;
- byte counters;
- client-side checks for approximately 900,000 bytes per event and 10,000,000 bytes per bulk HTTP payload;
- recommend splitting large bulk submissions; keep default batches at or below 5,000 events;
- show every item status for bulk responses even when HTTP status is 200;
- no automatic retry of ambiguous write failures;
- optional user-approved retry of only explicitly failed items when the response identifies them;
- explain that a successful event response does not provide a new database event ID;
- explain that newly recorded events may take up to roughly ten seconds to appear in query results;
- generated snippets use environment variables, not literal secrets.

### Instrumentation snippet generator

Generate examples for:

- cURL/fetch single event;
- cURL/fetch bulk event;
- `keen-tracking.js` initialization;
- automatic pageview/click/form/element-view tracking, clearly marked optional;
- common event enrichment structure;
- custom host;
- opt-out and Do Not Track behavior;
- Kafka producer properties.

Do not dynamically load third-party tracking code into the admin frontend itself. The generator produces code for the user's application.

## 6.10 Extractions

### Synchronous extraction

Provide a dedicated wizard and allow switching from Explorer:

- collection;
- timeframe/timezone;
- filters;
- `latest`;
- property selection;
- output type;
- gzip where supported;
- include metadata;
- preview estimated breadth from schema and require confirmation above a configurable property threshold.

Relevant documented limits:

- synchronous extraction can scan up to 1,000,000 events;
- it can return up to 100,000 extracted events;
- response-size and query-time limits still apply.

For inline CSV/JSON-like responses, use a streaming download when browser APIs permit. Do not hold a very large file in multiple memory copies.

### Asynchronous/email extraction

When an `email` value is supplied, Keen processes the extraction asynchronously and emails a link. Expose this as a separate choice and disclose:

- the email address is sent to Keen;
- the link is documented as valid for 30 days;
- a file can include up to 10,000,000 events and 2 GB;
- supported formats include CSV, line-oriented JSON/JSON stream, and gzip variants.

Do not claim the app can poll a job endpoint unless a documented job identifier/endpoint is actually returned and verified.

## 6.11 Maintenance and danger zone

All maintenance calls require a Master Key. Updates may also require Keen to enable the feature for the project.

### Mandatory safety sequence

1. User defines collection, timeframe, timezone, and filters.
2. App runs a count preview.
3. App runs a small extraction sample with the exact same scope.
4. App displays:
   - normalized scope;
   - raw request;
   - affected count;
   - sample;
   - rate/size constraints;
   - irreversible warning.
5. User types collection name and a generated confirmation phrase.
6. App rebuilds the final request from the locked preview model and verifies a canonical hash matches.
7. App submits once. No automatic retry.
8. App records a local redacted audit entry; event data is excluded unless the user exports it.

### Delete matching events — exceptional risk

```http
DELETE /3.0/projects/{projectId}/events/{collection}
  ?filters=<URL-ENCODED-JSON>
  &timeframe=<URL-ENCODED-JSON-OR-STRING>
  &timezone=<URL-ENCODED-VALUE>
Authorization: <master-key>
```

The API ignores a DELETE body. Incorrectly putting filters in the body, omitting them, or encoding them incorrectly can result in deleting the entire collection. Therefore:

- the generic maintenance form must reject an empty filter/timeframe scope;
- whole-collection deletion must be a separate workflow using the dedicated collection-delete action;
- serialize filters with one tested function;
- display the decoded and encoded query strings;
- unit-test Unicode, spaces, nested OR filters, arrays, dates, and reserved characters;
- never let a generic HTTP library move DELETE parameters into a body;
- never retry automatically.

Documented event-delete limits are up to 100,000 matching events when filtered and up to 1,000,000 without filters.

### Delete property

```http
DELETE /3.0/projects/{projectId}/events/{collection}/properties/{property}
Authorization: <master-key>
```

Require the exact collection and flattened property path. Preview recent values before deletion when query access is present.

### Delete collection

```http
DELETE /3.0/projects/{projectId}/events/{collection}
Authorization: <master-key>
```

Keep this separate from filtered event deletion in UI and code, even though the HTTP path overlaps. Confirm whole-collection intent explicitly. The documented collection delete limit applies to collections under 1,000,000 events and a separate 100/minute category.

### Update events

```http
PUT /3.0/projects/{projectId}/events/{collection}
Authorization: <master-key>
Content-Type: application/json

{
  "property_updates": [
    {
      "property_name": "description",
      "property_value": "Invalid event",
      "upsert_property": true
    }
  ],
  "timeframe": { "start": "...", "end": "..." },
  "filters": [ ... ]
}
```

Requirements:

- show that updates are not enabled by default;
- distinguish `upsert_property` from update-existing behavior;
- preview exact scope;
- warn that operation is non-atomic;
- expect up to 100,000 events with filters and 1,000,000 without, according to the documented maintenance limits;
- show `updated_events` from a successful response;
- no background retries.

## 6.12 Cached datasets — optional advanced module

Treat datasets as an Early Release API and put them after core Explorer/Saved Query/Dashboard work.

### Create

```http
PUT /3.0/projects/{projectId}/datasets/{datasetName}
Authorization: <master-key>
Content-Type: application/json

{
  "display_name": "Orders by customer",
  "query": {
    "analysis_type": "count",
    "event_collection": "orders",
    "timeframe": "this_30_days",
    "interval": "daily",
    "group_by": "customer.id"
  },
  "index_by": ["customer.id"]
}
```

Core behavior to support:

- create dataset;
- list with `limit` and `after_name` pagination;
- get definition/status;
- retrieve results with index/timeframe parameters;
- delete;
- status display: Created, Bootstrapping, OK, BootstrappingFailed, Warn, plus unknown values;
- up to three index fields;
- no funnel datasets;
- create-only definition behavior: do not present a normal edit action unless the service confirms update support;
- explain hourly refresh and that only the most recent 48 hours are recomputed, so late historical data may not appear;
- support Access Keys restricted to dataset read/list/retrieve operations.

## 6.13 Kafka and external integration helper

This module is configuration generation, not a direct browser client.

Features:

- inbound Kafka producer template;
- outbound Kafka consumer template;
- Java, Node, Python, and generic properties snippets where practical;
- topic = collection name;
- placeholders for Project ID and key;
- security settings `SASL_SSL` and `PLAIN`;
- three broker endpoints;
- warning that outbound Kafka may need to be enabled on the project Streams page and may not be activatable through a project-key API;
- HTTP event endpoint snippets for systems that cannot use Kafka;
- integration-specific webhook URL generator only after warning that URL credentials can leak through logs/history and only where the external system cannot send an Authorization header.

## 6.14 Optional Organization Admin extension

Enable only when the user supplies both Organization ID and Organization Key.

Possible operations from the public API reference:

- get project metadata;
- list/create projects where documented;
- update project name, full user list, and preferences such as S3 bucket name;
- delete/deactivate project.

This extension must have a separate visual boundary and credential vault. A Master Key must never be treated as an Organization Key. Project update forms must warn that the `users` field is replacement-style: all users to retain must be included.

Even with Organization API access, do not assume billing, invoices, personal profile, SSO, or every hosted-account setting is available.

## 6.15 Hosted-only feature disposition

| Hosted portal feature | Key-only replacement |
|---|---|
| Keen sign-in/session | None; local workspace connection |
| Organization/project chooser | Local workspace list |
| Human-readable project name | Local alias; optional org API lookup |
| Invite/remove project members | Unavailable without org/account privilege; optional org update only if explicitly enabled |
| Retrieve default Read/Write/Master keys | User supplies credentials; optional org project response may expose defaults, but never assume Master can retrieve them |
| Billing, usage plan, invoices | Unavailable; show API errors/rate state only |
| Account/profile/password/SSO | Unavailable |
| Hosted onboarding | Local connect wizard, event send test, schema check, first query tutorial |
| Hosted organization usage-limit precheck | Replace with transparent API error handling |
| Support/contact widgets | Link to documentation/status from an About page; no tracking widget by default |

---

## 7. Exact client contracts and implementation patterns

## 7.1 Analytics client interface

```ts
interface KeenAnalyticsClient {
  listCollections(options?: { includeSchema?: boolean; signal?: AbortSignal }): Promise<unknown>;
  getCollection(collection: string, signal?: AbortSignal): Promise<unknown>;
  getProperty(collection: string, property: string, signal?: AbortSignal): Promise<unknown>;

  runQuery<T = unknown>(
    analysisType: string,
    body: Record<string, unknown>,
    options?: { keyRef?: string; signal?: AbortSignal }
  ): Promise<KeenResponse<T>>;

  getSavedQueryResult<T = unknown>(name: string, signal?: AbortSignal): Promise<KeenResponse<T>>;
  listSavedQueryDefinitions(signal?: AbortSignal): Promise<unknown>;
  getSavedQueryDefinition(name: string, signal?: AbortSignal): Promise<unknown>;
  putSavedQuery(name: string, body: Record<string, unknown>): Promise<unknown>;
  deleteSavedQuery(name: string): Promise<void>;

  recordEvent(collection: string, event: Record<string, unknown>): Promise<unknown>;
  recordEvents(batch: Record<string, Array<Record<string, unknown>>>): Promise<unknown>;

  listAccessKeys(params?: Record<string, string | number>): Promise<unknown>;
  createAccessKey(body: Record<string, unknown>): Promise<unknown>;
  getAccessKey(key: string): Promise<unknown>;
  updateAccessKey(key: string, body: Record<string, unknown>): Promise<unknown>;
  revokeAccessKey(key: string): Promise<unknown>;
  unrevokeAccessKey(key: string): Promise<unknown>;
  deleteAccessKey(key: string): Promise<void>;

  deleteEvents(collection: string, query: DeleteEventQuery): Promise<void>;
  deleteProperty(collection: string, property: string): Promise<void>;
  deleteCollection(collection: string): Promise<void>;
  updateEvents(collection: string, body: UpdateEventsBody): Promise<unknown>;

  listDatasets(params?: Record<string, string | number>): Promise<unknown>;
  getDataset(name: string): Promise<unknown>;
  getDatasetResults(name: string, params: Record<string, unknown>): Promise<unknown>;
  createDataset(name: string, body: Record<string, unknown>): Promise<unknown>;
  deleteDataset(name: string): Promise<void>;
}
```

## 7.2 Response and error model

```ts
type KeenResponse<T> = {
  data: T;
  status: number;
  headers: Record<string, string>;
  requestId?: string;
  elapsedMs: number;
  rawText?: string;
};

type KeenApiError = {
  kind: 'network' | 'cors' | 'abort' | 'http' | 'parse' | 'validation';
  status?: number;
  errorCode?: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: unknown;
  redactedRequest: RedactedRequest;
};
```

The documented API may return an error object containing `message` and `error_code`. Preserve unknown fields. Distinguish:

- `400`: invalid request;
- `401`: missing/invalid authentication;
- `403`: authenticated but forbidden or scope-restricted;
- `404`: missing or unavailable resource;
- `429`: rate/concurrency limit;
- `500`: server error;
- `503`: fast failure/service protection;
- `504`: query exceeded maximum execution time.

Do not replace server messages with a generic toast; show a safe summary and expandable redacted details.

## 7.3 Credential routing

```ts
type Operation =
  | 'schema.read'
  | 'query.run'
  | 'saved.result.read'
  | 'saved.definition.read'
  | 'saved.manage'
  | 'dashboard.read'
  | 'dashboard.manage'
  | 'event.write'
  | 'accessKey.manage'
  | 'maintenance'
  | 'dataset.read'
  | 'dataset.manage'
  | 'organization.manage';

interface CredentialRouter {
  candidates(operation: Operation): CredentialRef[];
  select(operation: Operation, override?: string): CredentialRef;
  markResult(credentialId: string, operation: Operation, outcome: 'allowed' | 'denied'): void;
}
```

Selection order should favor:

- a specifically scoped Access Key for viewers;
- Read Key for ordinary analyses;
- Write Key for event recording;
- Master only when required or when no less-privileged configured key works;
- Organization Key only inside the org extension.

Do not silently fall back from a denied restricted key to Master when that would reveal broader data than the user intended. Ask the user to choose the broader credential for that operation.

## 7.4 URL and encoding rules

- Encode Project ID, collection, property, query name, dataset name, dashboard ID, and key path segments with a tested segment encoder.
- Do not double-encode already structured values.
- Use `URLSearchParams` only after JSON-stringifying structured query parameters.
- For destructive delete-event queries, have a dedicated serializer and snapshot tests.
- Never append `api_key` to app-generated URLs.
- Strip secrets from browser history and copied examples.
- Normalize base hosts once, removing trailing slashes and recognizing whether `/3.0` is already included.

## 7.5 Local persistence model

Store non-secret metadata separately from secrets:

```ts
type WorkspaceRecord = {
  id: string;
  localName: string;
  projectId: string;
  analyticsBaseUrl: string;
  dashboardBaseUrl?: string;
  organizationId?: string;
  credentialRefs: string[];
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type EncryptedSecretRecord = {
  id: string;
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2' | 'Argon2id';
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
};
```

Use Web Crypto AES-GCM. Derive a key from a passphrase with a modern KDF and meaningful work factor. Never persist the derived key. Lock the vault after inactivity and on user request. Clipboard copies should be explicit and, where browser support permits, offer a timed clear with honest caveats.

---
## 8. Dashboard service compatibility adapter

This section is intentionally isolated because it is reconstructed from Keen's official open-source Dashboard Creator rather than the main Analytics API reference.

### 8.1 Source-observed routes

Default service host observed in Keen's public dashboard viewer:

```text
https://dashboard-service.k-n.io
```

Client base:

```text
{dashboardBaseUrl}/projects/{projectId}
```

Operations observed in the official source:

```http
GET    /dashboards/{dashboardId}
GET    /dashboards/{dashboardId}/metadata
GET    /dashboards/metadata
PUT    /dashboards/{dashboardId}
PUT    /dashboards/{dashboardId}/metadata
DELETE /dashboards/{dashboardId}
```

Read calls send the configured read/access key in `Authorization`. Write/delete calls send the Master Key. The full-dashboard `PUT` sends JSON in the body and serializes metadata into:

```http
X-Keen-Blob-Metadata: <JSON-STRINGIFIED-METADATA>
```

The standalone metadata update sends metadata JSON in the request body.

### 8.2 Source-observed metadata shape

The official Dashboard Creator source defines fields equivalent to:

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

Treat all fields as potentially optional or extended at runtime. Preserve unknown fields. The presence of `publicAccessKey` in compatibility metadata means a public dashboard viewer may receive a bearer credential; therefore that key must be narrowly scoped and must never be a default Read or Master Key.

### 8.3 Adapter contract

```ts
interface DashboardPersistenceAdapter {
  kind: 'keen-service' | 'local' | 'hybrid';
  capabilities(): Promise<{
    list: boolean;
    read: boolean;
    write: boolean;
    metadata: boolean;
    shareCompatibility: boolean;
  }>;

  list(signal?: AbortSignal): Promise<DashboardSummary[]>;
  get(id: string, signal?: AbortSignal): Promise<DashboardDocument>;
  getMetadata(id: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  put(document: DashboardDocument, options?: { expectedRevision?: string }): Promise<void>;
  putMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
  export(id: string): Promise<Blob>;
  import(blob: Blob): Promise<DashboardDocument>;
}
```

### 8.4 Required live contract tests

Before enabling Keen-service persistence by default, verify with a disposable project supplied through environment variables:

1. Browser CORS preflight and actual requests from the deployment origin.
2. Whether a default Read Key, restricted Access Key, and Master Key are accepted for each read route.
3. Whether a newly generated UUID v4 is accepted as a dashboard ID.
4. Full dashboard PUT response status/body and whether the custom metadata header is still required.
5. Exact metadata fields and timestamp units.
6. List behavior for zero, one, and multiple dashboards.
7. Read/write behavior for public versus private dashboard metadata.
8. Error semantics for missing dashboard, denied key, malformed body, and stale write.
9. Maximum dashboard document/header size.
10. Whether service responses expose `publicAccessKey` to broad Read Keys.
11. Delete semantics and whether metadata is removed atomically.
12. Custom dashboard host behavior.

If any assumption fails, keep local mode working and update only the adapter.

### 8.5 Conflict and autosave strategy

The source-observed API does not establish a documented optimistic-concurrency mechanism. Therefore:

- generate a local monotonically increasing edit revision;
- debounce changes, for example 800–1,500 ms;
- serialize remote writes per dashboard;
- ignore success responses from superseded local revisions;
- persist a local recovery snapshot before each remote write;
- compare fetched content hashes on focus/reconnect;
- when remote and local content diverge, offer keep local, use remote, or duplicate/merge; never silently overwrite;
- show that conflict protection is client-side unless a verified ETag/revision header becomes available.

---

## 9. Recommended application architecture

## 9.1 Technology baseline

A practical reference stack:

- React + TypeScript;
- Vite static build and optional PWA shell;
- TanStack Query for server state, cancellation, retries, and cache boundaries;
- Zustand or Redux Toolkit for editor/session state;
- React Hook Form plus Zod for form/runtime validation;
- IndexedDB through a small repository layer;
- Web Crypto for credential encryption;
- a grid library with keyboard-accessible fallbacks, or a custom CSS-grid editor;
- a chart adapter wrapping Keen's open-source visualization packages or another maintained renderer;
- Vitest and Mock Service Worker for unit/integration tests;
- Playwright for end-to-end and accessibility flows.

Keen's official frontend monorepo exposes reusable packages such as charts, dataviz, widgets, UI components, forms, parser, colors, icons, hooks, and toasts, and the official Query Creator is a point-and-click query component. They are useful reference implementations. Do not couple the entire product directly to their internal models: place them behind visualization/query-editor adapters so package age or compatibility changes do not block the app.

## 9.2 Suggested repository layout

```text
/apps/web
  /src/app
  /src/routes
  /src/features/connect
  /src/features/streams
  /src/features/explorer
  /src/features/saved-queries
  /src/features/dashboards
  /src/features/access-keys
  /src/features/event-writer
  /src/features/extractions
  /src/features/maintenance
  /src/features/datasets
  /src/features/settings

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

/apps/optional-relay
```

### Dependency direction

- UI features depend on domain interfaces, not raw `fetch`.
- Analytics, dashboard, and organization clients are separate packages.
- Credential vault never imports feature code.
- Query/result models do not import a chart library.
- Visualization adapter receives normalized semantic data plus raw response.
- Dashboard document is independent of remote persistence.
- Optional relay is deployable separately and is not required for local development with mocks.

## 9.3 Routes

```text
/                         landing or current workspace
/connect                  add/test workspace
/workspaces               local workspace manager
/w/:workspaceId           overview
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

Never place a workspace credential in pathname or search parameters.

## 9.4 State ownership

| State | Owner | Persistence |
|---|---|---|
| Credentials | credential vault | memory/session/encrypted IndexedDB, user-selected |
| Workspace metadata | workspace repository | IndexedDB; no secrets |
| API resources | TanStack Query | memory; persistence disabled for sensitive/raw data by default |
| Query draft | Explorer store | local draft repository, configurable |
| Raw extraction/events | component/stream | not persisted unless user downloads |
| Dashboard edit document | dashboard store | local recovery + selected remote adapter |
| Capability states | workspace store | local observation with timestamp; never treated as permanent truth |
| UI preferences | preferences repository | local storage/IndexedDB, no keys |
| Request inspector | bounded memory log | redacted; optional encrypted export |

## 9.5 Service worker/PWA rules

The service worker may cache only:

- application shell;
- versioned static JS/CSS/fonts bundled with the app;
- non-sensitive documentation assets.

It must not cache:

- API requests or responses;
- dashboard documents containing a public key;
- event bodies;
- extraction data;
- authorization headers;
- user-entered image URLs by default.

On app update, preserve encrypted vault records and migrate local document schemas explicitly.

## 9.6 Visualization adapter

```ts
interface VisualizationAdapter {
  inspect(raw: unknown, query: QueryDraft): SemanticResult;
  supportedCharts(result: SemanticResult): ChartSupport[];
  render(input: {
    result: SemanticResult;
    raw: unknown;
    chart: VisualizationDraft;
    accessibility: { tableFallback: boolean; summary: string };
  }): React.ReactNode;
  exportSvg?(): Promise<Blob>;
  exportPng?(): Promise<Blob>;
}
```

Whether using Keen packages or a different chart engine:

- preserve Keen-compatible chart names/settings when importing dashboards;
- translate through a versioned mapping layer;
- never require a chart to understand authorization or fetch data;
- test large group/interval result sets;
- virtualize tables;
- include textual summaries and downloadable data.

## 9.7 Request scheduling

Implement a workspace-level scheduler because rate limits are project-level, not per browser tab or key.

Recommended controls:

- maximum concurrent ad-hoc queries configurable, conservative default 3–5;
- extraction queue separate from normal analyses;
- de-duplicate identical requests;
- cancel stale dashboard queries when a filter/date range changes;
- batch dashboard refreshes rather than firing every chart simultaneously;
- pause and surface state after `429`;
- allow user to resume;
- favor cached saved-query/dataset lookups over equivalent ad-hoc requests when configured;
- coordinate tabs with `BroadcastChannel` where available without broadcasting secrets or raw results.

---

## 10. Security and privacy requirements

## 10.1 Threat model

Protect against:

- accidental key disclosure through URLs, logs, analytics, browser persistence, screenshots, support exports, or copied cURL;
- XSS stealing Master/Read/Access keys;
- malicious imported dashboard/query JSON;
- remote image tracking or hostile URLs;
- cross-workspace credential confusion;
- broad public Access Keys exposing tenant data;
- destructive-request encoding bugs;
- service-worker caching of sensitive responses;
- third-party package compromise;
- optional relay SSRF or credential logging;
- a public dashboard key being mistaken for user authentication.

## 10.2 Browser hardening

Deploy with a restrictive policy, adapted to the chosen chart/image model:

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' https: data:;
  connect-src 'self' https://api.keen.io https://dashboard-service.k-n.io;
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'self';
  form-action 'self';
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Prefer nonce/hash-based styles over `unsafe-inline` when the component stack allows. A public embed deployment may need an explicit configurable `frame-ancestors` policy.

## 10.3 Secret handling

- Default to memory-only credentials.
- Require an explicit storage choice.
- Encrypt at rest; never save plaintext secrets in `localStorage`.
- Keep decrypted material in memory only while the vault is unlocked.
- Mask keys in UI, logs, errors, DOM attributes, test snapshots, and copied requests.
- Do not send telemetry by default. Any opt-in telemetry must exclude Project ID, collection/property names, query bodies, dashboard content, and hostnames unless separately consented.
- Never use a third-party error collector without a redaction test suite.
- Treat Project ID and event schema as potentially sensitive even though keys provide authorization.
- Add a **Lock workspace** action that clears decrypted keys, query cache, raw response views, and clipboard UI state.

## 10.4 Imported content

- Validate JSON size before parsing.
- Parse in a worker for large files.
- Apply Zod/schema validation but preserve unknown fields.
- Sanitize rich text.
- Validate image/link schemes.
- Do not execute code from imported files.
- Never auto-connect to a host embedded in an imported workspace; show the host and require approval.
- Strip imported credentials by default; encrypted credential import is a separate flow.

## 10.5 Public-dashboard security

- One Access Key per public dashboard or tenant/security boundary.
- Scope to allowed saved/cached queries whenever possible.
- Add enforced tenant filters for ad-hoc query access.
- Do not grant `writes`, `schema`, or `query_definition` unless a widget actually requires them.
- A dashboard that only retrieves cached results should not receive unrestricted `queries`.
- Display a permission diff before publishing.
- Regeneration must revoke old credentials.
- Public viewer must not have access to workspace local storage or editor routes.
- Public mode must not expose the Master Key even temporarily.

## 10.6 Destructive safety invariants

These are release blockers:

1. No maintenance action runs on mount, reconnect, retry, or capability test.
2. Event deletion never sends filters/timeframe in a body.
3. Generic delete UI cannot express “no scope.”
4. Whole-collection deletion has a distinct code path and confirmation.
5. Mutation retry count defaults to zero.
6. Preview and final request derive from the same immutable scope object.
7. UI shows the exact target workspace and Project ID at confirmation.
8. Master and Organization operations require a freshly unlocked vault.
9. Cross-workspace navigation cancels outstanding requests and clears secret-bound form state.

---

## 11. Limits, cost awareness, and resilience

Use server responses as the final authority, but design around documented limits:

| Area | Documented constraint to surface |
|---|---|
| Ad-hoc queries | 200/minute per project |
| Extractions | 200/minute per project |
| Updates | 10/minute |
| Deletes | 10/minute |
| Collection deletes | 100/minute |
| Event recording | No rate limit stated in the table, but payload/service constraints still apply |
| Event body | 900,000 bytes per event |
| Bulk HTTP body | 10,000,000 bytes |
| Unique properties | 1,000 per collection |
| Collections returned by schema list | Up to 5,000 |
| Query response | Error above approximately 150 MB |
| Query duration | Maximum about five minutes; `504` on timeout |
| Intervals | Maximum 9,000 |
| Group combinations | Maximum 1,000,000 groups |
| Funnel actors | Maximum 1,000,000 |
| Synchronous extraction | Scan 1,000,000, extract 100,000 events |
| Async extraction | Up to 10,000,000 events / 2 GB |
| Delete/update selected events | Approximately 100,000 with filters, 1,000,000 without |
| Approximate analyses | Count unique, median, and percentile become approximate after high scan volumes documented around 1,000,000 events |

### UX responses

- Show estimated request breadth before large extractions.
- Warn when interval/group selections can multiply output size.
- Display metadata such as events/properties scanned when `include_metadata` is on.
- Recognize implicit short-lived identical-query caching; a zero scan count does not mean no result was returned.
- On `429`, identify rate versus concurrency only when the response makes it clear.
- On `503`, retain the draft and offer manual retry.
- On `504`, recommend a smaller timeframe, filters, fewer groups, cached query, or dataset; do not imply the query kept running.
- Treat a response parsing failure as distinct from an API query failure and preserve a bounded raw-text sample.

### Cost-aware defaults

- No query on every form change.
- Saved-query preview auto-run is a user preference.
- Filter suggestions are user-triggered and cached locally for a short time.
- Dashboard refresh intervals are off by default; manual and visibility-aware refresh.
- Pause dashboard polling when the tab is hidden.
- Prefer saved/cached results for public dashboards.
- Show query count and recent rate state locally, but do not claim it equals Keen billing usage.

---

## 12. Accessibility and internationalization

Target WCAG 2.2 AA.

Requirements:

- every chart has a title, summary, and table/JSON alternative;
- keyboard-operable query builder, dashboard editor, menus, dialogs, and drag/resize alternatives;
- visible focus and logical focus order;
- status messages through appropriate live regions without excessive announcements;
- errors tied to fields with actionable text;
- no color-only status or series distinction;
- accessible contrast in all bundled themes;
- reduced-motion support;
- large hit targets;
- virtualized tables retain keyboard and screen-reader semantics;
- date inputs provide localized display but send unambiguous ISO values;
- number formatting is locale-aware but copied raw values remain machine-safe;
- timezone selection is explicit;
- translation strings are externalized;
- right-to-left layout is testable;
- remote image widget requires alt-text handling;
- rich text preserves semantic headings and lists.

---

## 13. Testing strategy

## 13.1 Unit tests

Cover:

- API base URL normalization;
- path segment encoding;
- delete query-string serialization;
- key redaction in every logging/export path;
- credential routing and no silent Master fallback;
- query form ↔ raw JSON synchronization;
- timeframe builder and absolute end exclusivity;
- filter validation, nested OR, geo incompatibility;
- chart compatibility inference;
- result normalization for scalar/group/interval/funnel/extraction/multi-analysis;
- saved-query metadata round-trip;
- Access Key policy preservation;
- dashboard document migration;
- dashboard filter/date runtime patching without mutating source queries;
- public-key permission diff;
- encryption/decryption and vault lock;
- no sensitive service-worker caching.

## 13.2 Mock integration tests

Use Mock Service Worker fixtures for:

- `200`, `204`, partial bulk success, empty result;
- `400`, `401`, `403`, `404`, `429`, `500`, `503`, `504`;
- non-JSON error body;
- malformed JSON success;
- delayed/cancelled query;
- oversized/streamed extraction;
- schema with unknown types and 1,000 properties;
- many collections;
- Access Key allowed/blocked behavior;
- update feature disabled;
- dashboard service unavailable/CORS-like network failure;
- autosave race and conflict;
- orphaned public key recovery.

Fixtures must contain synthetic data only.

## 13.3 End-to-end tests

Playwright flows:

1. Add memory-only workspace and pass safe schema test.
2. Read-only Access Key sees allowed stream/query and denied admin states.
3. Build each analysis type and validate request body.
4. Run query, switch compatible charts, export table.
5. Open known saved query with Read/Access Key.
6. Master creates, clones, updates, caches, and deletes a saved query in mocked mode.
7. Build dashboard with all five widget types.
8. Filter/date widgets rerun only associated charts.
9. Local dashboard export/import round-trip.
10. Dashboard service mode fallback after network failure.
11. Create/revoke/unrevoke/delete Access Key.
12. Single/bulk event write and per-item failure display.
13. Extraction preview/download.
14. Maintenance preview and confirmation; assert no request when scope changes.
15. Keyboard-only dashboard editing.
16. Vault lock clears secret-dependent state.
17. Public viewer never loads editor/vault code paths where bundle splitting permits.

## 13.4 Live contract tests

Run only with explicitly supplied disposable environment configuration:

```text
KEEN_TEST_PROJECT_ID
KEEN_TEST_READ_KEY
KEEN_TEST_WRITE_KEY
KEEN_TEST_MASTER_KEY
KEEN_TEST_ACCESS_KEY
KEEN_TEST_ANALYTICS_HOST
KEEN_TEST_DASHBOARD_HOST
```

Rules:

- skip when variables are absent;
- mark every mutating test;
- use a unique test collection/query/dashboard prefix;
- clean up only resources created by the test run;
- destructive event/property/collection tests disabled by default and run only against a disposable project;
- never print secrets;
- dashboard contract suite separate from Analytics API suite;
- record sanitized response schemas, not live data.

## 13.5 Security tests

- dependency and lockfile audit;
- secret scanning;
- CSP test;
- DOM XSS tests for rich text, titles, tags, property names, errors, and imported JSON;
- URL scheme tests;
- SSRF tests for optional relay;
- redaction fuzz tests;
- public Access Key over-permission test;
- cross-workspace cache isolation;
- browser history and referrer check for public key fragment;
- service worker cache inspection;
- destructive-operation invariant tests.

---

## 14. Delivery plan

### Phase 0 — compatibility spike

Deliver:

- minimal Analytics API client;
- schema and count query from a browser;
- CORS/error characterization;
- dashboard service route/header contract tests;
- local dashboard persistence proof;
- security threat model;
- decision record on Keen visualization packages versus alternative renderer.

Exit criteria: no unresolved architectural dependency on an undocumented endpoint; dashboard service is either verified behind an adapter or explicitly local-only.

### Phase 1 — read-only core

Deliver:

- connect/workspaces/vault;
- streams and schema browser;
- recent bounded extraction;
- complete Explorer analysis builder;
- result tables and core metric/bar/line/funnel charts;
- raw request/response inspector;
- CSV/JSON export;
- permission/capability states;
- rate/error handling.

Exit criteria: a Read Key or query/schema Access Key can perform useful work without any Keen account membership.

### Phase 2 — saved queries and extraction

Deliver:

- saved-query known-name result flow for read-only users;
- Master list/create/update/clone/delete;
- caching controls with server-driven validation;
- tags/search/sort/auto-run preference;
- extraction wizard, synchronous download, asynchronous email mode;
- remaining chart types through adapter.

### Phase 3 — dashboards

Deliver:

- local dashboard list/editor/viewer;
- chart/text/image/filter/date widgets;
- autosave/recovery/import/export;
- themes/layout/accessibility;
- verified Keen dashboard service adapter if compatible;
- saved-query linkage/detach;
- public viewer shell without publishing yet.

### Phase 4 — key management and sharing

Deliver:

- Access Key CRUD and policy editor;
- permission templates;
- least-privilege public-dashboard key generation;
- public/private/regenerate/embed flows;
- orphan-key recovery;
- public viewer security tests.

### Phase 5 — write and maintenance

Deliver:

- event composer/bulk import/snippet generator;
- Kafka helper;
- maintenance previews and irreversible operations;
- updates with feature-disabled handling;
- high-risk security review.

### Phase 6 — advanced and optional

Deliver:

- cached datasets;
- Organization Admin extension;
- optional relay deployment;
- PWA polish;
- localization and RTL validation;
- plugin points for alternate visualization engines and dashboard stores.

---

## 15. Definition of done and acceptance criteria

### 15.1 Key-only promise

- The app never requires a Keen human account/session for project-level features.
- A user can connect with Project ID + Read/Access Key and inspect permitted streams/run permitted queries.
- A user with only a known saved-query-capable key can open a saved result without needing the full definitions list.
- Permission-denied features are explained, not hidden behind infinite spinners or generic errors.
- The app never suggests that project membership has been granted.

### 15.2 API correctness

- All Analytics requests use v3 routes and Authorization headers.
- Each feature is routed to the correct Analytics, Dashboard, Organization, or local layer.
- Query builder covers all documented analyses and common parameters.
- Unknown API fields survive load/edit/save round trips.
- Bulk HTTP 200 partial failures are visible per event.
- Saved/cached permission differences are respected.
- Dashboard service assumptions are isolated and tested.

### 15.3 Security

- No plaintext persisted keys by default or in localStorage.
- No secrets in URLs generated by the authenticated editor; public restricted keys use a deliberate sharing design.
- No secrets in logs, telemetry, error reports, or copied cURL.
- Public dashboards use dedicated restricted Access Keys.
- No mutation is auto-probed or auto-retried.
- Delete-event query parameters are tested and cannot be moved into a body.
- Imported/rendered content is sanitized.
- Service worker excludes API data.

### 15.4 User experience

- Every module clearly labels required capability/key.
- Empty, loading, denied, rate-limited, timed-out, and offline states are distinct.
- Every chart has a table/JSON alternative.
- Dashboard is keyboard operable.
- Large schemas/results remain responsive.
- Local dashboard mode works independently of Keen's dashboard service.
- Recovery exists for failed autosave and public-key lifecycle transitions.

### 15.5 Engineering quality

- TypeScript strict mode passes.
- Unit, integration, E2E, accessibility, and security tests pass.
- API clients have no UI imports.
- No credentials or live project data exist in fixtures or repository history.
- Deployment documentation covers static hosting, CSP, optional relay, custom hosts, vault modes, and public sharing risk.
- License and notices are compatible with any reused Keen open-source packages.

---

## 16. Open questions that must be resolved by contract tests, not guesses

1. Is `dashboard-service.k-n.io` still the supported production dashboard host for all projects in 2026?
2. Does it allow browser CORS from arbitrary self-hosted origins?
3. Which project key types can list private dashboard metadata?
4. Is `X-Keen-Blob-Metadata` still required and what size limits apply?
5. Are there revision/ETag headers that can improve conflict handling?
6. Does a dashboard read response expose public Access Keys to broad project readers?
7. Are dashboard IDs unrestricted strings or UUIDs?
8. Does a restricted Access Key need `schema` to render every imported Dashboard Creator widget, or only filters/editor property choices?
9. Which exact Access Key dataset option keys are accepted by the current server? Preserve raw JSON until verified.
10. What cached-query `refresh_rate` upper bound does the current server enforce given conflicting public documentation?
11. Do custom Analytics domains also proxy dashboard storage, or must Dashboard API host remain separate?
12. Which response headers expose request IDs and rate information through CORS?
13. Does asynchronous extraction return any machine-readable job metadata beyond the email-processing response?
14. What current CORS behavior applies to very large extraction downloads?
15. Is update-events enabled for a given project distinguishable from a normal `403/404` before attempting an update? Do not probe by mutation.

Record answers in versioned Architecture Decision Records with date, test environment, sanitized request/response shape, and fallback behavior.

---

## 17. Official source index

Use these as primary references during implementation. Re-check them when the API or packages change.

### Public documentation

1. Analytics API Reference  
   https://keen.io/docs/api/
2. Data Explorer Guide  
   https://keen.io/docs/compute/data-explorer-guide/
3. Saved Queries  
   https://keen.io/docs/compute/saved-query/
4. Access Keys  
   https://keen.io/docs/access/access-keys/
5. Projects  
   https://keen.io/docs/access/projects/
6. Dashboard Edition  
   https://keen.io/docs/visualize/dashboard-creator/dashboard-edition/
7. Dashboard Management  
   https://keen.io/docs/visualize/dashboard-creator/dashboard-management/
8. Data Visualization Library  
   https://keen.io/docs/visualize/data-visualization-library/
9. Visualization Widgets  
   https://keen.io/docs/visualize/data-visualization-library/widgets/
10. Customer-Facing Analytics  
    https://keen.io/docs/visualize/use-cases/customer-facing-analytics/

### Official Keen open-source repositories/source files

11. Keen frontend monorepo  
    https://github.com/keen/keen
12. Query Creator  
    https://github.com/keen/query-creator
13. Dashboard Creator  
    https://github.com/keen/dashboard-creator
14. Dashboard API client source  
    https://github.com/keen/dashboard-creator/blob/develop/src/api/DashboardAPI.ts
15. Dashboard API header type  
    https://raw.githubusercontent.com/keen/dashboard-creator/refs/heads/develop/src/api/types.ts
16. Public Dashboard source  
    https://github.com/keen/dashboard-creator/blob/develop/src/PublicDashboard.tsx
17. Dashboard model/types  
    https://github.com/keen/dashboard-creator/blob/develop/src/modules/dashboards/types.ts
18. Keen Tracking JavaScript  
    https://github.com/keen/keen-tracking.js/

### Research caution

The public documentation and repositories are official, but not every page or package is necessarily updated in lockstep with Keen's production portal. The implementation must favor the Analytics API reference for documented data-plane contracts, preserve forward-compatible fields, and isolate source-observed dashboard behavior.

---

# Appendix A — Endpoint catalog

The placeholders below assume:

```text
A = https://api.keen.io/3.0/projects/{PROJECT_ID}
D = https://dashboard-service.k-n.io/projects/{PROJECT_ID}
```

| Method | Route | Purpose | Typical credential |
|---|---|---|---|
| POST | `A/events/{collection}` | Record one event | Write/Master/write Access |
| POST | `A/events` | Record bulk events | Write/Master/write Access |
| GET | `A/events?include_schema=...` | List collections/schema | Read/Master/schema Access |
| GET | `A/events/{collection}` | Collection schema | Read/Master/schema Access |
| GET | `A/events/{collection}/properties/{property}` | Property type | Read/Master/schema Access |
| POST | `A/queries/{analysis_type}` | Run ad-hoc analysis | Read/Master/query Access |
| GET/HEAD | `A/queries/{analysis_type}` | Alternate query form/availability where documented | Read/Master/query Access |
| POST | `A/queries/extraction` | Extraction | Read/Master/query Access |
| PUT | `A/queries/saved/{name}` | Create/update saved query/cache | Master |
| GET | `A/queries/saved` | List saved definitions | Master |
| GET | `A/queries/saved/{name}` | Get definition | Master/query-definition Access |
| GET | `A/queries/saved/{name}/result` | Retrieve result | Read/Master/saved-or-cached Access |
| DELETE | `A/queries/saved/{name}` | Delete saved query | Master |
| POST | `A/keys` | Create Access Key | Master |
| GET | `A/keys` | List Access Keys | Master |
| GET | `A/keys/{key}` | Get Access Key | Master |
| POST | `A/keys/{key}` | Update Access Key | Master |
| POST | `A/keys/{key}/revoke` | Revoke | Master |
| POST | `A/keys/{key}/unrevoke` | Unrevoke | Master |
| DELETE | `A/keys/{key}` | Delete | Master |
| DELETE | `A/events/{collection}?filters=...` | Delete matching events | Master |
| DELETE | `A/events/{collection}/properties/{property}` | Delete property | Master |
| DELETE | `A/events/{collection}` | Delete collection | Master |
| PUT | `A/events/{collection}` | Update matching events | Master + enabled feature |
| PUT | `A/datasets/{name}` | Create cached dataset | Master |
| GET | `A/datasets` | List datasets | Read/Master/dataset Access |
| GET | `A/datasets/{name}` | Get dataset definition/status | Read/Master/dataset Access |
| GET | `A/datasets/{name}/results` | Get dataset results | Read/Master/dataset Access |
| DELETE | `A/datasets/{name}` | Delete dataset | Master |
| GET | `D/dashboards/metadata` | List dashboard metadata | Read/access, source-observed |
| GET | `D/dashboards/{id}` | Get dashboard document | Read/access, source-observed |
| GET | `D/dashboards/{id}/metadata` | Get dashboard metadata | Read/access, source-observed |
| PUT | `D/dashboards/{id}` | Save dashboard + metadata header | Master, source-observed |
| PUT | `D/dashboards/{id}/metadata` | Save metadata | Master, source-observed |
| DELETE | `D/dashboards/{id}` | Delete dashboard | Master, source-observed |

# Appendix B — Product copy rules

Use precise permission language:

- “This operation requires a Master Key” rather than “You are not an admin.”
- “The supplied key was denied for schema access” rather than “This project has no streams.”
- “Project name is a local alias” rather than presenting it as server metadata.
- “Saved-query definitions are not listable with this credential; enter a known query name” rather than showing an empty authoritative list.
- “Dashboard service compatibility is unavailable; local dashboards still work” rather than “No dashboards exist.”
- “Keen rejected this update; updates may not be enabled for the project” rather than retrying.
- “This public link contains a restricted bearer key” rather than describing it as anonymous access.
- “Local query count is not billing usage” wherever rate/cost indicators appear.

# Appendix C — Minimum release checklist

- [ ] Connect with Project ID + one key; no account login.
- [ ] Memory-only default and encrypted vault option.
- [ ] Authorization header everywhere.
- [ ] Streams/schema/recent events.
- [ ] All documented analysis types.
- [ ] Filters, OR, timeframes, timezone, group/order/limit/interval/zero-fill.
- [ ] Raw request/response and safe cURL.
- [ ] Results/table/export and accessible chart core.
- [ ] Permission-aware saved-query workflows.
- [ ] Local dashboards with all five widget types.
- [ ] Dashboard service isolated and contract-tested.
- [ ] Access Key CRUD and least-privilege templates.
- [ ] Public sharing never uses default Read/Master keys.
- [ ] Single/bulk event writer with partial-success handling.
- [ ] Extraction wizard.
- [ ] Maintenance preview lock and no mutation retries.
- [ ] Dataset module marked Early Release/optional.
- [ ] Hosted-only account functions clearly excluded.
- [ ] No keys in URLs/logs/storage/telemetry.
- [ ] Accessibility and security suites pass.

