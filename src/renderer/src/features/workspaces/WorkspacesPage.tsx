import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Database, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Modal, PageHeader } from '../../components/ui';
import { useWorkspaceStore } from '../../lib/db/workspaceStore';
import { lockWorkspace } from '../../lib/vault/credentialVault';
import { cancelWorkspaceRequests } from '../../lib/api/requestScheduler';

export function WorkspacesPage(): JSX.Element {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const [deleteId, setDeleteId] = useState<string>();
  const target = workspaces.find((workspace) => workspace.id === deleteId);

  const remove = async () => {
    if (!target) return;
    cancelWorkspaceRequests(target.id);
    lockWorkspace(target.id, target.credentials);
    await deleteWorkspace(target.id);
    setDeleteId(undefined);
  };

  return (
    <div className="workspaces-shell">
      <div className="workspaces-inner">
        <PageHeader title="Local workspaces" description="Each workspace is a local alias, Project ID, approved service hosts, preferences, and encrypted or memory-only credential references." actions={<Button onClick={() => navigate('/connect')}><Plus size={16} /> Add workspace</Button>} />
        {workspaces.length === 0 ? (
          <Card><EmptyState icon={<Database size={30} />} title="No workspaces yet" description="Add a Keen Project ID and one or more supplied project keys. No Keen account login is required." action={<Button onClick={() => navigate('/connect')}>Connect a project</Button>} /></Card>
        ) : (
          <div className="workspace-list">
            {workspaces.map((workspace) => (
              <Card className="workspace-card" key={workspace.id}>
                <div className="workspace-card__top"><div><h2>{workspace.localName}</h2><p className="mono">{workspace.projectId}</p></div><Badge tone={workspace.demo ? 'purple' : 'success'}>{workspace.demo ? 'Demo' : 'Configured'}</Badge></div>
                <div className="workspace-card__meta"><Badge><KeyRound size={12} /> {workspace.credentials.length} key{workspace.credentials.length === 1 ? '' : 's'}</Badge><Badge><ShieldCheck size={12} /> Opens read-only</Badge><Badge>{workspace.preferences.dashboardPersistence} dashboards</Badge></div>
                <div className="workspace-card__actions"><Button onClick={() => navigate(`/w/${workspace.id}`)}>Open <ArrowRight size={15} /></Button><Button variant="secondary" onClick={() => setDeleteId(workspace.id)}><Trash2 size={15} /> Remove locally</Button></div>
              </Card>
            ))}
          </div>
        )}
      </div>
      {target ? <Modal title="Remove local workspace" description="This removes local metadata, encrypted keys, drafts, dashboards, and audit entries. It never deletes the Keen project." onClose={() => setDeleteId(undefined)} footer={<><Button variant="secondary" onClick={() => setDeleteId(undefined)}>Cancel</Button><Button variant="danger" onClick={remove}>Remove {target.localName}</Button></>}><p>The Keen project and all remote resources remain unchanged.</p></Modal> : null}
    </div>
  );
}
