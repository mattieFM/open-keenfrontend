import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, BookOpen, Braces, RefreshCw, Search } from 'lucide-react';
import { Badge, Button, Card, CredentialSelect, EmptyState, ErrorPanel, Input, PageHeader } from '../../components/ui';
import { useWorkspaceContext, useOperationCredentials } from '../../lib/api/useWorkspace';
import { useWorkspaceStore } from '../../lib/db/workspaceStore';

function collectionName(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.event_collection === 'string') return record.event_collection;
    if (typeof record.url === 'string') return decodeURIComponent(record.url.split('/').pop() ?? '');
  }
  return 'unknown_collection';
}

function propertyCount(item: unknown): number | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const properties = (item as Record<string, unknown>).properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties) ? Object.keys(properties).length : undefined;
}

export function StreamsPage(): JSX.Element {
  const navigate = useNavigate();
  const { workspace, client } = useWorkspaceContext();
  const { candidates, select } = useOperationCredentials('schema.read');
  const setCapability = useWorkspaceStore((state) => state.setCapability);
  const [credentialId, setCredentialId] = useState(candidates[0]?.id ?? '');
  const [includeSchema, setIncludeSchema] = useState(workspace?.preferences.includeSchemaOnStreamList ?? false);
  const [search, setSearch] = useState('');

  useEffect(() => { if (!credentialId && candidates[0]) setCredentialId(candidates[0].id); }, [credentialId, candidates]);

  const query = useQuery({
    queryKey: ['streams', workspace?.id, credentialId, includeSchema],
    enabled: Boolean(client && workspace && credentialId),
    queryFn: async ({ signal }) => {
      const credential = select(credentialId);
      try {
        const response = await client!.listCollections(credential, includeSchema, signal);
        await setCapability(workspace!.id, 'schema.read', 'allowed');
        return response;
      } catch (error) {
        if ((error as { status?: number }).status === 403) await setCapability(workspace!.id, 'schema.read', 'denied');
        throw error;
      }
    }
  });

  const rows = useMemo(() => {
    const data = Array.isArray(query.data?.data) ? query.data.data : [];
    return data.map((item) => ({ name: collectionName(item), properties: propertyCount(item) })).filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data, search]);

  return (
    <>
      <PageHeader eyebrow="Streams" title="Collect events in Keen" description="Browse the event streams currently available in this project." />
      <Card className="streams-manager">
        <section className="streams-manager__intro">
          <div><h2>Event Streams</h2><p>Stream incredibly rich event data with up to 1,000 custom properties.</p></div>
          <Button variant="ghost" className="streams-docs-link" onClick={() => void window.keenDesktop.openExternal('https://keen.io/docs/streams/')}><BookOpen size={14} /> Read the Docs</Button>
          <div className="streams-manager__settings">
            <CredentialSelect credentials={candidates} value={credentialId} onChange={setCredentialId} label="Schema credential" />
            <label className="checkbox-row"><input type="checkbox" checked={includeSchema} onChange={(event) => setIncludeSchema(event.target.checked)} /><span>Include property schema</span></label>
          </div>
        </section>

        <section className="streams-manager__inventory" aria-label="Event streams">
          <div className="streams-list-toolbar">
            <div className="search-input"><Search size={15} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search event streams" /></div>
            <span className="streams-count">{rows.length} {rows.length === 1 ? 'Stream' : 'Streams'}</span>
            <span className="streams-toolbar-divider" aria-hidden />
            <Button variant="ghost" onClick={() => void query.refetch()} loading={query.isFetching}><RefreshCw size={14} /> Refresh List</Button>
          </div>
          {query.data ? <div className="streams-response-meta"><Badge tone="success">Loaded in {query.data.elapsedMs} ms</Badge></div> : null}
          {query.error ? <ErrorPanel error={query.error} /> : null}
          {!credentialId ? <EmptyState icon={<Braces size={30} />} title="No schema-capable credential configured" description="Add a Read, Master, or schema-scoped Access Key in workspace settings." /> : query.isLoading ? <EmptyState icon={<Activity className="spin" size={30} />} title="Loading event streams" description="Requesting this project's collection inventory." /> : rows.length === 0 ? <EmptyState icon={<Braces size={30} />} title={search ? 'No matching streams' : 'No event streams returned'} description={search ? 'Try another name or clear the search.' : 'No collections were returned for this project and credential.'} /> : (
            <div className="streams-list">
              {rows.map((row) => (
                <button key={row.name} className="streams-list__row" onClick={() => navigate(`/w/${workspace!.id}/streams/${encodeURIComponent(row.name)}`)}>
                  <span><strong>{row.name}</strong>{row.properties === undefined ? null : <small>{row.properties} {row.properties === 1 ? 'property' : 'properties'}</small>}</span>
                  <ArrowRight size={15} aria-hidden />
                </button>
              ))}
            </div>
          )}
        </section>
      </Card>
    </>
  );
}
