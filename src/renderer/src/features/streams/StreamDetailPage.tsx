import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Braces, Copy, Eye, RefreshCw } from 'lucide-react';
import type { QueryDraft } from '@shared/types';
import { Badge, Button, Card, CredentialSelect, EmptyState, ErrorPanel, PageHeader } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';

function propertyMap(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const source = record.properties && typeof record.properties === 'object' ? record.properties as Record<string, unknown> : record;
  return Object.fromEntries(Object.entries(source).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, String(value)]));
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
  const [showRecent, setShowRecent] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');

  useEffect(() => { if (!schemaCredentialId && schemaCredentials.candidates[0]) setSchemaCredentialId(schemaCredentials.candidates[0].id); }, [schemaCredentialId, schemaCredentials.candidates]);
  useEffect(() => { if (!queryCredentialId && queryCredentials.candidates[0]) setQueryCredentialId(queryCredentials.candidates[0].id); }, [queryCredentialId, queryCredentials.candidates]);

  const schema = useQuery({
    queryKey: ['stream', workspace?.id, collection, schemaCredentialId],
    enabled: Boolean(client && schemaCredentialId && collection),
    queryFn: ({ signal }) => client!.getCollection(schemaCredentials.select(schemaCredentialId), collection, signal)
  });
  const properties = useMemo(() => Object.entries(propertyMap(schema.data?.data)).filter(([name]) => name.toLowerCase().includes(propertySearch.toLowerCase())).sort(([a], [b]) => a.localeCompare(b)), [schema.data, propertySearch]);

  const recent = useQuery({
    queryKey: ['recent-events', workspace?.id, collection, queryCredentialId, properties.map(([name]) => name).slice(0, 30)],
    enabled: showRecent && Boolean(client && queryCredentialId),
    queryFn: ({ signal }) => {
      const request: QueryDraft = { analysis_type: 'extraction', event_collection: collection, timeframe: 'this_14_days', latest: 25, property_names: ['keen.timestamp', ...properties.map(([name]) => name).filter((name) => name !== 'keen.timestamp').slice(0, 29)] };
      return client!.runQuery(queryCredentials.select(queryCredentialId), request, signal);
    }
  });

  const recentRows = Array.isArray((recent.data?.data as { result?: unknown[] } | undefined)?.result) ? (recent.data!.data as { result: unknown[] }).result : [];

  return (
    <>
      <Link to={`/w/${workspace?.id}/streams`} className="inline-icon small muted" style={{ textDecoration: 'none', marginBottom: 12 }}><ArrowLeft size={14} /> All streams</Link>
      <PageHeader eyebrow="Stream schema" title={collection} description="Schema is inferred from recorded events and can evolve. Dot paths address nested properties; they do not prove strict nullability or validation." actions={<><Button variant="secondary" onClick={() => void schema.refetch()} loading={schema.isFetching}><RefreshCw size={15} /> Refresh schema</Button><Link className="button button--primary" to={`/w/${workspace?.id}/query/new?collection=${encodeURIComponent(collection)}`}><BarChart3 size={15} /> Query stream</Link></>} />
      <div className="split-layout">
        <Card>
          <div className="card__header"><div><h2>Flattened properties</h2><p>{properties.length} properties shown; Keen documents a 1,000-property collection limit.</p></div><Badge tone="purple"><Braces size={12} /> Inferred schema</Badge></div>
          <div className="card__body stack">
            <CredentialSelect credentials={schemaCredentials.candidates} value={schemaCredentialId} onChange={setSchemaCredentialId} />
            <input className="input" value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder="Search property paths" />
            {schema.error ? <ErrorPanel error={schema.error} /> : null}
            {schema.isLoading ? <EmptyState title="Loading schema" description="Requesting the selected collection definition." /> : properties.length === 0 ? <EmptyState title="No property map returned" description="The collection may be empty, unavailable, or represented by an unknown response shape. Raw response remains available below." /> : (
              <div className="table-wrap"><table><thead><tr><th>Property path</th><th>Inferred type</th><th aria-label="Actions" /></tr></thead><tbody>{properties.map(([name, type]) => <tr key={name}><td className="mono">{name}</td><td><Badge tone={type.includes('num') ? 'blue' : type.includes('string') ? 'purple' : 'neutral'}>{type}</Badge></td><td><div className="table-actions"><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(name)}><Copy size={13} /> Copy</Button><Link className="button button--ghost" to={`/w/${workspace?.id}/query/new?collection=${encodeURIComponent(collection)}&target=${encodeURIComponent(name)}`}>Use in query</Link></div></td></tr>)}</tbody></table></div>
            )}
            {schema.data ? <details><summary className="small muted">Raw schema response</summary><pre className="json-view">{JSON.stringify(schema.data.data, null, 2)}</pre></details> : null}
          </div>
        </Card>

        <Card className="sticky-panel">
          <div className="card__header"><div><h2>Recent event values</h2><p>Bounded extraction; raw events are not persisted.</p></div><Eye size={18} /></div>
          <div className="card__body stack">
            <CredentialSelect credentials={queryCredentials.candidates} value={queryCredentialId} onChange={setQueryCredentialId} />
            <Button onClick={() => setShowRecent(true)} loading={recent.isFetching} disabled={!queryCredentialId}>Extract latest 25</Button>
            <Badge tone="warning">May contain personal or sensitive data</Badge>
            {recent.error ? <ErrorPanel error={recent.error} /> : null}
            {showRecent && !recent.isFetching && recentRows.length === 0 ? <EmptyState title="No recent events returned" description="This is a query result, not a schema response. Try a broader timeframe in the Extraction module." /> : recentRows.length ? <pre className="json-view" style={{ maxHeight: 520 }}>{JSON.stringify(recentRows, null, 2)}</pre> : null}
          </div>
        </Card>
      </div>
    </>
  );
}
