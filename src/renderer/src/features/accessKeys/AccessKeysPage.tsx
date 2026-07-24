import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Search, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import { Badge, Button, Callout, Card, CredentialSelect, EmptyState, ErrorPanel, Field, IconButton, Input, Modal, PageHeader, ReadOnlyGate, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';

type AccessKeyRecord = {
  key?: string;
  name?: string;
  is_active?: boolean;
  permitted?: string[];
  options?: Record<string, unknown>;
  [key: string]: unknown;
};

const SCOPES = ['writes', 'queries', 'saved_queries', 'cached_queries', 'datasets', 'schema', 'query_definition'];
const TEMPLATES: Record<string, { permitted: string[]; options: Record<string, unknown> }> = {
  blank: { permitted: [], options: {} },
  'saved-query': { permitted: ['saved_queries'], options: { saved_queries: { allowed: ['KNOWN_QUERY_NAME'] } } },
  'cached-dashboard': { permitted: ['cached_queries'], options: { cached_queries: { allowed: ['QUERY_A', 'QUERY_B'] } } },
  'tenant-dashboard': { permitted: ['queries'], options: { queries: { filters: [{ property_name: 'customer.id', operator: 'eq', property_value: 'TENANT_ID' }] } } },
  'write-only': { permitted: ['writes'], options: { writes: { autofill: { customer: { id: 'TENANT_ID' } } } } },
  'dataset-viewer': { permitted: ['datasets'], options: { datasets: { operations: ['list', 'read', 'retrieve'], allowed: { DATASET_NAME: {} } } } }
};

export function AccessKeysPage(): JSX.Element {
  const { workspace, client, runtimeMode } = useWorkspaceContext();
  const credentials = useOperationCredentials('accessKey.manage').candidates;
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '');
  const [records, setRecords] = useState<AccessKeyRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editor, setEditor] = useState<{ record?: AccessKeyRecord; clone?: boolean }>();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const selectedCredential = credentials.find((item) => item.id === credentialId);

  const load = async (targetPage = page) => {
    if (!client || !selectedCredential) return;
    setLoading(true); setError(undefined);
    try {
      const response = await client.listAccessKeys(selectedCredential, search, targetPage);
      const data = response.data as unknown;
      const nextRecords = Array.isArray(data) ? data as AccessKeyRecord[] : Array.isArray((data as { keys?: unknown[] })?.keys) ? (data as { keys: AccessKeyRecord[] }).keys : [];
      setRecords(nextRecords); setPage(targetPage);
      const pagination = data && typeof data === 'object' ? data as { next_page?: unknown; page?: unknown; total?: unknown } : {};
      setHasNext(Boolean(pagination.next_page) || nextRecords.length === 200);
    } catch (caught) { setError(caught); } finally { setLoading(false); }
  };

  const action = async (record: AccessKeyRecord, kind: 'revoke' | 'unrevoke' | 'delete') => {
    if (!client || !selectedCredential || !record.key) return;
    if (kind === 'delete' && !confirm(`Permanently delete Access Key “${record.name ?? mask(record.key)}”? Revocation is safer and reversible.`)) return;
    setError(undefined);
    try { if (kind === 'delete') await client.deleteAccessKey(selectedCredential, record.key); else await client.accessKeyAction(selectedCredential, record.key, kind); await load(); } catch (caught) { setError(caught); }
  };

  const filtered = useMemo(() => records.filter((record) => `${record.name ?? ''} ${(record.permitted ?? []).join(' ')}`.toLowerCase().includes(search.toLowerCase())), [records, search]);
  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before managing restricted Access Keys." />;

  return <><PageHeader eyebrow="Access Keys" title="Least-privilege key manager" description="Master-only management for custom restricted keys. Access Keys are not administrator credentials; policies are preserved with unknown fields intact." actions={<><Button variant="secondary" loading={loading} onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button><Button onClick={() => setEditor({})} disabled={runtimeMode !== 'changes-enabled'}><Plus size={15} /> Create key</Button></>} />
    <Card><div className="card__header"><div><h2>Project Access Keys</h2><p>List/search/page through the documented project key endpoints. Keys stay masked until a deliberate reveal.</p></div><Badge tone="warning">Master required</Badge></div><div className="card__body stack"><div className="form-grid"><CredentialSelect credentials={credentials} value={credentialId} onChange={setCredentialId} label="Master Key" /><Field label="Search by name"><div className="search-input"><Search size={15} /><Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(1); }} placeholder="customer-dashboard" /></div></Field></div><ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}><Callout tone="warning">Creating, editing, revoking, unrevoking, and deleting keys are remote mutations. Listing remains available in read-only mode.</Callout></ReadOnlyGate>{error ? <ErrorPanel error={error} /> : null}
      {!filtered.length ? <EmptyState icon={<KeyRound size={30} />} title={loading ? 'Loading Access Keys…' : 'No keys loaded'} description="Choose a Master Key and refresh. A denied response is shown as a permission error, never as an authoritative empty project." action={<Button variant="secondary" onClick={() => void load()} disabled={!selectedCredential}>Load keys</Button>} /> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Key</th><th>Status</th><th>Permitted</th><th>Policy</th><th>Actions</th></tr></thead><tbody>{filtered.map((record, index) => {
        const id = record.key ?? `${record.name}-${index}`; const show = revealed.has(id); return <tr key={id}><td><strong>{record.name ?? 'Unnamed key'}</strong></td><td className="mono">{record.key ? show ? record.key : mask(record.key) : 'Not returned'}</td><td><Badge tone={record.is_active === false ? 'danger' : 'success'}>{record.is_active === false ? 'Revoked' : 'Active'}</Badge></td><td><div className="tag-row">{(record.permitted ?? []).map((scope) => <Badge key={scope} tone={scope === 'queries' ? 'warning' : 'purple'}>{scope}</Badge>)}</div></td><td><code>{summarize(record)}</code></td><td><div className="table-actions">{record.key ? <><IconButton label={show ? 'Mask key' : 'Reveal key'} onClick={() => setRevealed((current) => { const next = new Set(current); show ? next.delete(id) : next.add(id); return next; })}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</IconButton><IconButton label="Copy key" onClick={() => void navigator.clipboard.writeText(record.key ?? '')}><Copy size={15} /></IconButton></> : null}<IconButton label="Edit policy" disabled={runtimeMode !== 'changes-enabled'} onClick={() => setEditor({ record })}><ShieldCheck size={15} /></IconButton><IconButton label="Clone policy" disabled={runtimeMode !== 'changes-enabled'} onClick={() => setEditor({ record, clone: true })}><Plus size={15} /></IconButton>{record.key ? <IconButton label={record.is_active === false ? 'Unrevoke key' : 'Revoke key'} disabled={runtimeMode !== 'changes-enabled'} onClick={() => void action(record, record.is_active === false ? 'unrevoke' : 'revoke')}>{record.is_active === false ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}</IconButton> : null}{record.key ? <IconButton label="Delete key" disabled={runtimeMode !== 'changes-enabled'} onClick={() => void action(record, 'delete')}><Trash2 size={15} /></IconButton> : null}</div></td></tr>;
      })}</tbody></table></div>}
      <div className="row row--between"><span className="muted small">Page {page} · up to 200 keys per page</span><div className="row"><Button variant="secondary" disabled={loading || page <= 1} onClick={() => void load(page - 1)}><ChevronLeft size={14} /> Previous</Button><Button variant="secondary" disabled={loading || !hasNext} onClick={() => void load(page + 1)}>Next <ChevronRight size={14} /></Button></div></div>
    </div></Card>
    {editor ? <KeyEditor record={editor.record} clone={editor.clone} credential={selectedCredential} onClose={() => setEditor(undefined)} onSaved={async () => { setEditor(undefined); await load(); }} /> : null}
  </>;
}

function KeyEditor({ record, clone = false, credential, onClose, onSaved }: { record?: AccessKeyRecord; clone?: boolean; credential?: ReturnType<typeof useOperationCredentials>['candidates'][number]; onClose(): void; onSaved(): Promise<void> }): JSX.Element {
  const { client } = useWorkspaceContext();
  const [name, setName] = useState(clone ? `${record?.name ?? 'access-key'}-copy` : record?.name ?? '');
  const [active, setActive] = useState(record?.is_active ?? true);
  const [permitted, setPermitted] = useState<string[]>(record?.permitted ?? []);
  const [optionsJson, setOptionsJson] = useState(JSON.stringify(record?.options ?? {}, null, 2));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(record?.key && !clone);

  const applyTemplate = (name: string) => { const template = TEMPLATES[name]; if (template) { setPermitted(template.permitted); setOptionsJson(JSON.stringify(template.options, null, 2)); } };
  const save = async () => {
    if (!client || !credential) { setError('Select a Master Key.'); return; }
    if (!name.trim() || name.length > 256) { setError('Name is required and must not exceed 256 characters.'); return; }
    let options: Record<string, unknown>;
    try { options = JSON.parse(optionsJson) as Record<string, unknown>; } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid options JSON.'); return; }
    const body = { ...record, key: undefined, name: name.trim(), is_active: active, permitted, options };
    setSaving(true); setError('');
    try { if (isEdit && record?.key) await client.updateAccessKey(credential, record.key, body); else await client.createAccessKey(credential, body); await onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : String((caught as { message?: string })?.message ?? caught)); } finally { setSaving(false); }
  };
  return <Modal title={isEdit ? 'Edit Access Key policy' : 'Create restricted Access Key'} description="Review the effective permission summary. Unknown options from an existing record are round-tripped." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>{isEdit ? 'Save policy' : 'Create key'}</Button></>}><div className="stack"><div className="form-grid"><Field label="Name" required><Input value={name} maxLength={256} onChange={(event) => setName(event.target.value)} /></Field><Field label="Template"><select className="select" defaultValue="blank" onChange={(event) => applyTemplate(event.target.value)}>{Object.keys(TEMPLATES).map((template) => <option key={template} value={template}>{template.replace(/-/g, ' ')}</option>)}</select></Field></div><label className="checkbox-row"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span>Key active</span></label><div className="field"><span className="field__label">Permitted scopes</span><div className="scope-grid">{SCOPES.map((scope) => <label key={scope} className="checkbox-row"><input type="checkbox" checked={permitted.includes(scope)} onChange={(event) => setPermitted((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} /><span>{scope}</span></label>)}</div></div>{permitted.includes('queries') ? <Callout tone="warning" title="Unrestricted query scope can expose the project">Add mandatory tenant filters in <code>options.queries.filters</code> unless broad analytical access is intentional.</Callout> : null}<Field label="Options JSON" hint="Autofill, mandatory filters, saved/cached allow-lists, and dataset restrictions."><Textarea className="textarea--code" value={optionsJson} onChange={(event) => setOptionsJson(event.target.value)} /></Field><Callout tone="info" title="Effective policy">{permitted.length ? `Allows ${permitted.join(', ')}${optionsJson.trim() === '{}' ? ' without additional options.' : ' with the JSON restrictions shown.'}` : 'No scopes selected; the key will not have useful project operations.'}</Callout>{error ? <Callout tone="danger">{error}</Callout> : null}</div></Modal>;
}

function mask(value: string): string { return value.length < 10 ? '••••••••' : `${value.slice(0, 4)}••••••••${value.slice(-4)}`; }
function summarize(record: AccessKeyRecord): string { const options = record.options ?? {}; const text = JSON.stringify(options); if (text === '{}') return 'No restrictions'; return text.length > 90 ? `${text.slice(0, 87)}…` : text; }
