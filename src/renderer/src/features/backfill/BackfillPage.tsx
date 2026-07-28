import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArchiveRestore,
  Braces,
  DatabaseBackup,
  FileCheck2,
  FileUp,
  Hash,
  ListTree,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles
} from 'lucide-react';
import type { KeenFilter, MaintenanceAuditRecord } from '@shared/types';
import {
  Badge,
  Button,
  Callout,
  Card,
  CredentialSelect,
  EmptyState,
  ErrorPanel,
  Field,
  Input,
  PageHeader,
  ReadOnlyGate,
  Select,
  Textarea
} from '../../components/ui';
import { FilterBuilder } from '../explorer/FilterBuilder';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { canonicalJson } from '../../lib/maintenance/scope';
import { db } from '../../lib/db/database';
import { TransformationBuilder, newTransformation } from './TransformationBuilder';
import {
  filterCount,
  parseBackup,
  validateBackfillPlan
} from './model';
import {
  BackfillExecutionError,
  executePreparedBackfill,
  prepareBackfill,
  restoreBackup,
  verifyBackupIntegrity
} from './workflow';
import type {
  BackfillBackup,
  BackfillExecutionResult,
  BackfillMode,
  BackfillPlan,
  BackfillProgress,
  FieldTransformation,
  PreparedBackfill,
  TimestampStrategy
} from './types';

type StudioTab = 'migration' | 'restore';
type FilterMode = 'visual' | 'json';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function collectionName(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const record = item as Record<string, unknown>;
  if (typeof record.name === 'string') return record.name;
  if (typeof record.event_collection === 'string') return record.event_collection;
  if (typeof record.url === 'string') return decodeURIComponent(record.url.split('/').pop() ?? '');
  return '';
}

function propertyNames(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const source = record.properties && typeof record.properties === 'object' ? record.properties as Record<string, unknown> : record;
  return Object.entries(source).filter(([, value]) => typeof value === 'string').map(([name]) => name).sort((a, b) => a.localeCompare(b));
}

function progressTone(progress?: BackfillProgress): 'neutral' | 'success' | 'warning' | 'danger' {
  if (!progress) return 'neutral';
  if (progress.stage === 'complete') return 'success';
  if (progress.stage === 'deleting') return 'danger';
  return 'warning';
}

function executionPhrase(prepared: PreparedBackfill): string {
  const verb = prepared.plan.mode === 'server-upsert' ? 'UPSERT' : 'REBUILD';
  return `${verb} ${prepared.plan.selection.projectId} ${prepared.plan.selection.collection} ${prepared.count}`;
}

export function BackfillPage(): JSX.Element {
  const { workspace, client, runtimeMode } = useWorkspaceContext();
  const credentials = useOperationCredentials('maintenance').candidates;
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '');
  const [tab, setTab] = useState<StudioTab>('migration');
  const [mode, setMode] = useState<BackfillMode>('server-upsert');
  const [collection, setCollection] = useState('purchases');
  const [start, setStart] = useState(() => isoDaysAgo(7));
  const [end, setEnd] = useState(() => new Date().toISOString());
  const [filters, setFilters] = useState<KeenFilter[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>('visual');
  const [filtersJson, setFiltersJson] = useState('[]');
  const [filterError, setFilterError] = useState<string>();
  const [transformations, setTransformations] = useState<FieldTransformation[]>([newTransformation()]);
  const [timestampStrategy, setTimestampStrategy] = useState<TimestampStrategy>('preserve');
  const [timestampValue, setTimestampValue] = useState('');
  const [schemaCollection, setSchemaCollection] = useState('');
  const [prepared, setPrepared] = useState<PreparedBackfill>();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress>();
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<BackfillExecutionResult>();
  const [backup, setBackup] = useState<BackfillBackup>();
  const [openedBackupPath, setOpenedBackupPath] = useState('');
  const [restoreStartIndex, setRestoreStartIndex] = useState(0);
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const [restoreSubmitted, setRestoreSubmitted] = useState(false);
  const credential = credentials.find((item) => item.id === credentialId);

  useEffect(() => {
    if (!credentialId && credentials[0]) setCredentialId(credentials[0].id);
  }, [credentialId, credentials]);

  const collections = useQuery({
    queryKey: ['backfill-collections', workspace?.id, credentialId],
    enabled: Boolean(client && credential && workspace),
    queryFn: ({ signal }) => client!.listCollections(credential!, false, signal)
  });
  const schema = useQuery({
    queryKey: ['backfill-schema', workspace?.id, schemaCollection, credentialId],
    enabled: Boolean(client && credential && schemaCollection),
    queryFn: ({ signal }) => client!.getCollection(credential!, schemaCollection, signal)
  });
  const collectionOptions = useMemo(() => {
    const data = Array.isArray(collections.data?.data) ? collections.data.data : [];
    return data.map(collectionName).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [collections.data]);
  const propertyOptions = useMemo(() => propertyNames(schema.data?.data), [schema.data]);

  const plan = useMemo<BackfillPlan>(() => ({
    mode,
    selection: {
      projectId: workspace?.projectId ?? '',
      collection: collection.trim(),
      timeframe: { start: start.trim(), end: end.trim() },
      filters
    },
    transformations,
    timestamp: {
      strategy: mode === 'server-upsert' ? 'preserve' : timestampStrategy,
      value: mode === 'server-upsert' ? '' : timestampValue.trim()
    }
  }), [mode, workspace?.projectId, collection, start, end, filters, transformations, timestampStrategy, timestampValue]);
  const planErrors = useMemo(() => [...(filterError ? [filterError] : []), ...validateBackfillPlan(plan)], [filterError, plan]);
  const scopeMatches = prepared ? canonicalJson(prepared.plan) === canonicalJson(plan) : false;
  const phrase = prepared ? executionPhrase(prepared) : '';

  const updateFilters = (next: KeenFilter[]) => {
    setFilters(next);
    setFiltersJson(JSON.stringify(next, null, 2));
    setFilterError(undefined);
  };

  const updateFiltersJson = (value: string) => {
    setFiltersJson(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Filters must be a JSON array.');
      setFilters(parsed as KeenFilter[]);
      setFilterError(undefined);
    } catch (caught) {
      setFilterError(caught instanceof Error ? caught.message : 'Invalid filters JSON.');
    }
  };

  const prepare = async () => {
    if (!client || !credential || !workspace || planErrors.length) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setPrepared(undefined);
    setConfirmation('');
    setSubmitted(false);
    setProgress(undefined);
    try {
      const next = await prepareBackfill({
        client,
        credential,
        plan,
        saveBackup: (input) => window.keenDesktop.saveText(input)
      });
      setPrepared(next);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!client || !credential || !workspace || !prepared || submitted || confirmation !== phrase) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setSubmitted(true);
    try {
      const next = await executePreparedBackfill({ client, credential, prepared, currentPlan: plan, onProgress: setProgress });
      setResult(next);
      const audit: MaintenanceAuditRecord = { id: crypto.randomUUID(), workspaceId: workspace.id, action: `backfill-${prepared.plan.mode}`, scopeHash: prepared.scopeHash, target: `${workspace.projectId}/${prepared.plan.selection.collection}`, status: 'submitted', createdAt: new Date().toISOString() };
      await db.audits.put(audit);
    } catch (caught) {
      setError(caught);
      const audit: MaintenanceAuditRecord = { id: crypto.randomUUID(), workspaceId: workspace.id, action: `backfill-${prepared.plan.mode}`, scopeHash: prepared.scopeHash, target: `${workspace.projectId}/${prepared.plan.selection.collection}`, status: 'failed', createdAt: new Date().toISOString() };
      await db.audits.put(audit);
    } finally {
      setBusy(false);
    }
  };

  const openBackup = async () => {
    setError(undefined);
    setBackup(undefined);
    setRestoreConfirmation('');
    setRestoreSubmitted(false);
    setResult(undefined);
    const opened = await window.keenDesktop.openText();
    if (!opened.opened || !opened.content) return;
    try {
      const parsed = parseBackup(JSON.parse(opened.content));
      await verifyBackupIntegrity(parsed);
      setBackup(parsed);
      setOpenedBackupPath(opened.path ?? '');
      setRestoreStartIndex(0);
    } catch (caught) {
      setError(caught);
    }
  };

  const restore = async () => {
    if (!client || !credential || !workspace || !backup || restoreSubmitted) return;
    const restorePhrase = `RESTORE ${workspace.projectId} ${backup.collection} ${backup.events.length - restoreStartIndex}`;
    if (restoreConfirmation !== restorePhrase) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setRestoreSubmitted(true);
    try {
      const next = await restoreBackup({ client, credential, backup, expectedProjectId: workspace.projectId, startIndex: restoreStartIndex, onProgress: setProgress });
      setResult(next);
      const audit: MaintenanceAuditRecord = { id: crypto.randomUUID(), workspaceId: workspace.id, action: 'backfill-restore', scopeHash: 'backup-restore', target: `${workspace.projectId}/${backup.collection}`, status: 'submitted', createdAt: new Date().toISOString() };
      await db.audits.put(audit);
    } catch (caught) {
      setError(caught);
      if (caught instanceof BackfillExecutionError && caught.nextEventIndex !== undefined) setRestoreStartIndex(caught.nextEventIndex);
      const audit: MaintenanceAuditRecord = { id: crypto.randomUUID(), workspaceId: workspace.id, action: 'backfill-restore', scopeHash: 'backup-restore', target: `${workspace.projectId}/${backup.collection}`, status: 'failed', createdAt: new Date().toISOString() };
      await db.audits.put(audit);
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before using Backfill Studio." />;
  const restorePhrase = backup ? `RESTORE ${workspace.projectId} ${backup.collection} ${backup.events.length - restoreStartIndex}` : '';

  return (
    <>
      <PageHeader eyebrow="Master-key migration" title="Backfill Studio" description="Add retrospective columns, compute per-event values, or rebuild an exact event selection only after a full absolute backup is saved." />
      <Callout tone="danger" title="Irreversible and non-atomic">
        Keen updates must be enabled for the project. Every migration uses a Master Key, an absolute start/end, an exact count, a full extraction, a local backup, a locked SHA-256 scope, and zero automatic mutation retries.
      </Callout>
      <div className="tabs backfill-tabs" role="tablist">
        <button className={`tab ${tab === 'migration' ? 'active' : ''}`} onClick={() => setTab('migration')}>Create backfill</button>
        <button className={`tab ${tab === 'restore' ? 'active' : ''}`} onClick={() => setTab('restore')}>Restore backup</button>
      </div>
      {error ? <ErrorPanel error={error} /> : null}
      {progress ? <div className="backfill-progress"><Badge tone={progressTone(progress)}>{progress.stage}</Badge><div><strong>{progress.message}</strong><span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()} events</span></div></div> : null}
      {result ? <Callout tone="success" title="Operation completed">{result.affectedEvents.toLocaleString()} event{result.affectedEvents === 1 ? '' : 's'} processed{result.batches ? ` in ${result.batches} batches` : ''}.</Callout> : null}

      {tab === 'restore' ? (
        <RestorePanel
          backup={backup}
          backupPath={openedBackupPath}
          credentialId={credentialId}
          credentials={credentials}
          onCredentialChange={setCredentialId}
          startIndex={restoreStartIndex}
          onStartIndexChange={setRestoreStartIndex}
          confirmation={restoreConfirmation}
          onConfirmationChange={setRestoreConfirmation}
          phrase={restorePhrase}
          projectId={workspace.projectId}
          runtimeMode={runtimeMode}
          busy={busy}
          submitted={restoreSubmitted}
          onOpen={() => void openBackup()}
          onRestore={() => void restore()}
        />
      ) : (
        <>
          <div className="maintenance-steps backfill-steps">
            <Step number="1" label="Absolute selection" active={!prepared} />
            <Step number="2" label="Field changes" active={!prepared} />
            <Step number="3" label="Full backup + preview" active={Boolean(prepared && !confirmation)} />
            <Step number="4" label="Confirm + apply" active={submitted} />
          </div>
          <div className="backfill-layout">
            <div className="stack">
              <Card>
                <div className="card__header"><div><h2>1. Select events</h2><p>Root conditions are ANDed. OR groups can be nested to match Keen query selectors.</p></div><Badge tone="danger">Master required</Badge></div>
                <div className="card__body stack">
                  <CredentialSelect credentials={credentials} value={credentialId} onChange={setCredentialId} label="Master Key" />
                  <div className="backfill-schema-tools">
                    <Field label="Event collection" required><Input list="backfill-collection-options" value={collection} onChange={(event) => { setCollection(event.target.value); setSchemaCollection(''); }} placeholder="purchases" /></Field>
                    <Button variant="secondary" loading={schema.isFetching} disabled={!collection.trim() || !credential} onClick={() => setSchemaCollection(collection.trim())}><ListTree size={14} /> Load fields</Button>
                    <Button variant="ghost" loading={collections.isFetching} onClick={() => void collections.refetch()}><RefreshCw size={14} /> Streams</Button>
                  </div>
                  <datalist id="backfill-collection-options">{collectionOptions.map((name) => <option key={name} value={name} />)}</datalist>
                  <datalist id="explorer-property-options">{propertyOptions.map((name) => <option key={name} value={name} />)}</datalist>
                  {schema.error ? <ErrorPanel error={schema.error} /> : null}
                  <div className="form-grid">
                    <Field label="Absolute start (ISO-8601)" required><Input value={start} onChange={(event) => setStart(event.target.value)} /></Field>
                    <Field label="Absolute end, exclusive (ISO-8601)" required><Input value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
                  </div>
                  <div className="row row--between"><div><strong className="small">Advanced selectors</strong><div className="field__hint">{filterCount(filters)} leaf condition{filterCount(filters) === 1 ? '' : 's'}; no conditions means every event in the absolute timeframe.</div></div><div className="segmented"><button className={filterMode === 'visual' ? 'active' : ''} onClick={() => setFilterMode('visual')}>Builder</button><button className={filterMode === 'json' ? 'active' : ''} onClick={() => setFilterMode('json')}>Raw JSON</button></div></div>
                  {filterMode === 'visual' ? <FilterBuilder filters={filters} onChange={updateFilters} /> : <Field label="Filters JSON" error={filterError} hint="Normal entries are ANDed. Add {operator:'or', operands:[...]} for alternatives."><Textarea className="textarea--code" value={filtersJson} onChange={(event) => updateFiltersJson(event.target.value)} spellCheck={false} /></Field>}
                </div>
              </Card>

              <Card>
                <div className="card__header"><div><h2>2. Define field changes</h2><p>Use static upsert when possible; use rebuild for per-event copies, templates, generated IDs, removals, or timestamp changes.</p></div><Sparkles size={19} /></div>
                <div className="card__body stack">
                  <Field label="Execution method">
                    <Select value={mode} onChange={(event) => { setMode(event.target.value as BackfillMode); setPrepared(undefined); setConfirmation(''); setSubmitted(false); }}>
                      <option value="server-upsert">Server upsert (constant values, recommended)</option>
                      <option value="rebuild">Backup, delete, transform, and recreate</option>
                    </Select>
                  </Field>
                  {mode === 'server-upsert' ? <Callout tone="info" title="Uses Keen PUT update">Sets or adds constant fields without deleting events. Use an <code>exists = false</code> selector when you only want records missing a column.</Callout> : <Callout tone="danger" title="Rebuild mode deletes first">After the full backup is saved, the exact selection is deleted and replacement events are written in bounded batches. A failed write requires recovery from the saved backup.</Callout>}
                  <TransformationBuilder transformations={transformations} onChange={setTransformations} propertyListId="explorer-property-options" />
                  {mode === 'rebuild' ? (
                    <div className="backfill-timestamp">
                      <div><strong>Timestamp handling</strong><p>Recreated events must explicitly carry a valid <code>keen.timestamp</code> or Keen will assign the current time.</p></div>
                      <div className="form-grid">
                        <Field label="Strategy">
                          <Select value={timestampStrategy} onChange={(event) => setTimestampStrategy(event.target.value as TimestampStrategy)}>
                            <option value="preserve">Preserve every original timestamp</option>
                            <option value="fixed">Set one exact ISO timestamp</option>
                            <option value="copy">Copy timestamp from another property</option>
                          </Select>
                        </Field>
                        {timestampStrategy === 'fixed' ? <Field label="Exact ISO timestamp" required><Input value={timestampValue} onChange={(event) => setTimestampValue(event.target.value)} placeholder="2026-01-01T00:00:00.000Z" /></Field> : timestampStrategy === 'copy' ? <Field label="Timestamp source property" required><Input list="explorer-property-options" value={timestampValue} onChange={(event) => setTimestampValue(event.target.value)} placeholder="original_timestamp" /></Field> : <div className="empty-inline">Every original <code>keen.timestamp</code> is validated and copied into the replacement event.</div>}
                      </div>
                    </div>
                  ) : null}
                  {planErrors.length ? <Callout tone="warning" title="Plan is not ready"><ul className="compact-list">{planErrors.map((message) => <li key={message}>{message}</li>)}</ul></Callout> : <Callout tone="success">Plan structure is valid. The next step runs an exact count and full extraction before asking where to save the backup.</Callout>}
                </div>
                <div className="card__footer form-actions"><Button variant="secondary" loading={busy} disabled={!credential || Boolean(planErrors.length)} onClick={() => void prepare()}><DatabaseBackup size={15} /> Count, extract, and save full backup</Button></div>
              </Card>
            </div>

            <div className="stack backfill-review">
              <Card>
                <div className="card__header"><div><h2>3. Locked backup review</h2><p>Any selector or transformation change invalidates this review.</p></div>{prepared ? <Badge tone={scopeMatches ? 'success' : 'danger'}>{scopeMatches ? 'Scope locked' : 'Scope changed'}</Badge> : null}</div>
                <div className="card__body stack">
                  {!prepared ? <EmptyState icon={<DatabaseBackup size={30} />} title="Full backup required" description="The migration cannot be armed from a count or sample. Every selected event must be extracted and saved to a local file." /> : (
                    <>
                      <div className="hash-display"><Hash size={16} /><div><strong>SHA-256 scope</strong><code>{prepared.scopeHash}</code></div></div>
                      <div className="backfill-backup-proof">
                        <FileCheck2 size={20} />
                        <div><strong>{prepared.count.toLocaleString()} events saved</strong><span>{prepared.backupPath}</span><code>backup {prepared.backupHash}</code></div>
                      </div>
                      <div className="review-target">
                        <div><span>Project</span><strong>{prepared.plan.selection.projectId}</strong></div>
                        <div><span>Collection</span><strong>{prepared.plan.selection.collection}</strong></div>
                        <div><span>Method</span><strong>{prepared.plan.mode}</strong></div>
                      </div>
                      <div className="backfill-stats">
                        <div><span>Changed events</span><strong>{prepared.stats.changedEvents.toLocaleString()}</strong></div>
                        <div><span>Fields written</span><strong>{prepared.stats.writtenFields.toLocaleString()}</strong></div>
                        <div><span>Fields removed</span><strong>{prepared.stats.removedFields.toLocaleString()}</strong></div>
                        <div><span>Assignments skipped</span><strong>{prepared.stats.skippedAssignments.toLocaleString()}</strong></div>
                      </div>
                      <EventDiffTable prepared={prepared} />
                    </>
                  )}
                </div>
              </Card>
              <Card>
                <div className="card__header"><div><h2>4. Confirm once</h2><p>No mutation request is automatically retried.</p></div><ShieldAlert size={19} /></div>
                <div className="card__body stack">
                  <ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}>
                    <Callout tone="danger" title={mode === 'rebuild' ? 'Delete and recreate' : 'Master-key update'}>{mode === 'rebuild' ? 'The exact backed-up selection will be deleted before replacement batches begin.' : 'Keen will update every event in the locked selection with the constant field values.'}</Callout>
                  </ReadOnlyGate>
                  <Field label="Type the exact phrase" hint={phrase || 'Save and lock a backup first.'}><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={!prepared} /></Field>
                  <Button variant="danger" loading={busy} disabled={!prepared || !scopeMatches || runtimeMode !== 'changes-enabled' || submitted || confirmation !== phrase} onClick={() => void execute()}><Play size={15} /> {submitted ? 'Already submitted' : mode === 'rebuild' ? 'Delete and recreate once' : 'Apply server upsert once'}</Button>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function EventDiffTable({ prepared }: { prepared: PreparedBackfill }): JSX.Element {
  const rows = prepared.originalEvents.slice(0, 10);
  return (
    <div className="stack stack--tight">
      <div className="row row--between"><strong>Before / after preview</strong><Badge>{Math.min(10, rows.length)} of {prepared.count.toLocaleString()}</Badge></div>
      <div className="table-wrap backfill-diff-table">
        <table><thead><tr><th>#</th><th>Backed-up original</th><th>{prepared.plan.mode === 'rebuild' ? 'Replacement event' : 'Expected result'}</th></tr></thead>
          <tbody>{rows.map((event, index) => <tr key={index}><td>{index + 1}</td><td><pre>{JSON.stringify(event, null, 2)}</pre></td><td><pre>{JSON.stringify(prepared.replacementEvents[index], null, 2)}</pre></td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function RestorePanel({
  backup,
  backupPath,
  credentialId,
  credentials,
  onCredentialChange,
  startIndex,
  onStartIndexChange,
  confirmation,
  onConfirmationChange,
  phrase,
  projectId,
  runtimeMode,
  busy,
  submitted,
  onOpen,
  onRestore
}: {
  backup?: BackfillBackup;
  backupPath: string;
  credentialId: string;
  credentials: ReturnType<typeof useOperationCredentials>['candidates'];
  onCredentialChange(value: string): void;
  startIndex: number;
  onStartIndexChange(value: number): void;
  confirmation: string;
  onConfirmationChange(value: string): void;
  phrase: string;
  projectId: string;
  runtimeMode: 'read-only' | 'changes-enabled';
  busy: boolean;
  submitted: boolean;
  onOpen(): void;
  onRestore(): void;
}): JSX.Element {
  const projectMatches = backup?.projectId === projectId;
  return (
    <div className="backfill-restore-layout">
      <Card>
        <div className="card__header"><div><h2>Open a Backfill Studio backup</h2><p>The file is validated locally before any event write is enabled.</p></div><ArchiveRestore size={19} /></div>
        <div className="card__body stack">
          <Button variant="secondary" onClick={onOpen}><FileUp size={15} /> Choose backup JSON</Button>
          {!backup ? <EmptyState icon={<Braces size={28} />} title="No backup opened" description="Choose a keen-backfill-backup JSON file created during the full backup gate." /> : (
            <>
              <div className="backfill-backup-proof"><FileCheck2 size={20} /><div><strong>{backup.eventCount.toLocaleString()} original events</strong><span>{backupPath}</span><code>{backup.createdAt}</code></div></div>
              <div className="review-target"><div><span>Project</span><strong>{backup.projectId}</strong></div><div><span>Collection</span><strong>{backup.collection}</strong></div><div><span>Project match</span><strong>{projectMatches ? 'Yes' : 'No'}</strong></div></div>
              {!projectMatches ? <Callout tone="danger">This backup cannot be restored into the active project.</Callout> : null}
              <Callout tone="warning" title="Restore writes; it does not delete">Restoring from index 0 can duplicate events that still exist. After a partial rebuild failure, use the reported next event index and verify which batches succeeded.</Callout>
            </>
          )}
        </div>
      </Card>
      <Card>
        <div className="card__header"><div><h2>Restore original events</h2><p>System-managed keen.id and keen.created_at are removed; original keen.timestamp values are required and preserved.</p></div><DatabaseBackup size={19} /></div>
        <div className="card__body stack">
          <CredentialSelect credentials={credentials} value={credentialId} onChange={onCredentialChange} label="Master Key" />
          <Field label="Start at zero-based event index" hint={backup ? `${Math.max(0, backup.events.length - startIndex).toLocaleString()} events will be submitted.` : 'Open a backup first.'}><Input type="number" min="0" max={backup?.events.length ?? 0} value={startIndex} onChange={(event) => onStartIndexChange(Number(event.target.value))} disabled={!backup} /></Field>
          <ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}>
            <Callout tone="danger">Bulk restoration is a remote write. Item failures stop the workflow and are never retried automatically.</Callout>
          </ReadOnlyGate>
          <Field label="Type the exact phrase" hint={phrase || 'Open a matching backup first.'}><Input value={confirmation} onChange={(event) => onConfirmationChange(event.target.value)} autoComplete="off" disabled={!backup || !projectMatches} /></Field>
          <Button variant="danger" loading={busy} disabled={!backup || !projectMatches || runtimeMode !== 'changes-enabled' || submitted || confirmation !== phrase} onClick={onRestore}><ArchiveRestore size={15} /> {submitted ? 'Already submitted' : 'Restore once'}</Button>
        </div>
      </Card>
    </div>
  );
}

function Step({ number, label, active }: { number: string; label: string; active: boolean }): JSX.Element {
  return <div className={`maintenance-step ${active ? 'active' : ''}`}><span>{number}</span><strong>{label}</strong></div>;
}
