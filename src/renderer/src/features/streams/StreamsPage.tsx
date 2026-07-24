import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Braces, RefreshCw, Search } from 'lucide-react';
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
    return data.map((item) => ({ raw: item, name: collectionName(item), properties: propertyCount(item) })).filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data, search]);

  return (
    <>
      <PageHeader eyebrow="Streams" title="Event collections" description="Inspect project schema with a Read, Master, or schema-scoped Access Key. Keen returns up to 5,000 collections and supports up to 1,000 unique properties per collection." actions={<Button variant="secondary" onClick={() => void query.refetch()} loading={query.isFetching}><RefreshCw size={15} /> Refresh</Button>} />
      <Card>
        <div className="card__body stack">
          <div className="form-grid">
            <CredentialSelect credentials={candidates} value={credentialId} onChange={setCredentialId} />
            <label className="checkbox-row" style={{ alignSelf: 'end', minHeight: 39, alignItems: 'center' }}><input type="checkbox" checked={includeSchema} onChange={(event) => setIncludeSchema(event.target.checked)} /><span>Include complete property schema in the collection list</span></label>
          </div>
          <div className="toolbar"><div style={{ position: 'relative', width: 320 }}><Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--ink-500)' }} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search collections" style={{ paddingLeft: 32 }} /></div><Badge>{rows.length} displayed</Badge>{query.data ? <Badge tone="success">{query.data.elapsedMs} ms</Badge> : null}</div>
          {query.error ? <ErrorPanel error={query.error} /> : null}
          {!credentialId ? <EmptyState icon={<Braces size={30} />} title="No schema-capable credential configured" description="Add a Read, Master, or schema-scoped Access Key in workspace settings. A Write Key cannot inspect streams." /> : query.isLoading ? <EmptyState icon={<Activity size={30} />} title="Loading stream inventory" description="The request can be cancelled by leaving this page or selecting another workspace." /> : rows.length === 0 ? <EmptyState icon={<Braces size={30} />} title={search ? 'No matching collections' : 'No collection list returned'} description={search ? 'Try another name or clear the search.' : 'An empty response is distinct from a permission denial; inspect the request result above.'} /> : (
            <div className="table-wrap"><table><thead><tr><th>Collection</th><th>Properties</th><th>Schema state</th><th aria-label="Actions" /></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.properties ?? '—'}</td><td><Badge tone={row.properties === undefined ? 'neutral' : 'success'}>{row.properties === undefined ? 'Not loaded' : 'Loaded'}</Badge></td><td><div className="table-actions"><Button variant="ghost" onClick={() => navigate(`/w/${workspace!.id}/streams/${encodeURIComponent(row.name)}`)}>Inspect <ArrowRight size={14} /></Button></div></td></tr>)}</tbody></table></div>
          )}
        </div>
      </Card>
    </>
  );
}
