import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { ChartWidget, DashboardDocument } from '@shared/types';
import { Badge, CredentialSelect, EmptyState, PageHeader } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { db } from '../../lib/db/database';
import { DashboardCanvas, type DashboardChartExecutor } from './DashboardCanvas';

export function DashboardViewerPage(): JSX.Element {
  const { dashboardId } = useParams();
  const { workspaceId, client } = useWorkspaceContext();
  const credentials = useOperationCredentials('query.run').candidates;
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '');
  const [document, setDocument] = useState<DashboardDocument>();
  useEffect(() => { if (dashboardId) void db.dashboards.get(dashboardId).then(setDocument); }, [dashboardId]);
  const executeChart = useCallback<DashboardChartExecutor>(async (widget: ChartWidget, runtime, credential) => {
    if (!client || !credential) throw new Error('No query-capable key is selected.');
    return widget.source.kind === 'saved' ? client.getSavedQueryResult(credential, widget.source.name) : client.runQuery(credential, runtime ?? widget.source.query);
  }, [client]);
  if (!workspaceId || !document) return <EmptyState title="Dashboard not found" description="Open it from dashboard management or import a local dashboard file." />;
  return <><PageHeader eyebrow="Dashboard preview" title={document.title} description="Responsive view mode with chart table fallbacks and connected string/date controls." actions={<><Link className="button button--secondary" to={`/w/${workspaceId}/dashboards`}><ArrowLeft size={15} /><span>Dashboards</span></Link><Link className="button button--primary" to={`/w/${workspaceId}/dashboards/${document.id}/edit`}><Pencil size={15} /><span>Edit</span></Link></>} /><div className="dashboard-view-controls"><CredentialSelect credentials={credentials} value={credentialId} onChange={setCredentialId} label="Dashboard query key" /><Badge tone="success">Read-only preview</Badge></div><DashboardCanvas document={document} credential={credentials.find((item) => item.id === credentialId)} executeChart={executeChart} /></>;
}
