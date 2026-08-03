# Automatic Dashboards and Visual Dashboard Studio

**Implemented:** July 31, 2026

**Storage:** local IndexedDB first; optional Keen-compatible persistence remains isolated behind the source-observed dashboard adapter

## Purpose

The dashboard system is designed for a developer handoff where the operator has a Keen Project ID and one or more project keys but no Keen account session. A query/schema-capable key can inspect the project and create useful local dashboards without requiring the operator to author query JSON.

Automatic generation is read-only with respect to Keen. It reads collection/schema data and, when a query-capable credential is available, runs bounded `select_unique` analyses to discover values of the configured event-type field. It writes dashboard documents only to this application's local IndexedDB unless the operator separately publishes one through the remote dashboard adapter.

## Connection-time behavior

The connection screen includes **Create dashboards automatically for every stream**. It becomes available only when the safe read-only schema test is enabled and a Read, Master, or appropriately scoped Access Key is selected.

After the safe schema test succeeds, the application:

1. loads the collection list with schema information;
2. loads missing per-collection schema details, with a 200-stream detail cap per sync;
3. recognizes session streams from their field contract;
4. discovers Event, Machine, and Game filter choices for up to 15 recognized session streams through bounded `select_unique` queries;
5. discovers event-type values for up to 100 non-session streams through bounded `select_unique` queries;
6. creates one local overview dashboard per stream;
7. creates one local dashboard per discovered event type, capped at 50 values per stream;
8. stores deterministic IDs so repeated syncs do not create duplicates.

The dashboard page repeats this sync when automatic dashboards are enabled and the previous sync is more than six hours old. **Create missing dashboards** never overwrites an existing automatic dashboard. **Refresh automatic** shows a confirmation and intentionally rebuilds automatic dashboards from the current templates.

## Session stream recognition

A stream receives the specialized session template when its schema contains all of the following paths:

```text
eventType
session.sessionId
session.eventId
session.machineId
session.gameId
```

The event-type field name is configurable in Workspace Settings. Nested schema objects are normalized to dot paths, so a schema containing a nested `session` object is equivalent to a schema that already returns flattened paths.

The template understands these conventional values and optional fields:

```text
eventType = session_start | session_end
session.status = completed | abandoned
session.dwellMs = session duration in milliseconds
session.result = numeric score/level or a categorical result
```

### Session overview dashboard

The generated overview contains, when supported by the schema:

- sessions started;
- sessions ended;
- completed sessions;
- abandoned sessions;
- starts over time;
- sessions by game;
- sessions by machine;
- sessions by event;
- start-to-end funnel using `session.sessionId` as the actor;
- outcomes over time grouped by `session.status`;
- average session duration;
- average duration over time;
- numeric average result by game or categorical result counts.

It also includes a dashboard date control, using the workspace default timezone for relative ranges, and visual event, game, machine, and status controls. Event, Machine, and Game choices are populated automatically from bounded read-only unique-value queries when the selected credential permits queries; the event control falls back to **Builders Lab** for the supplied contract. Filter controls are attached only to compatible ad-hoc charts; the funnel retains its explicit step filters.

### `session_start` dashboard

This dashboard focuses on starts and does not add end-only fields:

- total starts;
- unique sessions;
- starts over time;
- starts by game;
- starts by machine;
- starts by event.

### `session_end` dashboard

This dashboard focuses on completion data:

- total ends;
- unique sessions;
- completed and abandoned metrics;
- ends over time;
- completion outcomes;
- average duration and duration trend;
- result analytics;
- ends by game, machine, and event.

## Generic stream and event-type templates

Every stream receives a generic overview even when it does not match the session contract. The overview includes total event volume, a time series, useful categorical breakdowns, and averages for up to two numeric fields.

When the configured event-type field exists and a query-capable credential is available, each discovered value receives its own dashboard with the event-type filter already applied. A dashboard includes total events, a timeline, a unique-identity metric when a suitable field exists, categorical breakdowns, numeric averages, date range, and compatible string-filter widgets.

If only schema access is available, stream overviews are still created. Event-type-specific dashboards that require value discovery wait until a query-capable credential is available.

## Visual dashboard authoring

Dashboard authors do not need to edit JSON. The chart widget editor exposes:

- analysis type;
- event stream and schema-backed field selection with manual fallback;
- target property and percentile;
- relative or absolute timeframe and timezone;
- visual AND filters and nested OR groups;
- string, number, boolean, list, regex, exists, and geographic controls;
- funnel step add, remove, duplicate, reorder, optional, inverted, per-step timeframe, and per-step filters;
- named multi-analysis rows;
- interval and custom interval;
- group-by fields;
- multiple order clauses;
- result limit, zero fill, and metadata;
- extraction record count and selected properties;
- saved-query linkage;
- compatible chart type and number/duration/percent formatting;
- accessible table fallback.

The remaining widget types are also visual:

- sanitized Markdown text with formatting shortcuts;
- HTTPS image with alt text, fit, caption, and no-referrer behavior;
- string filter with schema loading, manual choices, or fetched unique values;
- relative or absolute date-range control connected to selected charts;
- dashboard appearance presets, colors, spacing, tile radius, and chart palette;
- pointer and keyboard move/resize controls;
- preview, undo, local autosave, clone, import, export, and remote publish controls.

Dashboard import/export files remain JSON internally because dashboard documents need a portable structured format, but ordinary creation and editing do not require users to read or write that format.

## Refresh and customization safety

Automatic documents contain a template version, schema fingerprint, deterministic content fingerprint, collection, event type, and generated timestamp.

- Missing dashboards are created.
- Repeated ordinary syncs are idempotent.
- An untouched automatic dashboard is refreshed automatically when its template, schema, configured timeframe/timezone, discovered filter choices, or other generated content changes.
- The last successful query-backed Event, Machine, and Game choices are retained if a later discovery request is denied, rate-limited, or temporarily offline; successful empty results still replace old values.
- A dashboard whose `updatedAt` differs from its generated timestamp is treated as customized and preserved.
- Customized dashboards with newer available schemas/templates are reported in the sync warnings.
- **Refresh automatic** deliberately rebuilds all automatic dashboards after confirmation.
- Manual dashboards are never changed by automatic sync.
- Cloning an automatic dashboard removes its automatic metadata, making the clone a normal manual dashboard.

## Limits and safeguards

Automatic sync uses conservative bounds to avoid consuming the project query budget unexpectedly:

- up to 200 missing schema-detail requests per sync;
- up to 15 session streams for automatic Event, Machine, and Game option discovery (three bounded queries per stream);
- up to 100 non-session streams for event-type discovery;
- up to 200 unique Event, Machine, or Game choices per session field and up to 100 event-type values per generic stream discovery query;
- up to 50 event-type dashboards per stream;
- schema-detail concurrency capped at four;
- distinct-value and event-type discovery concurrency capped at three;
- no write, update, delete, key-management, dataset, or Organization request;
- no remote dashboard publish unless explicitly requested elsewhere.

These are client safeguards, not Keen billing or usage measurements.

## Current verification boundary

The deterministic template builder, nested-schema normalizer, stable IDs, refresh/preserve decision, required session charts, automatic filter-option injection, absolute-date timezone handling, static dashboard invariants, and TypeScript syntax/import checks are verified locally. Live schema shapes, current `select_unique` behavior, rate responses, and chart responses still require a disposable Keen project and explicitly supplied test credentials.
