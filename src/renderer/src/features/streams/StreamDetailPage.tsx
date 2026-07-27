import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowLeft, BarChart3, Braces, Copy, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CredentialSelect, EmptyState, ErrorPanel, PageHeader } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import {
  buildRecentEventsQuery,
  formatEventTimestamp,
  recentEventRows,
  STREAM_EVENT_LIMIT,
  STREAM_REFRESH_INTERVAL_MS
} from './streamEvents';

function propertyMap(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const source = record.properties && typeof record.properties === 'object' ? record.properties as Record<string, unknown> : record;
  return Object.fromEntries(Object.entries(source).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, String(value)]));
}

function updatedAtLabel(updatedAt: number): string {
  if (!updatedAt) return 'Waiting for first refresh';
  return `Updated ${new Date(updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
}

export function StreamDetailPage(): JSX.Element {
  const params = useParams();
  // React Router already decodes path parameters. Decoding again breaks legitimate names containing '%' sequences.
  const collection = params.collection ?? '';
  const { workspace, client } = useWorkspaceContext();
  const schemaCredentials = useOperationCredentials('schema.read');
  const queryCredentials = useOperationCredentials('query.run');
  const [schemaCredentialId, setSchemaCredentialId] = useState(schemaCredentials.candidates[0]?.id ?? '');
  const [queryCredentialId, setQueryCredentialId] = useState(queryCredentials.candidates[0]?.id ?? '');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [propertySearch, setPropertySearch] = useState('');

  useEffect(() => { if (!schemaCredentialId && schemaCredentials.candidates[0]) setSchemaCredentialId(schemaCredentials.candidates[0].id); }, [schemaCredentialId, schemaCredentials.candidates]);
  useEffect(() => { if (!queryCredentialId && queryCredentials.candidates[0]) setQueryCredentialId(queryCredentials.candidates[0].id); }, [queryCredentialId, queryCredentials.candidates]);

  const schema = useQuery({
    queryKey: ['stream', workspace?.id, collection, schemaCredentialId],
    enabled: Boolean(client && schemaCredentialId && collection),
    queryFn: ({ signal }) => client!.getCollection(schemaCredentials.select(schemaCredentialId), collection, signal)
  });
  const allProperties = useMemo(() => Object.entries(propertyMap(schema.data?.data)).sort(([a], [b]) => a.localeCompare(b)), [schema.data]);
  const properties = useMemo(() => allProperties.filter(([name]) => name.toLowerCase().includes(propertySearch.toLowerCase())), [allProperties, propertySearch]);
  const schemaReady = !schemaCredentialId || schema.isSuccess || schema.isError;

  const recent = useQuery({
    queryKey: ['recent-events', workspace?.id, collection, queryCredentialId, STREAM_EVENT_LIMIT, allProperties.map(([name]) => name).slice(0, 30)],
    enabled: schemaReady && Boolean(client && queryCredentialId && collection),
    queryFn: ({ signal }) => client!.runQuery(queryCredentials.select(queryCredentialId), buildRecentEventsQuery(collection, allProperties.map(([name]) => name)), signal),
    refetchInterval: autoRefresh ? STREAM_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false
  });
  const recentRows = useMemo(() => recentEventRows(recent.data?.data), [recent.data]);

  return (
    <>
      <Link to={`/w/${workspace?.id}/streams`} className="inline-icon small muted stream-back-link"><ArrowLeft size={14} /> All streams</Link>
      <PageHeader
        eyebrow="Event stream"
        title={collection}
        description="Inspect the inferred property schema and watch the ten latest events arrive."
        actions={<Link className="button button--primary" to={`/w/${workspace?.id}/query/new?collection=${encodeURIComponent(collection)}`}><BarChart3 size={15} /> Query stream</Link>}
      />

      <div className="stream-detail-layout">
        <Card>
          <div className="card__header">
            <div><h2>Properties</h2><p>Property types are inferred from recorded events and can evolve.</p></div>
            <div className="row"><Badge tone="purple"><Braces size={12} /> {properties.length} properties</Badge><Button variant="ghost" onClick={() => void schema.refetch()} loading={schema.isFetching}><RefreshCw size={14} /> Refresh</Button></div>
          </div>
          <div className="card__body stack">
            <CredentialSelect credentials={schemaCredentials.candidates} value={schemaCredentialId} onChange={setSchemaCredentialId} label="Schema credential" />
            <input className="input" value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder="Search property paths" aria-label="Search property paths" />
            {schema.error ? <ErrorPanel error={schema.error} /> : null}
            {schema.isLoading ? <EmptyState title="Loading properties" description="Requesting the selected collection definition." /> : properties.length === 0 ? <EmptyState title="No properties returned" description="The collection may be empty, unavailable, or represented by an unknown response shape." /> : (
              <div className="table-wrap stream-properties-table"><table><thead><tr><th>Property</th><th>Type</th><th aria-label="Actions" /></tr></thead><tbody>{properties.map(([name, type]) => <tr key={name}><td className="mono">{name}</td><td><Badge tone={type.includes('num') ? 'blue' : type.includes('string') ? 'purple' : 'neutral'}>{type}</Badge></td><td><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(name)}><Copy size={13} /> Copy</Button></td></tr>)}</tbody></table></div>
            )}
            {schema.data ? <details><summary className="small muted">Raw schema response</summary><pre className="json-view">{JSON.stringify(schema.data.data, null, 2)}</pre></details> : null}
          </div>
        </Card>

        <Card className="stream-events-card">
          <div className="card__header stream-events-header">
            <div><h2>Recent events</h2><p>Latest {STREAM_EVENT_LIMIT}, refreshed automatically. Raw events are never persisted.</p></div>
            <Badge tone={recent.error ? 'danger' : autoRefresh ? 'success' : 'neutral'}>
              <Activity className={recent.isFetching ? 'spin' : ''} size={12} />
              {autoRefresh ? 'Live' : 'Paused'}
            </Badge>
          </div>
          <div className="card__body stack">
            <CredentialSelect credentials={queryCredentials.candidates} value={queryCredentialId} onChange={setQueryCredentialId} label="Query credential" />
            <div className="stream-refresh-controls">
              <label className="stream-refresh-toggle">
                <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} disabled={!queryCredentialId} />
                <span><strong>Auto-refresh</strong><small>Every {STREAM_REFRESH_INTERVAL_MS / 1000} seconds</small></span>
              </label>
              <div className="stream-refresh-status" aria-live="polite">
                <span>{updatedAtLabel(recent.dataUpdatedAt)}</span>
                <Button variant="secondary" onClick={() => void recent.refetch()} loading={recent.isFetching} disabled={!queryCredentialId}><RefreshCw size={14} /> Refresh now</Button>
              </div>
            </div>
            <Badge tone="warning">Event values may contain personal or sensitive data</Badge>
            {recent.error ? <ErrorPanel error={recent.error} /> : null}
            {!queryCredentialId ? <EmptyState title="No query-capable credential" description="Add a Read, Master, or query-scoped Access Key to load recent events." /> : recent.isLoading ? <EmptyState icon={<Activity className="spin" size={28} />} title="Loading recent events" description={`Fetching the latest ${STREAM_EVENT_LIMIT} events from this stream.`} /> : recentRows.length === 0 ? <EmptyState title="No recent events returned" description="No events were found in the current fourteen-day extraction window." /> : (
              <div className="stream-event-list">
                <table>
                  <thead><tr><th className="stream-event-number">#</th><th>Event time</th><th>Event values</th></tr></thead>
                  <tbody>
                    {recentRows.map((row, index) => {
                      const timestamp = formatEventTimestamp(row.timestamp);
                      return (
                        <tr key={row.key} data-testid="recent-event-row">
                          <td className="stream-event-number"><span>{index + 1}</span></td>
                          <td className="stream-event-time">{row.timestamp ? <time dateTime={row.timestamp}><strong>{timestamp.time}</strong><small>{timestamp.date}</small></time> : <span className="muted">{timestamp.date}</span>}</td>
                          <td>
                            <details className="stream-event-details">
                              <summary><span className="stream-event-preview">{row.preview}</span><span className="stream-event-view-label">View JSON</span></summary>
                              <pre className="json-view">{JSON.stringify(row.event, null, 2)}</pre>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
