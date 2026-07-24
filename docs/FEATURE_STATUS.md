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
| Filter builder | scaffolded | raw nested JSON editor plus validation; visual nested builder can be expanded |
| Funnel builder | scaffolded | complete API-shaped JSON editor and validation; drag-step UX can be expanded |
| Result normalization | implemented | scalar/group/interval/records/unique/funnel/multi/unknown |
| Charts | implemented | metric, gauge, line, area, bar, pie, donut, funnel, table; adapter names retain heatmap/bubble/choropleth compatibility |
| Exports | implemented | CSV/JSON/query definition; renderer-dependent SVG/PNG can be added |
| Saved query known-name flow | implemented | result and optional definition with local name history |
| Saved query CRUD | implemented | Master list/create/edit/clone/delete and arbitrary metadata |
| Dashboard local persistence | implemented | create/list/view/edit/clone/delete/import/export/autosave/undo |
| Dashboard widgets | implemented | chart, Markdown text, HTTPS image, string filter, date range |
| Dashboard keyboard alternatives | scaffolded | button-based edit/clone/delete; explicit move/resize controls remain expansion work |
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
