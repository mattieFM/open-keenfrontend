import { useEffect, useMemo, useState } from 'react';
import { Braces, Copy, Database, Download, Play, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import type { KnownSavedQueryRecord } from '@shared/types';
import { Badge, Button, Callout, Card, CredentialSelect, EmptyState, ErrorPanel, Field, Input, Modal, PageHeader, ReadOnlyGate, Select, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { db } from '../../lib/db/database';

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate = record.queries ?? record.saved_queries ?? record.results;
    if (Array.isArray(candidate)) return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  }
  return [];
}

function queryName(item: Record<string, unknown>): string {
  return String(item.query_name ?? item.name ?? item.id ?? 'unnamed-query');
}

function metadataTags(item: Record<string, unknown>): string[] {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== 'object') return [];
  const tags = (metadata as Record<string, unknown>).tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
}

function observedDate(item: Record<string, unknown>): number {
  const candidates = [item.updated_at, item.updatedAt, item.created_at, item.createdAt, item.last_modified, item.lastModificationDate];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; }
  }
  return 0;
}

export function SavedQueriesPage(): JSX.Element {
  const { workspace, client, runtimeMode } = useWorkspaceContext();
  const resultCredentials = useOperationCredentials('saved.result.read');
  const definitionCredentials = useOperationCredentials('saved.definition.read');
  const manageCredentials = useOperationCredentials('saved.manage');
  const [resultCredentialId, setResultCredentialId] = useState(resultCredentials.candidates[0]?.id ?? '');
  const [definitionCredentialId, setDefinitionCredentialId] = useState(definitionCredentials.candidates[0]?.id ?? '');
  const [masterCredentialId, setMasterCredentialId] = useState(manageCredentials.candidates[0]?.id ?? '');
  const [knownName, setKnownName] = useState('');
  const [knownHistory, setKnownHistory] = useState<KnownSavedQueryRecord[]>([]);
  const [list, setList] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'az' | 'za' | 'newest' | 'oldest'>('az');
  const [tagFilter, setTagFilter] = useState('');
  const [cacheFilter, setCacheFilter] = useState<'all' | 'cached' | 'live'>('all');
  const [selectedName, setSelectedName] = useState<string>();
  const [definition, setDefinition] = useState<unknown>();
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [editorJson, setEditorJson] = useState(JSON.stringify({ query: { analysis_type: 'count', event_collection: 'purchases', timeframe: 'this_14_days' }, refresh_rate: 0, metadata: { display_name: 'Purchases — 14 days', tags: ['core'] } }, null, 2));
  const [editorError, setEditorError] = useState<string>();
  const [deleteName, setDeleteName] = useState<string>();

  const changesEnabled = runtimeMode === 'changes-enabled';
  useEffect(() => { if (!resultCredentialId && resultCredentials.candidates[0]) setResultCredentialId(resultCredentials.candidates[0].id); }, [resultCredentialId, resultCredentials.candidates]);
  useEffect(() => { if (!definitionCredentialId && definitionCredentials.candidates[0]) setDefinitionCredentialId(definitionCredentials.candidates[0].id); }, [definitionCredentialId, definitionCredentials.candidates]);
  useEffect(() => { if (!masterCredentialId && manageCredentials.candidates[0]) setMasterCredentialId(manageCredentials.candidates[0].id); }, [masterCredentialId, manageCredentials.candidates]);
  useEffect(() => { if (!workspace) return; void db.knownSavedQueries.where('workspaceId').equals(workspace.id).reverse().sortBy('lastOpenedAt').then((items) => setKnownHistory(items.reverse())); }, [workspace]);

  const filtered = useMemo(() => list.filter((item) => {
    const text = `${queryName(item)} ${String((item.metadata as Record<string, unknown> | undefined)?.display_name ?? '')} ${metadataTags(item).join(' ')}`.toLowerCase();
    const cached = Number(item.refresh_rate ?? 0) > 0;
    return text.includes(search.toLowerCase())
      && (!tagFilter.trim() || metadataTags(item).some((tag) => tag.toLowerCase().includes(tagFilter.trim().toLowerCase())))
      && (cacheFilter === 'all' || (cacheFilter === 'cached' ? cached : !cached));
  }).sort((a, b) => sort === 'az' ? queryName(a).localeCompare(queryName(b)) : sort === 'za' ? queryName(b).localeCompare(queryName(a)) : sort === 'newest' ? observedDate(b) - observedDate(a) : observedDate(a) - observedDate(b)), [list, search, tagFilter, cacheFilter, sort]);

  const remember = async (name: string) => {
    if (!workspace) return;
    const record: KnownSavedQueryRecord = { id: `${workspace.id}:${name}`, workspaceId: workspace.id, name, lastOpenedAt: new Date().toISOString() };
    await db.knownSavedQueries.put(record);
    const items = await db.knownSavedQueries.where('workspaceId').equals(workspace.id).toArray();
    setKnownHistory(items.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)));
  };

  const openKnown = async (name = knownName) => {
    if (!client || !name.trim() || !resultCredentialId) return;
    setLoading(true); setError(undefined); setSelectedName(name.trim()); setDefinition(undefined); setResult(undefined);
    try {
      const resultResponse = await client.getSavedQueryResult(resultCredentials.select(resultCredentialId), name.trim());
      setResult(resultResponse.data);
      await remember(name.trim());
      if (definitionCredentialId) {
        try {
          const definitionResponse = await client.getSavedQuery(definitionCredentials.select(definitionCredentialId), name.trim());
          setDefinition(definitionResponse.data);
        } catch {
          // Definition access is optional; result access remains useful.
        }
      }
    } catch (requestError) { setError(requestError); } finally { setLoading(false); }
  };

  const loadInventory = async () => {
    if (!client || !masterCredentialId) return;
    setLoading(true); setError(undefined);
    try { const response = await client.listSavedQueries(manageCredentials.select(masterCredentialId)); setList(asArray(response.data)); } catch (requestError) { setError(requestError); } finally { setLoading(false); }
  };

  const editExisting = async (name: string) => {
    if (!client || !masterCredentialId) return;
    setLoading(true); setError(undefined);
    try { const response = await client.getSavedQuery(manageCredentials.select(masterCredentialId), name); setEditorName(name); setEditorJson(JSON.stringify(response.data, null, 2)); setEditorOpen(true); } catch (requestError) { setError(requestError); } finally { setLoading(false); }
  };

  const cloneExisting = async (name: string) => {
    if (!client || !masterCredentialId) return;
    setLoading(true); setError(undefined);
    try {
      const response = await client.getSavedQuery(manageCredentials.select(masterCredentialId), name);
      setEditorName(`${name}_copy`);
      setEditorJson(JSON.stringify(response.data, null, 2));
      setEditorOpen(true);
    } catch (requestError) { setError(requestError); } finally { setLoading(false); }
  };

  const saveDefinition = async () => {
    if (!client || !masterCredentialId || !editorName.trim()) return;
    if (!/^[A-Za-z0-9_-]+$/.test(editorName)) { setEditorError('API name may contain only letters, numbers, hyphens, and underscores.'); return; }
    try {
      const body = JSON.parse(editorJson) as Record<string, unknown>;
      setLoading(true); setEditorError(undefined);
      await client.putSavedQuery(manageCredentials.select(masterCredentialId), editorName.trim(), body);
      setEditorOpen(false);
      await loadInventory();
    } catch (saveError) { setEditorError(saveError instanceof Error ? saveError.message : 'Could not save the definition.'); } finally { setLoading(false); }
  };

  const remove = async () => {
    if (!client || !masterCredentialId || !deleteName) return;
    setLoading(true);
    try { await client.deleteSavedQuery(manageCredentials.select(masterCredentialId), deleteName); setDeleteName(undefined); await loadInventory(); } catch (requestError) { setError(requestError); } finally { setLoading(false); }
  };

  return (
    <>
      <PageHeader eyebrow="Compute" title="Saved & cached queries" description="Read-capable credentials can retrieve known saved-query results. Listing definitions and CRUD require a Master Key; restricted Access Keys can optionally read a definition with query_definition." actions={<Button variant="secondary" onClick={loadInventory} loading={loading} disabled={!masterCredentialId}><RefreshCw size={15} /> Load Master inventory</Button>} />
      <div className="split-layout">
        <div className="stack">
          <Card>
            <div className="card__header"><div><h2>Open a known query name</h2><p>This flow works even when the selected key cannot list definitions.</p></div><Play size={18} /></div>
            <div className="card__body stack">
              <div className="form-grid"><CredentialSelect credentials={resultCredentials.candidates} value={resultCredentialId} onChange={setResultCredentialId} label="Result credential" /><CredentialSelect credentials={definitionCredentials.candidates} value={definitionCredentialId} onChange={setDefinitionCredentialId} label="Optional definition credential" /></div>
              <div className="row"><Input value={knownName} onChange={(event) => setKnownName(event.target.value)} placeholder="saved_query_name" /><Button onClick={() => void openKnown()} loading={loading} disabled={!knownName.trim() || !resultCredentialId}>Open result</Button></div>
              {knownHistory.length ? <div><div className="small muted" style={{ marginBottom: 8 }}>Local history — not an authoritative server list</div><div className="row" style={{ flexWrap: 'wrap' }}>{knownHistory.slice(0, 10).map((item) => <button className="badge" key={item.id} onClick={() => { setKnownName(item.name); void openKnown(item.name); }}>{item.name}</button>)}</div></div> : null}
            </div>
          </Card>

          <Card>
            <div className="card__header"><div><h2>Master definition inventory</h2><p>{list.length ? `${list.length} definitions returned` : 'Load explicitly with a Master Key'}</p></div><Button onClick={() => { setEditorName(''); setEditorOpen(true); }} disabled={!masterCredentialId || !changesEnabled}><Plus size={15} /> New saved query</Button></div>
            <div className="card__body stack">
              <CredentialSelect credentials={manageCredentials.candidates} value={masterCredentialId} onChange={setMasterCredentialId} label="Master credential" />
              {!changesEnabled && masterCredentialId ? <ReadOnlyGate enabled={false}><></></ReadOnlyGate> : null}
              <div className="toolbar" style={{ alignItems: 'end', flexWrap: 'wrap' }}><div style={{ position: 'relative', width: 280 }}><Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--ink-500)' }} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, labels, or tags" style={{ paddingLeft: 32 }} /></div><Field label="Tag"><Input value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} placeholder="commerce" /></Field><Field label="Cache"><Select value={cacheFilter} onChange={(event) => setCacheFilter(event.target.value as typeof cacheFilter)}><option value="all">All</option><option value="cached">Cached</option><option value="live">Not cached</option></Select></Field><Field label="Sort"><Select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="az">A–Z</option><option value="za">Z–A</option><option value="newest">Newest observed</option><option value="oldest">Oldest observed</option></Select></Field></div>
              {error ? <ErrorPanel error={error} /> : null}
              {!masterCredentialId ? <EmptyState icon={<Database size={28} />} title="Master Key not configured" description="You can still use the known-name result flow above with a Read or appropriately scoped Access Key." /> : filtered.length === 0 ? <EmptyState icon={<Braces size={28} />} title={list.length ? 'No matching definitions' : 'Inventory not loaded'} description={list.length ? 'Clear the search or use another name.' : 'Press Load Master inventory. A denied request is not presented as an authoritative empty list.'} /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Cache</th><th>Metadata</th><th aria-label="Actions" /></tr></thead><tbody>{filtered.map((item) => { const name = queryName(item); return <tr key={name}><td><strong>{name}</strong></td><td>{Number(item.refresh_rate ?? 0) > 0 ? <Badge tone="success">{String(item.refresh_rate)} sec</Badge> : <Badge>Live</Badge>}</td><td><code>{JSON.stringify(item.metadata ?? {})}</code></td><td><div className="table-actions"><Button variant="ghost" onClick={() => void openKnown(name)}>Run</Button><Button variant="ghost" onClick={() => void editExisting(name)} disabled={!changesEnabled}>Edit</Button><Button variant="ghost" onClick={() => void cloneExisting(name)} disabled={!changesEnabled}><Copy size={13} /> Clone</Button><Button variant="ghost" onClick={() => setDeleteName(name)} disabled={!changesEnabled}><Trash2 size={13} /></Button></div></td></tr>; })}</tbody></table></div>}
            </div>
          </Card>
        </div>

        <div className="sticky-panel stack">
          <Card>
            <div className="card__header"><div><h2>{selectedName ?? 'Selected result'}</h2><p>Result and definition are kept separate by permission.</p></div><div className="row">{result ? <Button variant="secondary" onClick={() => void window.keenDesktop.saveText({ suggestedName: `${selectedName}-result.json`, content: JSON.stringify(result, null, 2) })}><Download size={14} /> Result</Button> : null}{definition ? <Button variant="secondary" onClick={() => void window.keenDesktop.saveText({ suggestedName: `${selectedName}-definition.json`, content: JSON.stringify(definition, null, 2) })}><Download size={14} /> Definition</Button> : null}</div></div>
            <div className="card__body stack">{result ? <><Badge tone="success">Result retrieved</Badge><pre className="json-view">{JSON.stringify(result, null, 2)}</pre>{definition ? <details open><summary className="small muted">Definition</summary><pre className="json-view">{JSON.stringify(definition, null, 2)}</pre></details> : <Callout tone="info">The result key did not provide or was not asked for definition access.</Callout>}</> : <EmptyState title="Open a saved query" description="Enter a known API name or choose one from the Master inventory." />}</div>
          </Card>
        </div>
      </div>

      {editorOpen ? <Modal title={editorName ? `Edit ${editorName}` : 'Create saved query'} description="Unknown metadata fields are preserved. The server is authoritative for refresh-rate validation." onClose={() => setEditorOpen(false)} footer={<><Button variant="secondary" onClick={() => setEditorOpen(false)}>Cancel</Button><Button onClick={saveDefinition} loading={loading}><Save size={14} /> Save definition</Button></>}><div className="stack"><Field label="API name" required><Input value={editorName} onChange={(event) => setEditorName(event.target.value)} placeholder="purchases_14_days" /></Field><Field label="Saved query JSON" error={editorError}><Textarea className="textarea--code" value={editorJson} onChange={(event) => setEditorJson(event.target.value)} /></Field><Callout tone="warning">Caching begins at a server-validated refresh_rate. Conservative presets start at 14,400 seconds (four hours); this app does not hardcode an uncertain upper bound.</Callout></div></Modal> : null}
      {deleteName ? <Modal title="Delete saved query" description="This is a remote Master-Key operation and is not retried automatically." onClose={() => setDeleteName(undefined)} footer={<><Button variant="secondary" onClick={() => setDeleteName(undefined)}>Cancel</Button><Button variant="danger" onClick={remove} loading={loading}>Delete {deleteName}</Button></>}><p>Deleting <strong>{deleteName}</strong> can break dashboards or integrations that reference it.</p></Modal> : null}
    </>
  );
}
