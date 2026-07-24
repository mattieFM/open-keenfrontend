import { useState } from 'react';
import { ChevronLeft, ChevronRight, Database, Download, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { QueryDraft } from '@shared/types';
import { Badge, Button, Callout, Card, CredentialSelect, EmptyState, ErrorPanel, Field, IconButton, Input, Modal, PageHeader, ReadOnlyGate, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';

type Dataset = { dataset_name?: string; name?: string; display_name?: string; status?: string; query?: QueryDraft; index_by?: string[]; [key: string]: unknown };

export function DatasetsPage(): JSX.Element {
  const { workspace, client, runtimeMode } = useWorkspaceContext();
  const readCredentials = useOperationCredentials('dataset.read').candidates;
  const manageCredentials = useOperationCredentials('dataset.manage').candidates;
  const [readId, setReadId] = useState(readCredentials[0]?.id ?? '');
  const [manageId, setManageId] = useState(manageCredentials[0]?.id ?? '');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selected, setSelected] = useState<Dataset>();
  const [result, setResult] = useState<unknown>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [afterName, setAfterName] = useState('');
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextAfterName, setNextAfterName] = useState('');
  const [indexValue, setIndexValue] = useState('');
  const [resultTimeframe, setResultTimeframe] = useState('this_7_days');
  const [zeroFill, setZeroFill] = useState(true);
  const [creating, setCreating] = useState(false);
  const readCredential = readCredentials.find((item) => item.id === readId);
  const manageCredential = manageCredentials.find((item) => item.id === manageId);

  const load = async (cursor = afterName, direction: 'same' | 'next' | 'previous' = 'same') => {
    if (!client || !readCredential) return; setLoading(true); setError(undefined);
    try {
      const response = await client.listDatasets(readCredential, 100, cursor || undefined); const data = response.data as unknown;
      const nextDatasets = Array.isArray(data) ? data as Dataset[] : Array.isArray((data as { datasets?: unknown[] })?.datasets) ? (data as { datasets: Dataset[] }).datasets : [];
      setDatasets(nextDatasets); setAfterName(cursor);
      if (direction === 'next') setCursorHistory((history) => [...history, afterName]);
      if (direction === 'previous') setCursorHistory((history) => history.slice(0, -1));
      const nextUrl = data && typeof data === 'object' ? (data as { next_page_url?: unknown }).next_page_url : undefined;
      let parsedNext = '';
      if (typeof nextUrl === 'string') { try { parsedNext = new URL(nextUrl).searchParams.get('after_name') ?? ''; } catch { parsedNext = ''; } }
      if (!parsedNext && nextDatasets.length === 100) parsedNext = nextDatasets.at(-1)?.dataset_name ?? nextDatasets.at(-1)?.name ?? '';
      setNextAfterName(parsedNext);
    } catch (caught) { setError(caught); } finally { setLoading(false); }
  };
  const open = async (dataset: Dataset) => {
    const name = dataset.dataset_name ?? dataset.name; if (!client || !readCredential || !name) return; setError(undefined); setSelected(dataset); setResult(undefined); setIndexValue('');
    try { const definition = await client.getDataset(readCredential, name); setSelected(definition.data as Dataset); } catch (caught) { setError(caught); }
  };
  const retrieve = async () => {
    const name = selected?.dataset_name ?? selected?.name; if (!client || !readCredential || !name) return;
    if (!indexValue.trim() || !resultTimeframe.trim()) { setError(new Error('Both index_by and timeframe are required.')); return; }
    let indexBy: unknown = indexValue.trim();
    if (indexValue.trim().startsWith('{')) { try { indexBy = JSON.parse(indexValue); } catch (caught) { setError(caught); return; } }
    setLoading(true); setError(undefined);
    try { const response = await client.getDatasetResults(readCredential, name, { index_by: indexBy, timeframe: resultTimeframe.trim(), zero_fill: zeroFill }); setResult(response.data); } catch (caught) { setError(caught); } finally { setLoading(false); }
  };
  const remove = async (dataset: Dataset) => {
    const name = dataset.dataset_name ?? dataset.name; if (!client || !manageCredential || !name || !confirm(`Delete Early Release dataset “${name}”?`)) return;
    try { await client.deleteDataset(manageCredential, name); await load(); setSelected(undefined); } catch (caught) { setError(caught); }
  };
  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before using cached datasets." />;
  const filtered = datasets.filter((item) => `${item.dataset_name ?? item.name ?? ''} ${item.display_name ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return <><PageHeader eyebrow="Early Release" title="Cached datasets" description="Create indexed, hourly refreshed query datasets; list definitions/statuses; retrieve indexed results; and delete with a Master Key." actions={<><Button variant="secondary" loading={loading} onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button><Button onClick={() => setCreating(true)} disabled={runtimeMode !== 'changes-enabled'}><Plus size={15} /> Create dataset</Button></>} />
    <Callout tone="warning" title="Early Release behavior">Definitions are treated as create-only unless live verification proves update support. Results refresh hourly; only the latest 48 hours are recomputed, so late older events may not appear.</Callout>
    <div className="split-layout"><Card><div className="card__header"><div><h2>Datasets</h2><p>Statuses include Created, Bootstrapping, OK, BootstrappingFailed, Warn, and unknown values.</p></div><Badge tone="warning">Early Release</Badge></div><div className="card__body stack"><CredentialSelect credentials={readCredentials} value={readId} onChange={setReadId} label="Read / dataset Access Key" /><Field label="Search"><div className="search-input"><Search size={15} /><Input value={search} onChange={(event) => setSearch(event.target.value)} /></div></Field>{error ? <ErrorPanel error={error} /> : null}{!filtered.length ? <EmptyState icon={<Database size={30} />} title="No datasets loaded" description="Choose a dataset-capable credential and refresh. Permission errors are not presented as an authoritative empty list." action={<Button variant="secondary" onClick={() => void load()}>Load datasets</Button>} /> : <div className="dataset-list">{filtered.map((dataset) => { const name = dataset.dataset_name ?? dataset.name ?? 'Unnamed'; return <button key={name} className={`dataset-row ${selected && (selected.dataset_name ?? selected.name) === name ? 'active' : ''}`} onClick={() => void open(dataset)}><div><strong>{dataset.display_name ?? name}</strong><span>{name}</span></div><Badge tone={statusTone(dataset.status)}>{dataset.status ?? 'Unknown'}</Badge></button>; })}</div>}<div className="row row--between"><span className="muted small">Up to 100 definitions per page</span><div className="row"><Button variant="secondary" disabled={!cursorHistory.length || loading} onClick={() => { const previous = cursorHistory.at(-1) ?? ''; void load(previous, 'previous'); }}><ChevronLeft size={14} /> Previous</Button><Button variant="secondary" disabled={!nextAfterName || loading} onClick={() => void load(nextAfterName, 'next')}>Next <ChevronRight size={14} /></Button></div></div></div></Card>
      <div className="sticky-panel stack"><Card><div className="card__header"><div><h2>Definition and results</h2><p>Raw fields are preserved for forward compatibility.</p></div>{selected ? <IconButton label="Download dataset result" onClick={() => void window.keenDesktop.saveText({ suggestedName: `${selected.dataset_name ?? selected.name}-results.json`, content: JSON.stringify(result, null, 2) })}><Download size={15} /></IconButton> : null}</div><div className="card__body stack">{!selected ? <EmptyState title="Select a dataset" description="Its definition/status and current indexed result response will appear here." /> : <><pre className="json-view">{JSON.stringify(selected, null, 2)}</pre><div className="stack stack--compact"><strong className="small">Retrieve indexed results</strong><Field label="index_by value" hint="For one string index enter the value. For multiple or non-string indexes enter a JSON object."><Input value={indexValue} onChange={(event) => setIndexValue(event.target.value)} placeholder='customer-123 or {"customer.id":"123","region":"CA"}' /></Field><div className="form-grid"><Field label="Timeframe" required><Input value={resultTimeframe} onChange={(event) => setResultTimeframe(event.target.value)} /></Field><label className="checkbox-row"><input type="checkbox" checked={zeroFill} onChange={(event) => setZeroFill(event.target.checked)} /><span>Zero fill grouped intervals</span></label></div><Button variant="secondary" loading={loading} onClick={() => void retrieve()}>Retrieve result</Button></div>{result !== undefined ? <pre className="json-view">{JSON.stringify(result, null, 2)}</pre> : <Callout tone="info">Result retrieval requires both <code>index_by</code> and a timeframe contained within the cached definition.</Callout>}<CredentialSelect credentials={manageCredentials} value={manageId} onChange={setManageId} label="Master Key for deletion" /><ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}><Button variant="danger" disabled={!manageCredential} onClick={() => void remove(selected)}><Trash2 size={15} /> Delete dataset</Button></ReadOnlyGate></>}</div></Card></div>
    </div>{creating ? <CreateDatasetModal credential={manageCredential} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} /> : null}
  </>;
}

function CreateDatasetModal({ credential, onClose, onSaved }: { credential?: ReturnType<typeof useOperationCredentials>['candidates'][number]; onClose(): void; onSaved(): Promise<void> }): JSX.Element {
  const { client } = useWorkspaceContext();
  const [name, setName] = useState('orders_by_customer');
  const [displayName, setDisplayName] = useState('Orders by customer');
  const [queryJson, setQueryJson] = useState(JSON.stringify({ analysis_type: 'count', event_collection: 'orders', timeframe: 'this_30_days', interval: 'daily', group_by: 'customer.id' }, null, 2));
  const [indexBy, setIndexBy] = useState('customer.id');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!client || !credential) { setError('Select a Master Key.'); return; }
    try {
      const query = JSON.parse(queryJson) as QueryDraft; const indexes = indexBy.split(',').map((value) => value.trim()).filter(Boolean);
      if (!name.trim()) throw new Error('Dataset name is required.'); if (query.analysis_type === 'funnel') throw new Error('Funnel analyses are not supported for datasets.'); if (!query.interval) throw new Error('Dataset query needs an interval.'); if (indexes.length > 3) throw new Error('Datasets support at most three index fields.');
      setSaving(true); await client.createDataset(credential, name, { display_name: displayName, query, index_by: indexes }); await onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } finally { setSaving(false); }
  };
  return <Modal title="Create cached dataset" description="Dataset definitions are treated as immutable after creation." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Create dataset</Button></>}><div className="stack"><div className="form-grid"><Field label="API name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Display name"><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field></div><Field label="Query JSON"><Textarea className="textarea--code" value={queryJson} onChange={(event) => setQueryJson(event.target.value)} /></Field><Field label="Index by" hint="Comma-separated, maximum three fields."><Input value={indexBy} onChange={(event) => setIndexBy(event.target.value)} /></Field>{error ? <Callout tone="danger">{error}</Callout> : null}</div></Modal>;
}
function statusTone(status?: string): 'success' | 'warning' | 'danger' | 'neutral' { if (status === 'OK') return 'success'; if (status === 'BootstrappingFailed') return 'danger'; if (status === 'Created' || status === 'Bootstrapping' || status === 'Warn') return 'warning'; return 'neutral'; }
