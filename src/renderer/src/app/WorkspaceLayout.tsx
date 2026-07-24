import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, BarChart3, Boxes, Building2, Cable, Database, FileDown, Gauge, KeyRound, LayoutDashboard,
  LockKeyhole, LogOut, Menu, PanelLeftClose, PanelLeftOpen, PauseCircle, PlayCircle, Plus, Save, Send, Settings, ShieldAlert, UnlockKeyhole
} from 'lucide-react';
import { Badge, Button, Field, Input, Modal } from '../components/ui';
import { useWorkspaceStore } from '../lib/db/workspaceStore';
import { lockWorkspace } from '../lib/vault/credentialVault';
import { clearSecretBoundQueryState } from '../lib/query/queryClient';
import { cancelWorkspaceRequests, getWorkspaceSchedulerSnapshot, resumeWorkspaceScheduler, subscribeWorkspaceScheduler } from '../lib/api/requestScheduler';

const NAV = [
  { to: '', label: 'Overview', icon: Gauge, end: true },
  { to: 'streams', label: 'Streams', icon: Activity },
  { to: 'query/new', label: 'Explorer', icon: BarChart3 },
  { to: 'saved-queries', label: 'Saved queries', icon: Save },
  { to: 'dashboards', label: 'Dashboards', icon: LayoutDashboard },
  { to: 'extract', label: 'Extractions', icon: FileDown },
  { to: 'datasets', label: 'Datasets', icon: Database },
  { to: 'events/write', label: 'Event writer', icon: Send, mutation: true },
  { to: 'access-keys', label: 'Access keys', icon: KeyRound, mutation: true },
  { to: 'maintenance', label: 'Maintenance', icon: ShieldAlert, mutation: true },
  { to: 'organization', label: 'Organization', icon: Building2, mutation: true, organization: true },
  { to: 'settings', label: 'Settings', icon: Settings }
] as const;

export function WorkspaceLayout(): JSX.Element {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === workspaceId));
  const runtimeMode = useWorkspaceStore((state) => workspaceId ? state.runtimeModes[workspaceId] ?? 'read-only' : 'read-only');
  const setRuntimeMode = useWorkspaceStore((state) => state.setRuntimeMode);
  const [collapsed, setCollapsed] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [scheduler, setScheduler] = useState(() => workspaceId ? getWorkspaceSchedulerSnapshot(workspaceId) : undefined);

  useEffect(() => {
    if (!workspaceId) return;
    setScheduler(getWorkspaceSchedulerSnapshot(workspaceId));
    return subscribeWorkspaceScheduler(workspaceId, () => setScheduler(getWorkspaceSchedulerSnapshot(workspaceId)));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspace) return;
    void window.keenDesktop.approveHosts([workspace.analyticsBaseUrl, ...(workspace.dashboardServiceEnabled && workspace.dashboardBaseUrl ? [workspace.dashboardBaseUrl] : [])]).catch(() => {
      // Individual requests surface host validation errors without logging host or credential details.
    });
  }, [workspace?.id, workspace?.analyticsBaseUrl, workspace?.dashboardBaseUrl, workspace?.dashboardServiceEnabled]);

  useEffect(() => () => {
    if (workspaceId) cancelWorkspaceRequests(workspaceId);
    clearSecretBoundQueryState();
  }, [workspaceId]);

  if (!workspace || !workspaceId) return <Navigate to="/connect" replace />;
  const changesEnabled = runtimeMode === 'changes-enabled';

  const enableChanges = () => {
    if (confirmation !== 'ENABLE CHANGES') return;
    setRuntimeMode(workspaceId, 'changes-enabled');
    setConfirmation('');
    setShowUnlock(false);
  };

  const lock = () => {
    cancelWorkspaceRequests(workspaceId);
    clearSecretBoundQueryState();
    lockWorkspace(workspaceId, workspace.credentials);
    setRuntimeMode(workspaceId, 'read-only');
    navigate('/connect');
  };

  return (
    <div className={`workspace-shell ${collapsed ? 'workspace-shell--collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar__brand"><div className="brand-mark brand-mark--small">K</div>{collapsed ? null : <div><strong>Keen</strong><span>Key Console</span></div>}</div>
        <button className="workspace-switcher" onClick={() => navigate('/workspaces')} title="Change workspace">
          <span className="workspace-switcher__icon"><Boxes size={18} /></span>
          {collapsed ? null : <span><strong>{workspace.localName}</strong><small>{workspace.projectId}</small></span>}
          {collapsed ? null : <Menu size={16} />}
        </button>
        <nav className="sidebar__nav" aria-label="Workspace">
          {NAV.filter((item) => !('organization' in item) || Boolean(workspace.organizationId && workspace.credentials.some((credential) => credential.type === 'organization'))).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to || 'overview'} end={'end' in item ? item.end : false} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`} title={collapsed ? item.label : undefined}>
                <Icon size={18} aria-hidden /><span>{item.label}</span>{'mutation' in item && item.mutation && !changesEnabled ? <LockKeyhole size={13} className="nav-item__lock" aria-label="Remote changes disabled" /> : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar__bottom">
          <button className="nav-item" onClick={() => navigate('/connect')}><Plus size={18} /><span>Add workspace</span></button>
          <button className="nav-item" onClick={lock}><LogOut size={18} /><span>Lock & disconnect</span></button>
          <button className="collapse-button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} /><span>Collapse</span></>}</button>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar__crumb"><Cable size={16} /><span>{workspace.analyticsBaseUrl}</span></div>
          <div className="topbar__actions">
            {scheduler?.paused ? <button className="mode-pill mode-pill--warning" title={scheduler.reason} onClick={() => resumeWorkspaceScheduler(workspaceId)}><PlayCircle size={15} /> Resume reads ({scheduler.queued} queued)</button> : scheduler && (scheduler.active || scheduler.queued) ? <span className="mode-pill mode-pill--status"><PauseCircle size={15} /> {scheduler.active} active · {scheduler.queued} queued</span> : null}
            {changesEnabled ? (
              <button className="mode-pill mode-pill--enabled" onClick={() => setRuntimeMode(workspaceId, 'read-only')}><UnlockKeyhole size={15} /> Remote changes enabled</button>
            ) : (
              <button className="mode-pill" onClick={() => setShowUnlock(true)}><LockKeyhole size={15} /> Read-only session</button>
            )}
            <Badge tone={workspace.demo ? 'purple' : 'success'}>{workspace.demo ? 'Synthetic demo' : `${workspace.credentials.length} key${workspace.credentials.length === 1 ? '' : 's'}`}</Badge>
          </div>
        </header>
        <main className="page" key={location.pathname}><Outlet /></main>
      </div>

      {showUnlock ? (
        <Modal
          title="Enable remote changes"
          description="This mode permits event writes, resource updates, and destructive requests. It resets to read-only every time the app starts."
          onClose={() => { setShowUnlock(false); setConfirmation(''); }}
          footer={<><Button variant="secondary" onClick={() => setShowUnlock(false)}>Keep read-only</Button><Button onClick={enableChanges} disabled={confirmation !== 'ENABLE CHANGES'}>Enable changes</Button></>}
        >
          <div className="stack">
            <div className="danger-summary"><ShieldAlert size={22} /><div><strong>Workspace: {workspace.localName}</strong><span>Project ID: {workspace.projectId}</span></div></div>
            <Field label="Type ENABLE CHANGES to continue" required><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
