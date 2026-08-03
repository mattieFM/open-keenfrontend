# Feature Status

Status labels:

- **implemented** — source and UI flow are present;
- **adapter** — isolated source-observed contract requiring live verification;
- **local** — intentionally has no Keen backend dependency;
- **scaffolded** — route and contract exist, with server-specific refinement still expected;
- **out of scope** — not available through project keys.

| Area | Status | Notes |
|---|---|---|
| Electron main/preload hardening | implemented | sandbox, context isolation, host validation, cancellation, native file dialogs |
| Build and release automation | implemented | every source branch push and non-reserved user-tag push verifies and packages four native targets, then publishes a checksummed Release; generated `build-*` tags are excluded from retriggering; pull requests remain build-only |
| Workspaces | implemented | local alias, Project ID, hosts, labeled key metadata, demo mode |
| Credential storage | implemented | memory and encrypted IndexedDB; session is process memory |
| Capability model | implemented | unknown/allowed/denied observations; no mutating probes |
| Streams/schema | implemented | collection list, full schema, search, bounded recent extraction |
| Explorer analyses | implemented | 13 analysis modes including advanced multi-analysis |
| Query parameters | implemented | form essentials plus unknown-field preserving raw JSON |
| Filter builder | implemented | visual AND filters, nested OR groups, scalar/list/exists/regex and geographic controls; schema suggestions retain manual fallback |
| Funnel builder | implemented | visual add/duplicate/delete/reorder, actor fields, optional/inverted flags, per-step timeframes, and nested filters |
| Result normalization | implemented | scalar/group/interval/records/unique/funnel/multi/unknown |
| Charts | implemented | metric, gauge, line, area, bar, pie, donut, funnel, table; adapter names retain heatmap/bubble/choropleth compatibility |
| Exports | implemented | CSV/JSON/query definition; renderer-dependent SVG/PNG can be added |
| Saved query known-name flow | implemented | result and optional definition with local name history |
| Saved query CRUD | implemented | Master list/create/edit/clone/delete and arbitrary metadata |
| Automatic dashboards | implemented | deterministic overview per stream and dashboard per discovered event type; specialized session overview/start/end templates with bounded live Event/Machine/Game filter choices; customized documents are preserved |
| Dashboard local persistence | implemented | create/list/view/edit/clone/delete/import/export/autosave/undo plus protected automatic-template refresh |
| Dashboard widgets | implemented | complete visual chart query editor plus Markdown text, HTTPS image, string filter, and date range; no JSON authoring required |
| Dashboard keyboard alternatives | implemented | explicit move and resize buttons alongside pointer drag/resize controls |
| Keen dashboard service | adapter | source-observed routes and metadata header behind opt-in |
| Public sharing | implemented | dedicated Access Key creation, allow-list/filter policy, fragment viewer, revoke/private flow |
| Access Key manager | implemented | list/search/raw create/edit/templates/revoke/unrevoke/delete |
| Event writer | implemented | single/bulk JSON, file import, byte counters, snippets, partial result display |
| Extraction wizard | implemented | sync result/download and email request disclosure |
| Maintenance | implemented | filtered delete, collection delete, property delete, update; preview hash and no retry |
| Datasets | scaffolded | create/list/get/results/delete API-shaped workflows, Early Release warning |
| Kafka helper | documented | generated configuration belongs in docs; browser TCP Kafka is intentionally absent |
| Organization admin | not enabled | credential type reserved; requires separate documented Organization API client |
| Optional relay | implemented | separately deployable and allow-listed |
| Account login/team/billing | out of scope | no project-key equivalent |
