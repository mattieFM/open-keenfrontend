import { Link } from 'react-router-dom';
import { Activity, ArrowRight, BarChart3, Building2, Database, FileDown, KeyRound, LayoutDashboard, LockKeyhole, Send, ShieldAlert } from 'lucide-react';
import { Badge, Card, PageHeader } from '../../components/ui';
import { useWorkspaceContext } from '../../lib/api/useWorkspace';

const MODULES = [
  { path: 'streams', title: 'Streams & schema', description: 'Inspect event collections, flattened property paths, types, and bounded recent values.', icon: Activity, capability: 'schema.read' },
  { path: 'query/new', title: 'Data Explorer', description: 'Build all documented analyses, inspect requests, visualize results, and export data.', icon: BarChart3, capability: 'query.run' },
  { path: 'saved-queries', title: 'Saved queries', description: 'Open a known result with a read key or manage definitions with a Master Key.', icon: Database, capability: 'saved.result.read' },
  { path: 'dashboards', title: 'Dashboards', description: 'Build local-first chart, text, image, filter, and date-range dashboards.', icon: LayoutDashboard, capability: 'dashboard.read' },
  { path: 'extract', title: 'Extractions', description: 'Download bounded synchronous data or request an emailed asynchronous file.', icon: FileDown, capability: 'query.run' },
  { path: 'events/write', title: 'Event writer', description: 'Validate single and bulk instrumentation with explicit, zero-retry writes.', icon: Send, capability: 'event.write', mutation: true },
  { path: 'access-keys', title: 'Access Key manager', description: 'Create least-privilege policies, revoke, unrevoke, clone, and delete.', icon: KeyRound, capability: 'accessKey.manage', mutation: true },
  { path: 'maintenance', title: 'Maintenance danger zone', description: 'Preview, hash-lock, confirm, and submit one destructive request.', icon: ShieldAlert, capability: 'maintenance', mutation: true },
  { path: 'organization', title: 'Organization Admin', description: 'Optional isolated project administration with a separately supplied Organization Key.', icon: Building2, capability: 'organization.manage', mutation: true, organization: true }
] as const;

export function OverviewPage(): JSX.Element {
  const { workspace, runtimeMode } = useWorkspaceContext();
  if (!workspace) return <></>;
  const changesEnabled = runtimeMode === 'changes-enabled';
  const capabilityCount = Object.values(workspace.capabilities).filter((value) => value === 'allowed').length;

  return (
    <>
      <PageHeader eyebrow="Workspace overview" title={workspace.localName} description={<>This is a local alias for Project ID <code>{workspace.projectId}</code>. No account, billing, member, or authoritative project-name data is inferred.</>} actions={<Badge tone={changesEnabled ? 'success' : 'warning'}>{changesEnabled ? 'Remote changes enabled' : <><LockKeyhole size={12} /> Read-only session</>}</Badge>} />
      <div className="stats-grid">
        <Card className="stat-card"><div className="stat-card__icon"><KeyRound size={18} /></div><span className="stat-card__value">{workspace.credentials.length}</span><span className="stat-card__label">Configured credential labels</span></Card>
        <Card className="stat-card"><div className="stat-card__icon"><Activity size={18} /></div><span className="stat-card__value">{capabilityCount}</span><span className="stat-card__label">Observed allowed capabilities</span></Card>
        <Card className="stat-card"><div className="stat-card__icon"><LayoutDashboard size={18} /></div><span className="stat-card__value">{workspace.preferences.dashboardPersistence === 'local' ? 'Local' : 'Hybrid'}</span><span className="stat-card__label">Dashboard persistence mode</span></Card>
        <Card className="stat-card"><div className="stat-card__icon"><LockKeyhole size={18} /></div><span className="stat-card__value">Safe</span><span className="stat-card__label">Mutation retry policy: zero</span></Card>
      </div>
      <div className="module-grid">
        {MODULES.filter((module) => !('organization' in module) || Boolean(workspace.organizationId && workspace.credentials.some((credential) => credential.type === 'organization'))).map((module) => {
          const Icon = module.icon;
          const capability = workspace.capabilities[module.capability as keyof typeof workspace.capabilities] ?? 'unknown';
          return (
            <Link className="card module-card" to={module.path} key={module.path}>
              <div className="module-card__icon"><Icon size={19} /></div>
              <div><h3>{module.title}</h3><p>{module.description}</p></div>
              <div className="module-card__meta"><span>{module.mutation && !changesEnabled ? 'Remote changes locked' : capability === 'denied' ? 'Selected key denied' : capability === 'allowed' ? 'Observed available' : 'Capability unknown'}</span><ArrowRight size={15} /></div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
