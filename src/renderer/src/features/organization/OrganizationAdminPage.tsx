import { useMemo, useState } from 'react';
import { Building2, Edit3, Plus, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react';
import type { CredentialMeta } from '@shared/types';
import { Badge, Button, Callout, Card, CredentialSelect, EmptyState, ErrorPanel, Field, Input, Modal, PageHeader, ReadOnlyGate, Textarea } from '../../components/ui';
import { OrganizationClient } from '../../lib/api/OrganizationClient';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { redactUnknown } from '../../lib/security/redact';

const DEFAULT_CREATE = JSON.stringify({
  name: 'New Keen project',
  users: [],
  preferences: {}
}, null, 2);

export function OrganizationAdminPage(): JSX.Element {
  const { workspace, runtimeMode } = useWorkspaceContext();
  const { candidates, select } = useOperationCredentials('organization.manage');
  const [credentialId, setCredentialId] = useState(candidates[0]?.id ?? '');
  const [projects, setProjects] = useState<Array<Record<string, unknown>>>([]);
  const [detail, setDetail] = useState<Record<string, unknown>>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<'create' | 'update'>();
  const [editorJson, setEditorJson] = useState(DEFAULT_CREATE);
  const [editorError, setEditorError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const changesEnabled = runtimeMode === 'changes-enabled';
  const client = useMemo(() => workspace ? new OrganizationClient(workspace, runtimeMode) : undefined, [workspace, runtimeMode]);

  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before using Organization Admin." />;
  if (!workspace.organizationId) return <EmptyState icon={<Building2 size={30} />} title="Organization Admin is not configured" description="Add an Organization ID and a separately supplied Organization Key in Workspace Settings. A project Master Key cannot be used here." />;

  const credential = (): CredentialMeta => select(credentialId);
  const runRead = async (kind: 'list' | 'current') => {
    if (!client || !credentialId) return;
    setLoading(true); setError(undefined);
    try {
      if (kind === 'list') {
        const response = await client.listProjects(credential());
        const safe = redactUnknown(response.data) as Array<Record<string, unknown>>;
        setProjects(Array.isArray(safe) ? safe : []);
      } else {
        const response = await client.getProject(credential());
        const safe = redactUnknown(response.data) as Record<string, unknown>;
        setDetail(safe);
      }
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  };

  const openUpdate = async () => {
    if (!client || !credentialId) return;
    setLoading(true); setError(undefined);
    try {
      const response = await client.getProject(credential());
      const record = response.data;
      setEditorJson(JSON.stringify({
        ...(typeof record.name === 'string' ? { name: record.name } : {}),
        ...(Array.isArray(record.users) ? { users: record.users } : {}),
        ...(record.preferences && typeof record.preferences === 'object' ? { preferences: record.preferences } : {})
      }, null, 2));
      setEditor('update');
    } catch (caught) { setError(caught); }
    finally { setLoading(false); }
  };

  const submitEditor = async () => {
    if (!client || !editor || !credentialId) return;
    try {
      const body = JSON.parse(editorJson) as Record<string, unknown>;
      if (editor === 'create' && typeof body.name !== 'string') throw new Error('Project creation requires a name.');
      if ('users' in body && !Array.isArray(body.users)) throw new Error('users must be a complete JSON array.');
      const response = editor === 'create'
        ? await client.createProject(credential(), body)
        : await client.updateProject(credential(), workspace.projectId, body);
      setDetail(redactUnknown(response.data) as Record<string, unknown>);
      setEditor(undefined); setEditorError('');
      await runRead('list');
    } catch (caught) { setEditorError(caught instanceof Error ? caught.message : 'Organization project request failed.'); }
  };

  const deleteCurrent = async () => {
    if (!client || confirmation !== `DELETE PROJECT ${workspace.projectId}` || !credentialId) return;
    setError(undefined);
    try {
      await client.deleteProject(credential(), workspace.projectId);
      setDeleteOpen(false); setConfirmation(''); setProjects((items) => items.filter((item) => item.id !== workspace.projectId));
      setDetail({ status: 'deleted', id: workspace.projectId });
    } catch (caught) { setError(caught); }
  };

  return <>
    <PageHeader eyebrow="Optional Organization API" title="Organization Admin" description={<>Isolated Organization ID <code>{workspace.organizationId}</code>. This module never treats a project Master Key as an Organization Key and does not claim billing, profile, or SSO support.</>} actions={<Badge tone="warning">Organization credential boundary</Badge>} />
    <Callout tone="warning" title="Highly privileged and optional">Organization project responses may contain default project keys and user lists. This screen redacts API-key fields before rendering and never persists response bodies.</Callout>
    {error ? <ErrorPanel error={error} /> : null}
    <Card style={{ marginTop: 16 }}>
      <div className="card__header"><div><h2>Project inventory</h2><p>Reads run only after an explicit button press.</p></div><div className="row"><Button variant="secondary" onClick={() => void runRead('current')} loading={loading}><Search size={15} /> Get current</Button><Button variant="secondary" onClick={() => void runRead('list')} loading={loading}><RefreshCw size={15} /> List projects</Button></div></div>
      <div className="card__body stack">
        <CredentialSelect credentials={candidates} value={credentialId} onChange={setCredentialId} label="Organization Key" allowedTypes={['organization']} />
        {projects.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Project ID</th><th>Users</th><th>Preferences</th></tr></thead><tbody>{projects.map((project, index) => <tr key={String(project.id ?? index)}><td><strong>{String(project.name ?? 'Unnamed')}</strong></td><td className="mono">{String(project.id ?? '')}</td><td>{Array.isArray(project.users) ? project.users.length : '—'}</td><td><code>{JSON.stringify(project.preferences ?? {})}</code></td></tr>)}</tbody></table></div> : <EmptyState icon={<Building2 size={26} />} title="No inventory loaded" description="Press List projects. An empty response is shown only after the Organization API returns it." />}
        {detail ? <pre className="json-view">{JSON.stringify(detail, null, 2)}</pre> : null}
      </div>
    </Card>
    <Card style={{ marginTop: 16 }}>
      <div className="card__header"><div><h2>Project administration</h2><p>Create or update with API-shaped JSON. Unknown response fields are preserved only in memory.</p></div></div>
      <div className="card__body stack">
        <ReadOnlyGate enabled={changesEnabled}><div className="row"><Button onClick={() => { setEditorJson(DEFAULT_CREATE); setEditor('create'); }} disabled={!credentialId}><Plus size={15} /> Create project</Button><Button variant="secondary" onClick={() => void openUpdate()} disabled={!credentialId}><Edit3 size={15} /> Edit current project</Button><Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={!credentialId}><Trash2 size={15} /> Hard-delete current project</Button></div></ReadOnlyGate>
        <Callout tone="danger" title="Replacement-style user list">When updating <code>users</code>, Keen documents that the complete list of users to retain must be sent. Project deletion is a hard delete.</Callout>
      </div>
    </Card>
    {editor ? <Modal title={editor === 'create' ? 'Create organization project' : `Update project ${workspace.projectId}`} description="Only name, complete users, and preferences should be sent. API keys from read responses are never inserted." onClose={() => setEditor(undefined)} footer={<><Button variant="secondary" onClick={() => setEditor(undefined)}>Cancel</Button><Button onClick={() => void submitEditor()}>{editor === 'create' ? 'Create project' : 'Update project'}</Button></>}><Field label="Project JSON" error={editorError}><Textarea className="textarea--code" value={editorJson} onChange={(event) => { setEditorJson(event.target.value); setEditorError(''); }} spellCheck={false} /></Field></Modal> : null}
    {deleteOpen ? <Modal title="Hard-delete organization project" description="This is permanent and uses the Organization Key, not the project Master Key." onClose={() => { setDeleteOpen(false); setConfirmation(''); }} footer={<><Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" disabled={confirmation !== `DELETE PROJECT ${workspace.projectId}`} onClick={() => void deleteCurrent()}><ShieldAlert size={15} /> Delete permanently</Button></>}><div className="stack"><div className="danger-summary"><ShieldAlert size={22} /><div><strong>{workspace.localName}</strong><span>Project ID: {workspace.projectId}</span></div></div><Field label={`Type DELETE PROJECT ${workspace.projectId}`} required><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></Field></div></Modal> : null}
  </>;
}
