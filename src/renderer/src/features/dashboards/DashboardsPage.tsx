import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Download, FileUp, LayoutDashboard, Plus, Search, Trash2, UploadCloud } from 'lucide-react';
import type { DashboardDocument } from '@shared/types';
import { Badge, Button, Card, EmptyState, ErrorPanel, Field, IconButton, Input, PageHeader, Select } from '../../components/ui';
import { useWorkspaceContext, useOperationCredentials } from '../../lib/api/useWorkspace';
import { db } from '../../lib/db/database';
import { createDashboard, migrateDashboard, touch } from '../../lib/dashboard/model';

export function DashboardsPage(): JSX.Element {
  const { workspace, workspaceId, dashboardClient, runtimeMode } = useWorkspaceContext();
  const readCredentials = useOperationCredentials('dashboard.read').candidates;
  const writeCredentials = useOperationCredentials('dashboard.manage').candidates;
  const [documents, setDocuments] = useState<DashboardDocument[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'oldest' | 'az' | 'za'>('recent');
  const [error, setError] = useState<unknown>();
  const [remoteLoading, setRemoteLoading] = useState(false);
  const navigate = useNavigate();
  const reload = async () => { if (workspaceId) setDocuments(await db.dashboards.where('workspaceId').equals(workspaceId).toArray()); };
  useEffect(() => { void reload(); }, [workspaceId]);

  const filtered = useMemo(() => documents.filter((document) => `${document.title} ${document.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'az' ? a.title.localeCompare(b.title) : sort === 'za' ? b.title.localeCompare(a.title) : sort === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)), [documents, search, sort]);
  const create = async () => { if (workspaceId) { const document = createDashboard(workspaceId); await db.dashboards.put(document); navigate(`/w/${workspaceId}/dashboards/${document.id}/edit`); } };
  const clone = async (document: DashboardDocument) => { if (!workspaceId) return; const copy = touch({ ...structuredClone(document), id: crypto.randomUUID(), title: `${document.title} copy`, metadata: { ...document.metadata, isPublic: false, publicAccessKey: null }, createdAt: new Date().toISOString() }); await db.dashboards.put(copy); await reload(); };
  const remove = async (document: DashboardDocument) => { if (confirm(`Delete local dashboard “${document.title}”? This does not delete a remote copy.`)) { await db.dashboards.delete(document.id); await reload(); } };
  const importDashboard = async () => {
    if (!workspaceId) return;
    const opened = await window.keenDesktop.openText();
    if (!opened.opened || !opened.content) return;
    try { const document = migrateDashboard(JSON.parse(opened.content), workspaceId); document.id = crypto.randomUUID(); document.title = `${document.title} (imported)`; await db.dashboards.put(document); await reload(); } catch (caught) { setError(caught); }
  };
  const discoverRemote = async () => {
    if (!workspace?.dashboardServiceEnabled || !dashboardClient) return;
    const credential = readCredentials[0];
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

  return <><PageHeader eyebrow="Dashboards" title="Dashboard management" description="Local IndexedDB dashboards work independently of Keen’s source-observed dashboard service. Create, view, edit, clone, import, export, and optionally publish through the isolated adapter." actions={<><Button variant="secondary" onClick={importDashboard}><FileUp size={15} /> Import JSON</Button>{workspace.dashboardServiceEnabled ? <Button variant="secondary" loading={remoteLoading} onClick={discoverRemote}><UploadCloud size={15} /> Discover remote</Button> : null}<Button onClick={create}><Plus size={15} /> New dashboard</Button></>} />
    <Card><div className="card__header"><div><h2>Your dashboards</h2><p>{documents.length} local record{documents.length === 1 ? '' : 's'} · {workspace.preferences.dashboardPersistence}</p></div><div className="row"><Badge tone="success">Local fallback on</Badge>{workspace.dashboardServiceEnabled ? <Badge tone="warning">Remote source-observed</Badge> : null}</div></div><div className="card__body"><div className="toolbar"><div className="search-input"><Search size={15} /><Input aria-label="Search dashboards" placeholder="Search title or tags" value={search} onChange={(event) => setSearch(event.target.value)} /></div><Field label="Sort"><Select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Most recent</option><option value="oldest">Oldest</option><option value="az">A–Z</option><option value="za">Z–A</option></Select></Field></div>{error ? <ErrorPanel error={error} /> : null}
      {!filtered.length ? <EmptyState icon={<LayoutDashboard size={30} />} title="No dashboards yet" description="Create a local dashboard with all five documented widget types." action={<Button onClick={create}><Plus size={15} /> Create dashboard</Button>} /> : <div className="dashboard-card-grid">{filtered.map((document) => <article className="dashboard-card" key={document.id}><Link className="dashboard-card__preview" to={`/w/${workspaceId}/dashboards/${document.id}/view`}><LayoutDashboard size={34} /><span>{document.widgets.length} widget{document.widgets.length === 1 ? '' : 's'}</span></Link><div className="dashboard-card__body"><div className="row row--between"><div><h3>{document.title}</h3><p>{new Date(document.updatedAt).toLocaleString()}</p></div>{document.metadata.remoteOnly ? <Badge tone="warning">Remote metadata</Badge> : <Badge tone="success">Local</Badge>}</div><div className="tag-row">{document.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div><div className="dashboard-card__actions"><Link className="button button--secondary" to={`/w/${workspaceId}/dashboards/${document.id}/view`}><span>View</span></Link><Link className="button button--primary" to={`/w/${workspaceId}/dashboards/${document.id}/edit`}><span>Edit</span></Link><IconButton label="Clone dashboard" onClick={() => void clone(document)}><Copy size={15} /></IconButton><IconButton label="Export dashboard" onClick={() => void window.keenDesktop.saveText({ suggestedName: `${slug(document.title)}.keen-dashboard.json`, content: JSON.stringify(document, null, 2) })}><Download size={15} /></IconButton><IconButton label="Delete local dashboard" onClick={() => void remove(document)}><Trash2 size={15} /></IconButton></div></div></article>)}</div>}
    </div>{writeCredentials.length && runtimeMode === 'read-only' ? <div className="card__footer muted small">Remote writes require enabling changes for this launch. Local edits remain available.</div> : null}</Card></>;
}
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'dashboard'; }
