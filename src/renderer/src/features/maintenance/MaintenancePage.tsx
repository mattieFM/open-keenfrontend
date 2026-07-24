import { useMemo, useState } from 'react';
import { Eye, FileWarning, Hash, Trash2, Wrench } from 'lucide-react';
import type { KeenFilter, KeenTimeframe, MaintenanceAuditRecord, QueryDraft } from '@shared/types';
import { serializeDeleteEventsScope } from '@shared/url';
import { Badge, Button, Callout, Card, CredentialSelect, EmptyState, ErrorPanel, Field, Input, PageHeader, ReadOnlyGate, Select, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { canonicalJson, sha256 } from '../../lib/maintenance/scope';
import { db } from '../../lib/db/database';

type Action = 'filtered-delete' | 'update-events' | 'delete-property' | 'delete-collection';
type Preview = { hash: string; scope: ScopeModel; count: unknown; sample: unknown; createdAt: string };
type ScopeModel = { action: Action; projectId: string; collection: string; timeframe?: KeenTimeframe; timezone?: string; filters?: KeenFilter[]; property?: string; propertyUpdates?: unknown[] };

export function MaintenancePage(): JSX.Element {
  const { workspace, client, runtimeMode } = useWorkspaceContext();
  const credentials = useOperationCredentials('maintenance').candidates;
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '');
  const [action, setAction] = useState<Action>('filtered-delete');
  const [collection, setCollection] = useState('purchases');
  const [timeframe, setTimeframe] = useState('this_7_days');
  const [timezone, setTimezone] = useState('UTC');
  const [filtersJson, setFiltersJson] = useState('[\n  { "property_name": "customer.id", "operator": "eq", "property_value": "customer_123" }\n]');
  const [property, setProperty] = useState('description');
  const [updatesJson, setUpdatesJson] = useState('[\n  { "property_name": "description", "property_value": "Invalid event", "upsert_property": true }\n]');
  const [preview, setPreview] = useState<Preview>();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<unknown>();
  const credential = credentials.find((item) => item.id === credentialId);

  const parsed = useMemo(() => {
    try {
      const filters = action === 'filtered-delete' || action === 'update-events' ? JSON.parse(filtersJson) as KeenFilter[] : [];
      if (!Array.isArray(filters)) throw new Error('Filters must be an array.');
      const propertyUpdates = action === 'update-events' ? JSON.parse(updatesJson) as unknown[] : [];
      if (!Array.isArray(propertyUpdates)) throw new Error('Property updates must be an array.');
      return { filters, propertyUpdates };
    } catch (caught) { return { filters: [] as KeenFilter[], propertyUpdates: [] as unknown[], error: caught instanceof Error ? caught.message : 'Invalid JSON.' }; }
  }, [action, filtersJson, updatesJson]);
  const scope = useMemo<ScopeModel>(() => ({ action, projectId: workspace?.projectId ?? '', collection: collection.trim(), timeframe: (action === 'filtered-delete' || action === 'update-events') ? timeframe : undefined, timezone: (action === 'filtered-delete' || action === 'update-events') ? timezone : undefined, filters: (action === 'filtered-delete' || action === 'update-events') ? parsed.filters : undefined, property: action === 'delete-property' ? property.trim() : undefined, propertyUpdates: action === 'update-events' ? parsed.propertyUpdates : undefined }), [action, workspace?.projectId, collection, timeframe, timezone, parsed.filters, property, parsed.propertyUpdates]);
  const phrase = workspace ? `${action.toUpperCase()} ${workspace.projectId} ${collection.trim()}` : '';
  const decodedDelete = action === 'filtered-delete' ? { filters: scope.filters, timeframe: scope.timeframe, timezone: scope.timezone } : undefined;
  let encodedDelete = '';
  try { if (decodedDelete) encodedDelete = serializeDeleteEventsScope(decodedDelete); } catch { encodedDelete = ''; }

  const previewScope = async () => {
    if (!client || !credential || !workspace || parsed.error || !collection.trim()) return;
    if ((action === 'filtered-delete' || action === 'update-events') && !timeframe && !parsed.filters.length) { setError(new Error('A filtered maintenance scope requires a timeframe or filter.')); return; }
    if (action === 'update-events' && parsed.propertyUpdates.length === 0) { setError(new Error('Add at least one property update.')); return; }
    if (action === 'delete-property' && !property.trim()) { setError(new Error('Property path is required.')); return; }
    setBusy(true); setError(undefined); setResult(undefined); setSubmitted(false); setConfirmation('');
    try {
      const countQuery: QueryDraft = { analysis_type: 'count', event_collection: collection, timeframe: action === 'filtered-delete' || action === 'update-events' ? timeframe : 'this_100_years', timezone, filters: action === 'filtered-delete' || action === 'update-events' ? parsed.filters : undefined, include_metadata: true };
      const extractionQuery: QueryDraft = { analysis_type: 'extraction', event_collection: collection, timeframe: countQuery.timeframe, timezone, filters: countQuery.filters, latest: 5, property_names: action === 'delete-property' ? ['keen.timestamp', property] : ['keen.timestamp'], include_metadata: true };
      const [countResponse, sampleResponse] = await Promise.all([client.runQuery(credential, countQuery), client.runExtraction(credential, extractionQuery)]);
      setPreview({ hash: await sha256(scope), scope: structuredClone(scope), count: countResponse.data, sample: sampleResponse.data, createdAt: new Date().toISOString() });
    } catch (caught) { setError(caught); } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!client || !credential || !workspace || !preview || submitted) return;
    setBusy(true); setError(undefined);
    try {
      const currentHash = await sha256(scope);
      if (currentHash !== preview.hash) throw new Error('The maintenance scope changed after preview. Run preview again.');
      if (confirmation !== phrase) throw new Error('Typed confirmation does not match the required phrase.');
      // One remote submission is allowed per preview, including ambiguous network failures.
      // Running the preview again is the only way to arm another attempt.
      setSubmitted(true);
      let response;
      if (action === 'filtered-delete') response = await client.deleteFilteredEvents(credential, collection, { filters: parsed.filters, timeframe, timezone });
      else if (action === 'delete-collection') response = await client.deleteCollection(credential, collection);
      else if (action === 'delete-property') response = await client.deleteProperty(credential, collection, property);
      else response = await client.updateEvents(credential, collection, { property_updates: parsed.propertyUpdates, timeframe, filters: parsed.filters });
      setResult(response.data ?? { status: response.status });
      const audit: MaintenanceAuditRecord = { id: crypto.randomUUID(), workspaceId: workspace.id, action, scopeHash: preview.hash, target: `${workspace.projectId}/${collection}`, status: 'submitted', createdAt: new Date().toISOString() };
      await db.audits.put(audit);
    } catch (caught) {
      setError(caught);
      const audit: MaintenanceAuditRecord = { id: crypto.randomUUID(), workspaceId: workspace.id, action, scopeHash: preview?.hash ?? 'no-preview', target: `${workspace.projectId}/${collection}`, status: 'failed', createdAt: new Date().toISOString() };
      await db.audits.put(audit);
    } finally { setBusy(false); }
  };

  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before entering the maintenance danger zone." />;
  const scopeMatches = preview ? canonicalJson(scope) === canonicalJson(preview.scope) : false;
  return <><PageHeader eyebrow="Danger zone" title="Data maintenance" description="Master-only irreversible operations with count and extraction previews, immutable scope hashing, exact target display, typed confirmation, single submission, and zero automatic retries." />
    <Callout tone="danger" title="Irreversible project data operations">Keen updates may not be enabled. Deletes and updates are rate-limited, non-routine operations. Never use this screen as a normal data pipeline.</Callout>
    <div className="maintenance-steps"><Step number="1" label="Define exact scope" active={!preview} /><Step number="2" label="Count + sample preview" active={Boolean(preview && !confirmation)} /><Step number="3" label="Hash + typed confirmation" active={Boolean(preview && confirmation)} /><Step number="4" label="Submit once" active={submitted} /></div>
    <div className="split-layout split-layout--wide"><Card><div className="card__header"><div><h2>Operation and scope</h2><p>Target project: <code>{workspace.projectId}</code></p></div><Badge tone="danger">Master required</Badge></div><div className="card__body stack"><CredentialSelect credentials={credentials} value={credentialId} onChange={setCredentialId} label="Master Key" /><Field label="Operation"><Select value={action} onChange={(event) => { setAction(event.target.value as Action); setPreview(undefined); setConfirmation(''); setSubmitted(false); }}><option value="filtered-delete">Delete matching events</option><option value="update-events">Update matching events</option><option value="delete-property">Delete property from collection</option><option value="delete-collection">Delete entire collection</option></Select></Field><Field label="Event collection" required><Input value={collection} onChange={(event) => setCollection(event.target.value)} /></Field>{action === 'filtered-delete' || action === 'update-events' ? <><div className="form-grid"><Field label="Timeframe" required><Input value={timeframe} onChange={(event) => setTimeframe(event.target.value)} /></Field><Field label="Timezone"><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></Field></div><Field label="Filters JSON" error={parsed.error}><Textarea className="textarea--code" value={filtersJson} onChange={(event) => setFiltersJson(event.target.value)} /></Field></> : null}{action === 'update-events' ? <Field label="Property updates JSON" error={parsed.error}><Textarea className="textarea--code" value={updatesJson} onChange={(event) => setUpdatesJson(event.target.value)} /></Field> : null}{action === 'delete-property' ? <Field label="Flattened property path" required><Input value={property} onChange={(event) => setProperty(event.target.value)} /></Field> : null}{action === 'delete-collection' ? <Callout tone="danger" title="Separate whole-collection code path">This action cannot accept filters and never calls the filtered-delete serializer. The preview count uses a very broad 100-year window; the final deletion targets the whole collection, including timestamps outside that preview.</Callout> : null}{action === 'delete-property' ? <Callout tone="warning">Property deletion applies to the collection, not only the sample window. The preview shows recent values but does not narrow the delete.</Callout> : null}{action === 'filtered-delete' ? <><Field label="Decoded DELETE scope"><Textarea readOnly className="textarea--code" value={JSON.stringify(decodedDelete, null, 2)} /></Field><Field label="Encoded query string"><Textarea readOnly className="textarea--code" value={encodedDelete} /></Field><Callout tone="danger" title="No DELETE body">Filters, timeframe, and timezone are sent only as encoded query parameters. An empty scope is rejected and whole-collection deletion is a separate client method.</Callout></> : null}{error ? <ErrorPanel error={error} /> : null}</div><div className="card__footer form-actions"><Button variant="secondary" loading={busy} disabled={!credential || Boolean(parsed.error) || !collection} onClick={previewScope}><Eye size={15} /> Run count + sample preview</Button></div></Card>
      <div className="sticky-panel stack"><Card><div className="card__header"><div><h2>Locked review</h2><p>Changing any scope field invalidates submission.</p></div>{preview ? <Badge tone={scopeMatches ? 'success' : 'danger'}>{scopeMatches ? 'Scope locked' : 'Scope changed'}</Badge> : null}</div><div className="card__body stack">{!preview ? <EmptyState icon={<FileWarning size={28} />} title="Preview required" description="No remote mutation can be submitted until both preview queries succeed and the scope is hashed." /> : <><div className="hash-display"><Hash size={16} /><div><strong>SHA-256 preview hash</strong><code>{preview.hash}</code></div></div><div className="review-target"><div><span>Workspace</span><strong>{workspace.localName}</strong></div><div><span>Project ID</span><strong>{workspace.projectId}</strong></div><div><span>Collection</span><strong>{collection}</strong></div></div><Field label="Count response"><Textarea className="textarea--code" readOnly value={JSON.stringify(preview.count, null, 2)} /></Field><Field label="Small extraction sample"><Textarea className="textarea--code" readOnly value={JSON.stringify(preview.sample, null, 2)} /></Field><ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}><Callout tone="danger" title="Final confirmation">Type the exact phrase below. The final request is rebuilt from the current model and must match the preview hash.</Callout></ReadOnlyGate><Field label="Type this phrase" hint={phrase}><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></Field><Button variant="danger" loading={busy} disabled={runtimeMode !== 'changes-enabled' || submitted || !scopeMatches || confirmation !== phrase} onClick={submit}>{action.includes('delete') ? <Trash2 size={15} /> : <Wrench size={15} />} {submitted ? 'Already submitted' : 'Submit exactly once'}</Button>{result ? <Callout tone="success" title="Operation submitted"><pre className="compact-pre">{JSON.stringify(result, null, 2)}</pre></Callout> : null}</>}</div></Card></div>
    </div>
  </>;
}

function Step({ number, label, active }: { number: string; label: string; active: boolean }): JSX.Element { return <div className={`maintenance-step ${active ? 'active' : ''}`}><span>{number}</span><strong>{label}</strong></div>; }
