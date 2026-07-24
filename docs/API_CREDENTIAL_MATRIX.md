# API and Credential Matrix

Default Analytics base: `https://api.keen.io/3.0`

Default source-observed dashboard base: `https://dashboard-service.k-n.io`

All normal client credentials are sent in `Authorization`. Secrets are never appended to app-generated query strings.

| Feature | Method and path | Credential | Confidence |
|---|---|---|---|
| List streams/schema | `GET /projects/{id}/events?include_schema=...` | Read, Master, schema Access | documented API |
| Collection schema | `GET /projects/{id}/events/{collection}` | Read, Master, schema Access | documented API |
| Property schema | `GET /projects/{id}/events/{collection}/properties/{property}` | Read, Master, schema Access | documented API |
| Analysis | `POST /projects/{id}/queries/{analysis}` | Read, Master, query Access | documented API |
| Saved definition list | `GET /projects/{id}/queries/saved` | Master | documented API |
| Saved definition | `GET /projects/{id}/queries/saved/{name}` | Master or query-definition Access | documented API |
| Saved result | `GET /projects/{id}/queries/saved/{name}/result` | Read, Master, allowed saved/cached Access | documented API |
| Saved create/update | `PUT /projects/{id}/queries/saved/{name}` | Master | documented API |
| Saved delete | `DELETE /projects/{id}/queries/saved/{name}` | Master | documented API |
| Single event | `POST /projects/{id}/events/{collection}` | Write, Master, write Access | documented API |
| Bulk events | `POST /projects/{id}/events` | Write, Master, write Access | documented API |
| List/create keys | `GET/POST /projects/{id}/keys` | Master | documented API |
| Get/update/delete key | `GET/POST/DELETE /projects/{id}/keys/{key}` | Master | documented API |
| Revoke/unrevoke key | `POST /projects/{id}/keys/{key}/revoke|unrevoke` | Master | documented API |
| Filtered delete | `DELETE /projects/{id}/events/{collection}?filters=...&timeframe=...` | Master | documented API |
| Delete property | `DELETE /projects/{id}/events/{collection}/properties/{property}` | Master | documented API |
| Delete collection | `DELETE /projects/{id}/events/{collection}` | Master | documented API |
| Update events | `PUT /projects/{id}/events/{collection}` | Master + project enablement | documented API |
| Dataset create | `PUT /projects/{id}/datasets/{name}` | Master | documented API / Early Release |
| Dataset reads | `GET /projects/{id}/datasets...` | Read, Master, dataset Access | documented API / Early Release |
| Dataset delete | `DELETE /projects/{id}/datasets/{name}` | Master | documented API / Early Release |
| Dashboard list | `GET /projects/{id}/dashboards/metadata` | read/access (verify) | source-observed |
| Dashboard get | `GET /projects/{id}/dashboards/{dashboardId}` | read/access (verify) | source-observed |
| Dashboard save | `PUT /projects/{id}/dashboards/{dashboardId}` | Master | source-observed |
| Dashboard metadata | `GET/PUT /projects/{id}/dashboards/{dashboardId}/metadata` | read/access or Master | source-observed |
| Dashboard delete | `DELETE /projects/{id}/dashboards/{dashboardId}` | Master | source-observed |
| Local dashboards | IndexedDB + import/export | none | local |
| Organization projects | `/organizations/{orgId}/projects/...` | Organization Key | optional organization |
| Login, billing, account team | none | account/session | hosted-only |

## Error language

- `401`: the credential is missing or rejected.
- `403`: the selected credential was denied for this operation.
- `404`: resource missing or not visible; do not infer permission without evidence.
- `429`: project-level rate/concurrency pressure; scheduler pauses.
- `503`: service protection/unavailable; safe reads may retry within the fixed bound.
- `504`: query timed out; reduce breadth or use a cached query/dataset.

No local request count is labeled as billing usage.
