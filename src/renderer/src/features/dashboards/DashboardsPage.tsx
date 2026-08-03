import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Download, FileUp, LayoutDashboard, Plus, RefreshCw, Search, Sparkles, Trash2, UploadCloud } from 'lucide-react';
import type { DashboardDocument } from '@shared/types';
import { Badge, Button, Callout, Card, EmptyState, ErrorPanel, Field, IconButton, Input, PageHeader, Select } from '../../components/ui';
import { useWorkspaceContext, useOperationCredentials } from '../../lib/api/useWorkspace';
import { useWorkspaceStore } from '../../lib/db/workspaceStore';
import { db } from '../../lib/db/database';
import { createDashboard, migrateDashboard, touch } from '../../lib/dashboard/model';
import { AUTO_DASHBOARD_TEMPLATE_VERSION, autoDashboardMetadata, syncAutomaticDashboards, type AutoDashboardSyncSummary } from '../../lib/dashboard/autoDashboard';

const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function DashboardsPage(): JSX.Element {
  const { workspace, workspaceId, client, dashboardClient, runtimeMode } = useWorkspaceContext();
  const dashboardReadCredentials = useOperationCredentials('dashboard.read').candidates;
  const dashboardWriteCredentials = useOperationCredentials('dashboard.manage').candidates;
  const schemaCredentials = useOperationCredentials('schema.read').candidates;
  const queryCredentials = useOperationCredentials('query.run').candidates;
  const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace);
  const [documents, setDocuments] = useState<DashboardDocument[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'oldest' | 'az' | 'za'>('recent');
  const [kind, setKind] = useState<'all' | 'automatic' | 'manual'>('all');
  const [error, setError] = useState<unknown>();
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoSummary, setAutoSummary] = useState<AutoDashboardSyncSummary>();
  const autoStarted = useRef(false);
  const navigate = useNavigate();
  const reload = useCallback(async () => { if (workspaceId) setDocuments(await db.dashboards.where('workspaceId').equals(workspaceId).toArray()); }, [workspaceId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    autoStarted.current = false;
    setAutoSummary(undefined);
    setError(undefined);
  }, [workspaceId]);

  const runAutomaticSync = useCallback(async (refreshExisting = false) => {
    if (!workspace || !client) return;
    const schemaCredential = schemaCredentials[0];
    if (!schemaCredential) { setError(new Error('Automatic dashboards require a Read, Access, or Master key that can inspect stream schema.')); return; }
    setAutoLoading(true); setError(undefined);
    try {
      const summary = await syncAutomaticDashboards({ workspace, client, schemaCredential, queryCredential: queryCredentials[0], refreshExisting });
      setAutoSummary(summary);
      await updateWorkspace(workspace.id, { preferences: { ...workspace.preferences, autoDashboardLastSync: new Date().toISOString() } });
      await reload();
    } catch (caught) { setError(caught); }
    finally { setAutoLoading(false); }
  }, [client, queryCredentials, reload, schemaCredentials, updateWorkspace, workspace]);

  const requestTemplateRefresh = useCallback(() => {
    const customizedCount = documents.filter((document) => autoDashboardMetadata(document)).length;
    const message = customizedCount
      ? `Rebuild ${customizedCount} automatic dashboard${customizedCount === 1 ? '' : 's'} from the current templates? This replaces visual changes made directly to those automatic dashboards. Manual dashboards are never changed.`
      : 'Build automatic dashboards from the current stream schemas?';
    if (window.confirm(message)) void runAutomaticSync(true);
  }, [documents, runAutomaticSync]);

  useEffect(() => {
    if (!workspace || autoStarted.current || workspace.preferences.autoDashboards === false || !schemaCredentials[0]) return;
    const previous = workspace.preferences.autoDashboardLastSync ? Date.parse(workspace.preferences.autoDashboardLastSync) : 0;
    if (Number.isFinite(previous) && Date.now() - previous < AUTO_SYNC_INTERVAL_MS) return;
    autoStarted.current = true;
    void runAutomaticSync(false);
  }, [runAutomaticSync, schemaCredentials, workspace]);

  const filtered = useMemo(() => documents.filter((document) => {
    const automatic = Boolean(autoDashboardMetadata(document));
    if (kind === 'automatic' && !automatic) return false;
    if (kind === 'manual' && automatic) return false;
    return `${document.title} ${document.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => sort === 'az' ? a.title.localeCompare(b.title) : sort === 'za' ? b.title.localeCompare(a.title) : sort === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)), [documents, kind, search, sort]);
  const automaticCount = useMemo(() => documents.filter((document) => autoDashboardMetadata(document)).length, [documents]);
  const create = async () => { if (workspaceId) { const document = createDashboard(workspaceId); await db.dashboards.put(document); navigate(`/w/${workspaceId}/dashboards/${document.id}/edit`); } };
  const clone = async (document: DashboardDocument) => { if (!workspaceId) return; const copy = touch({ ...structuredClone(document), id: crypto.randomUUID(), title: `${document.title} copy`, tags: document.tags.filter((tag) => tag !== 'automatic'), metadata: { ...document.metadata, autoDashboard: undefined, isPublic: false, publicAccessKey: null }, createdAt: new Date().toISOString() }); await db.dashboards.put(copy); await reload(); };
  const remove = async (document: DashboardDocument) => { if (confirm(`Delete local dashboard “${document.title}”? This does not delete a remote copy.`)) { await db.dashboards.delete(document.id); await reload(); } };
  const importDashboard = async () => {
    if (!workspaceId) return;
    const opened = await window.keenDesktop.openText();
    if (!opened.opened || !opened.content) return;
    try { const document = migrateDashboard(JSON.parse(opened.content), workspaceId); document.id = crypto.randomUUID(); document.title = `${document.title} (imported)`; document.metadata = { ...document.metadata, autoDashboard: undefined }; await db.dashboards.put(document); await reload(); } catch (caught) { setError(caught); }
  };
  const discoverRemote = async () => {
    if (!workspace?.dashboardServiceEnabled || !dashboardClient) return;
    const credential = dashboardReadCredentials[0];
    if (!credential) { setError(new Error('Configure a Read, Access, or Master key for dashboard reads.')); return; }
    setRemoteLoading(true); setError(undefined);
    try {
      const response = await dashboardClient.list(credential);
      const existing = new Set(documents.map((item) => item.id));
      const placeholders = response.data.filter((item) => !existing.has(item.id)).map((item) => ({ ...createDashboard(workspace.id, item.title ?? item.id), id: item.id, tags: item.tags ?? [], metadata: { remoteOnly: true, ...item }, updatedAt: item.lastModificationDate ? new Date(item.lastModificationDate).toISOString() : new Date().toISOString() }));
      if (placeholders.length) await db.dashboards.bulkPut(placeholders);
      await reload();
    } catch (caught) { setError(caught); } finally { setRemoteLoading(false); }
  };
  if (!workspace || !workspaceId) return <EmptyState title="Workspace not found" description="Open a workspace before managing dashboards." />;

  return <><PageHeader eyebrow="Dashboards" title="Visual dashboards for every stream" description="Dashboards are created locally from your stream schemas, including session_start/session_end views for shared session streams. Every widget is editable through guided controls—no query JSON is required." actions={<><Button variant="secondary" onClick={importDashboard}><FileUp size={15} /> Import dashboard</Button>{workspace.dashboardServiceEnabled ? <Button variant="secondary" loading={remoteLoading} onClick={discoverRemote}><UploadCloud size={15} /> Discover remote</Button> : null}<Button variant="secondary" loading={autoLoading} disabled={!schemaCredentials.length} onClick={requestTemplateRefresh}><RefreshCw size={15} /> Refresh automatic</Button><Button onClick={create}><Plus size={15} /> Blank dashboard</Button></>} />
    <Card className="auto-dashboard-banner"><div className="card__body auto-dashboard-banner__body"><div className="auto-dashboard-banner__icon"><Sparkles size={24} /></div><div><h2>Automatic dashboard studio</h2><p>{workspace.preferences.autoDashboards === false ? 'Automatic generation is disabled in Settings.' : 'Schema sync creates one overview per stream and one view per discovered eventType. Session streams receive purpose-built starts, ends, status, dwell, result, machine, game, event, and conversion widgets.'}</p><div className="row"><Badge tone="purple">{automaticCount} automatic</Badge><Badge tone="success">Read-only generation</Badge><Badge>Template v{AUTO_DASHBOARD_TEMPLATE_VERSION}</Badge></div></div><Button variant="secondary" loading={autoLoading} disabled={!schemaCredentials.length} onClick={() => void runAutomaticSync(false)}><Sparkles size={15} /> Create missing dashboards</Button></div></Card>
    {autoSummary ? <Callout tone={autoSummary.warnings.length ? 'warning' : 'success'} title="Automatic dashboard sync complete"><strong>{autoSummary.created}</strong> created, <strong>{autoSummary.refreshed}</strong> refreshed, <strong>{autoSummary.skipped}</strong> preserved across <strong>{autoSummary.streams}</strong> streams and <strong>{autoSummary.eventTypes}</strong> event types. <strong>{autoSummary.filterOptionSetsLoaded}</strong> automatic filter option set{autoSummary.filterOptionSetsLoaded === 1 ? '' : 's'} loaded.{autoSummary.warnings.length ? <ul className="compact-list">{autoSummary.warnings.slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</Callout> : null}
    {!schemaCredentials.length ? <Callout tone="warning" title="Schema key needed">Add or unlock a Read, restricted Access, or Master key to create dashboards from the live stream schema. Manual dashboards remain available.</Callout> : null}
    <Card><div className="card__header"><div><h2>Your dashboards</h2><p>{documents.length} local record{documents.length === 1 ? '' : 's'} · {workspace.preferences.dashboardPersistence}</p></div><div className="row"><Badge tone="success">Local fallback on</Badge>{workspace.dashboardServiceEnabled ? <Badge tone="warning">Remote source-observed</Badge> : null}</div></div><div className="card__body"><div className="toolbar"><div className="search-input"><Search size={15} /><Input aria-label="Search dashboards" placeholder="Search title, stream, event type, or tags" value={search} onChange={(event) => setSearch(event.target.value)} /></div><Field label="Type"><Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="all">All dashboards</option><option value="automatic">Automatic</option><option value="manual">Manual</option></Select></Field><Field label="Sort"><Select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Most recent</option><option value="oldest">Oldest</option><option value="az">A–Z</option><option value="za">Z–A</option></Select></Field></div>{error ? <ErrorPanel error={error} /> : null}
      {!filtered.length ? <EmptyState icon={<LayoutDashboard size={30} />} title="No matching dashboards" description="Create a blank dashboard or generate one automatically from each stream schema." action={<div className="row"><Button variant="secondary" onClick={() => void runAutomaticSync(false)}><Sparkles size={15} /> Generate automatically</Button><Button onClick={create}><Plus size={15} /> Create blank</Button></div>} /> : <div className="dashboard-card-grid">{filtered.map((document) => { const auto = autoDashboardMetadata(document); return <article className="dashboard-card" key={document.id}><Link className={`dashboard-card__preview ${auto ? 'dashboard-card__preview--automatic' : ''}`} to={`/w/${workspaceId}/dashboards/${document.id}/view`}><LayoutDashboard size={34} /><span>{document.widgets.length} widget{document.widgets.length === 1 ? '' : 's'}</span>{auto ? <div className="dashboard-card__auto-label"><Sparkles size={12} /> {auto.kind === 'event-type' ? auto.eventType : auto.collection}</div> : null}</Link><div className="dashboard-card__body"><div className="row row--between"><div><h3>{document.title}</h3><p>{new Date(document.updatedAt).toLocaleString()}</p></div>{auto ? <Badge tone="purple">Automatic</Badge> : document.metadata.remoteOnly ? <Badge tone="warning">Remote metadata</Badge> : <Badge tone="success">Local</Badge>}</div><div className="tag-row">{document.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div><div className="dashboard-card__actions"><Link className="button button--secondary" to={`/w/${workspaceId}/dashboards/${document.id}/view`}><span>View</span></Link><Link className="button button--primary" to={`/w/${workspaceId}/dashboards/${document.id}/edit`}><span>Edit visually</span></Link><IconButton label="Clone dashboard" onClick={() => void clone(document)}><Copy size={15} /></IconButton><IconButton label="Export dashboard" onClick={() => void window.keenDesktop.saveText({ suggestedName: `${slug(document.title)}.keen-dashboard.json`, content: JSON.stringify(document, null, 2) })}><Download size={15} /></IconButton><IconButton label="Delete local dashboard" onClick={() => void remove(document)}><Trash2 size={15} /></IconButton></div></div></article>; })}</div>}
    </div>{dashboardWriteCredentials.length && runtimeMode === 'read-only' ? <div className="card__footer muted small">Remote writes require enabling changes for this launch. Automatic and manual local dashboard edits remain available.</div> : null}</Card></>;
}
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'dashboard'; }
