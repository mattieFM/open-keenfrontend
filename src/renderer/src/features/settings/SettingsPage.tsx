import { useState } from 'react';
import { Download, KeyRound, Plus, Save, Server, ShieldCheck, Sparkles, Trash2, UnlockKeyhole } from 'lucide-react';
import type { CredentialMeta, CredentialType, StorageMode } from '@shared/types';
import { normalizeBaseUrl } from '@shared/url';
import { Badge, Button, Callout, Card, EmptyState, ErrorPanel, Field, IconButton, Input, Modal, PageHeader, Select } from '../../components/ui';
import { useWorkspaceContext } from '../../lib/api/useWorkspace';
import { useWorkspaceStore } from '../../lib/db/workspaceStore';
import { deleteCredential, hasCredential, lockWorkspace, storeCredential, unlockCredential } from '../../lib/vault/credentialVault';
import { maskSecret } from '../../lib/security/redact';
import { cancelWorkspaceRequests } from '../../lib/api/requestScheduler';
import { clearSecretBoundQueryState } from '../../lib/query/queryClient';

export function SettingsPage(): JSX.Element {
  const { workspace, client } = useWorkspaceContext();
  const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const setCapability = useWorkspaceStore((state) => state.setCapability);
  const [analyticsHost, setAnalyticsHost] = useState(workspace?.analyticsBaseUrl ?? '');
  const [dashboardHost, setDashboardHost] = useState(workspace?.dashboardBaseUrl ?? 'https://dashboard-service.k-n.io');
  const [dashboardEnabled, setDashboardEnabled] = useState(workspace?.dashboardServiceEnabled ?? false);
  const [dashboardPersistence, setDashboardPersistence] = useState(workspace?.preferences.dashboardPersistence ?? 'local');
  const [organizationId, setOrganizationId] = useState(workspace?.organizationId ?? '');
  const [timezone, setTimezone] = useState(workspace?.preferences.defaultTimezone ?? 'UTC');
  const [concurrency, setConcurrency] = useState(workspace?.preferences.queryConcurrency ?? 4);
  const [autoDashboards, setAutoDashboards] = useState(workspace?.preferences.autoDashboards ?? true);
  const [autoDashboardTimeframe, setAutoDashboardTimeframe] = useState(workspace?.preferences.autoDashboardTimeframe ?? 'this_30_days');
  const [autoDashboardEventTypeProperty, setAutoDashboardEventTypeProperty] = useState(workspace?.preferences.autoDashboardEventTypeProperty ?? 'eventType');
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState('');
  const [credentialEditor, setCredentialEditor] = useState<CredentialMeta | 'new'>();
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');

  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before changing local settings." />;

  const save = async () => {
    setError(undefined); setStatus('');
    try {
      const analyticsBaseUrl = normalizeBaseUrl(analyticsHost, 'analytics');
      const dashboardBaseUrl = dashboardEnabled ? normalizeBaseUrl(dashboardHost, 'dashboard') : undefined;
      await window.keenDesktop.approveHosts([analyticsBaseUrl, ...(dashboardBaseUrl ? [dashboardBaseUrl] : [])]);
      await updateWorkspace(workspace.id, {
        analyticsBaseUrl,
        dashboardBaseUrl,
        dashboardServiceEnabled: dashboardEnabled,
        organizationId: organizationId.trim() || undefined,
        preferences: {
          ...workspace.preferences,
          defaultTimezone: timezone,
          queryConcurrency: Math.max(1, Math.min(10, concurrency)),
          dashboardPersistence,
          autoDashboards,
          autoDashboardTimeframe: autoDashboardTimeframe.trim() || 'this_30_days',
          autoDashboardEventTypeProperty: autoDashboardEventTypeProperty.trim() || 'eventType'
        }
      });
      setStatus('Workspace settings saved. Host changes were explicitly approved for this app session.');
    } catch (caught) { setError(caught); }
  };
  const testSchema = async () => {
    const credential = workspace.credentials.find((item) => ['read', 'access', 'master'].includes(item.type));
    if (!client || !credential) { setError(new Error('Configure a Read, Access, or Master key.')); return; }
    try { await client.listCollections(credential, false); await setCapability(workspace.id, 'schema.read', 'allowed'); setStatus(`“${credential.label}” was accepted for the read-only schema test.`); } catch (caught) { if ((caught as { status?: number }).status === 403) await setCapability(workspace.id, 'schema.read', 'denied'); setError(caught); }
  };
  const testMaster = async () => {
    const credential = workspace.credentials.find((item) => item.type === 'master');
    if (!client || !credential) { setError(new Error('Configure a Master Key first.')); return; }
    try { await client.listAccessKeys(credential, '', 1); await setCapability(workspace.id, 'accessKey.manage', 'allowed'); setStatus(`“${credential.label}” was accepted by the explicit Master capability test.`); } catch (caught) { if ((caught as { status?: number }).status === 403) await setCapability(workspace.id, 'accessKey.manage', 'denied'); setError(caught); }
  };
  const unlock = async () => {
    setError(undefined);
    try { const encrypted = workspace.credentials.filter((item) => item.storageMode === 'encrypted'); await Promise.all(encrypted.map((item) => unlockCredential(item.id, passphrase))); setUnlockOpen(false); setPassphrase(''); setStatus(`${encrypted.length} encrypted credential(s) unlocked in memory.`); } catch (caught) { setError(caught); }
  };
  const removeCredential = async (credential: CredentialMeta) => {
    if (!confirm(`Remove credential label “${credential.label}” and its encrypted record from this device?`)) return;
    await deleteCredential(credential.id); await updateWorkspace(workspace.id, { credentials: workspace.credentials.filter((item) => item.id !== credential.id) });
  };
  const removeWorkspace = async () => {
    if (!confirm(`Delete local workspace “${workspace.localName}”? This removes local drafts, dashboards, and encrypted key records, but does not change Keen.`)) return;
    cancelWorkspaceRequests(workspace.id);
    clearSecretBoundQueryState();
    lockWorkspace(workspace.id, workspace.credentials);
    await deleteWorkspace(workspace.id);
    location.hash = '#/connect';
  };
  const exportSafe = () => window.keenDesktop.saveText({ suggestedName: `${workspace.localName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.workspace.json`, content: JSON.stringify({ ...workspace, credentials: workspace.credentials.map(({ id: _id, workspaceId: _workspaceId, ...meta }) => ({ ...meta, secret: '<excluded>' })) }, null, 2) });

  return <><PageHeader eyebrow="Workspace settings" title={workspace.localName} description="Manage local hosts, preferences, credential references, vault unlock, capability tests, and secret-free export." actions={<Button onClick={save}><Save size={15} /> Save settings</Button>} />
    {status ? <Callout tone="success">{status}</Callout> : null}{error ? <ErrorPanel error={error} /> : null}
    <div className="settings-grid"><Card><div className="card__header"><div><h2>Service hosts</h2><p>Imported/custom hosts require explicit approval before the main process permits requests.</p></div><Server size={19} /></div><div className="card__body stack"><Field label="Analytics API"><Input value={analyticsHost} onChange={(event) => setAnalyticsHost(event.target.value)} /></Field><label className="checkbox-row"><input type="checkbox" checked={dashboardEnabled} onChange={(event) => setDashboardEnabled(event.target.checked)} /><span>Enable source-observed dashboard service</span></label><Field label="Dashboard API"><Input value={dashboardHost} disabled={!dashboardEnabled} onChange={(event) => setDashboardHost(event.target.value)} /></Field><Field label="Organization ID (optional)" hint="Requires a separately configured Organization Key."><Input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} /></Field><Field label="Dashboard persistence"><Select value={dashboardPersistence} onChange={(event) => setDashboardPersistence(event.target.value as typeof dashboardPersistence)}><option value="local">Local only</option><option value="keen-service">Keen service</option><option value="hybrid">Hybrid recovery + publish</option></Select></Field><Callout tone="warning">The dashboard host does not receive an appended <code>/3.0</code>. Local dashboard mode remains available if CORS or compatibility fails.</Callout></div></Card>
      <Card><div className="card__header"><div><h2>Query and automatic dashboards</h2><p>Local controls are not billing usage counters.</p></div><Sparkles size={19} /></div><div className="card__body stack"><Field label="Default timezone"><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></Field><Field label="Conservative query concurrency (1–10)"><Input type="number" min="1" max="10" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} /></Field><label className="checkbox-row"><input type="checkbox" checked={workspace.preferences.includeSchemaOnStreamList} onChange={(event) => void updateWorkspace(workspace.id, { preferences: { ...workspace.preferences, includeSchemaOnStreamList: event.target.checked } })} /><span>Load full schema on stream list by default</span></label><hr className="separator" /><label className="checkbox-row"><input type="checkbox" checked={autoDashboards} onChange={(event) => setAutoDashboards(event.target.checked)} /><span><strong>Create and maintain local dashboards for every stream</strong><br /><span className="muted small">The dashboard page reads schemas and creates guided stream and event-type views without changing Keen data.</span></span></label><Field label="Automatic dashboard timeframe" hint="A Keen relative timeframe such as this_30_days or previous_12_weeks."><Input value={autoDashboardTimeframe} disabled={!autoDashboards} onChange={(event) => setAutoDashboardTimeframe(event.target.value)} /></Field><Field label="Event type field" hint="Streams containing this field receive one dashboard per discovered event type."><Input value={autoDashboardEventTypeProperty} disabled={!autoDashboards} onChange={(event) => setAutoDashboardEventTypeProperty(event.target.value)} placeholder="eventType" /></Field>{workspace.preferences.autoDashboardLastSync ? <p className="muted small">Last automatic dashboard sync: {new Date(workspace.preferences.autoDashboardLastSync).toLocaleString()}</p> : <Callout tone="info">Automatic dashboards will be generated after a successful connect-time setup or when the Dashboards page opens with a schema-capable key.</Callout>}</div></Card>
    </div>
    <Card style={{ marginTop: 16 }}><div className="card__header"><div><h2>Credential vault</h2><p>Keys are masked, never inferred by shape, and stored unencrypted on the local filesystem by default.</p></div><div className="row"><Button variant="secondary" onClick={() => setUnlockOpen(true)}><UnlockKeyhole size={15} /> Unlock encrypted</Button><Button onClick={() => setCredentialEditor('new')}><Plus size={15} /> Add key</Button></div></div><div className="card__body stack"><div className="table-wrap"><table><thead><tr><th>Label</th><th>Declared type</th><th>Hint</th><th>Storage</th><th>Current memory</th><th>Actions</th></tr></thead><tbody>{workspace.credentials.map((credential) => <tr key={credential.id}><td><strong>{credential.label}</strong></td><td><Badge tone={credential.type === 'master' ? 'danger' : credential.type === 'write' ? 'warning' : 'purple'}>{credential.type}</Badge></td><td className="mono">{credential.hint}</td><td>{credential.storageMode}</td><td><Badge tone={hasCredential(credential.id) ? 'success' : 'warning'}>{hasCredential(credential.id) ? 'Unlocked' : 'Locked / missing'}</Badge></td><td><div className="table-actions"><IconButton label="Re-enter credential" onClick={() => setCredentialEditor(credential)}><KeyRound size={15} /></IconButton><IconButton label="Remove credential" onClick={() => void removeCredential(credential)}><Trash2 size={15} /></IconButton></div></td></tr>)}</tbody></table></div><div className="form-grid"><Button variant="secondary" onClick={testSchema}><ShieldCheck size={15} /> Safe schema test</Button><Button variant="secondary" onClick={testMaster}><ShieldCheck size={15} /> Explicit Master test</Button></div><Callout tone="info">The Master test calls only <code>GET /keys?per_page=1</code> after you explicitly press it. No write or mutation capability is probed.</Callout></div></Card>
    <Card style={{ marginTop: 16 }}><div className="card__header"><div><h2>Local data</h2><p>Workspace export excludes all credential values by default.</p></div></div><div className="card__body row"><Button variant="secondary" onClick={exportSafe}><Download size={15} /> Export without secrets</Button><Button variant="danger" onClick={removeWorkspace}><Trash2 size={15} /> Delete local workspace</Button></div></Card>
    {credentialEditor ? <CredentialEditor existing={credentialEditor === 'new' ? undefined : credentialEditor} onClose={() => setCredentialEditor(undefined)} onSaved={() => { setCredentialEditor(undefined); setStatus('Credential stored and available in memory.'); }} /> : null}
    {unlockOpen ? <Modal title="Unlock encrypted credentials" description="The passphrase-derived key is used only in memory and is not persisted." onClose={() => setUnlockOpen(false)} footer={<><Button variant="secondary" onClick={() => setUnlockOpen(false)}>Cancel</Button><Button onClick={unlock}><UnlockKeyhole size={15} /> Unlock</Button></>}><Field label="Vault passphrase"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoFocus /></Field></Modal> : null}
  </>;
}

function CredentialEditor({ existing, onClose, onSaved }: { existing?: CredentialMeta; onClose(): void; onSaved(): void }): JSX.Element {
  const { workspace } = useWorkspaceContext(); const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace);
  const [label, setLabel] = useState(existing?.label ?? 'Restricted access key'); const [type, setType] = useState<CredentialType>(existing?.type ?? 'access'); const [value, setValue] = useState(''); const [mode, setMode] = useState<StorageMode>(existing?.storageMode ?? 'plaintext'); const [passphrase, setPassphrase] = useState(''); const [error, setError] = useState('');
  const save = async () => {
    if (!workspace) return;
    try {
      const meta: CredentialMeta = existing ? { ...existing, label: label.trim(), type, storageMode: mode, hint: maskSecret(value || existing.hint) } : { id: crypto.randomUUID(), workspaceId: workspace.id, label: label.trim(), type, storageMode: mode, hint: maskSecret(value), createdAt: new Date().toISOString() };
      if (!value) throw new Error('Paste the credential value. Existing plaintext cannot be recovered from its hint.');
      await storeCredential(meta, value, mode, mode === 'encrypted' ? passphrase : undefined);
      await updateWorkspace(workspace.id, { credentials: existing ? workspace.credentials.map((item) => item.id === existing.id ? meta : item) : [...workspace.credentials, meta] }); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  return <Modal title={existing ? 'Re-enter credential' : 'Add credential'} description="The declared type controls least-privilege routing; it is not inferred from the secret string." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Store credential</Button></>}><div className="stack"><div className="form-grid"><Field label="Local label"><Input value={label} onChange={(event) => setLabel(event.target.value)} /></Field><Field label="Declared type"><Select value={type} onChange={(event) => setType(event.target.value as CredentialType)}><option value="read">Read Key</option><option value="write">Write Key</option><option value="master">Master Key</option><option value="access">Restricted Access Key</option><option value="organization">Organization Key</option></Select></Field></div><Field label="Credential value"><Input type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="new-password" /></Field><Field label="Storage mode"><Select value={mode} onChange={(event) => setMode(event.target.value as StorageMode)}><option value="memory">Memory only</option><option value="session">App session memory</option><option value="plaintext">Persistent (unencrypted)</option><option value="encrypted">Encrypted IndexedDB</option></Select></Field>{mode === 'encrypted' ? <Field label="Passphrase (10+ characters)"><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></Field> : null}{error ? <Callout tone="danger">{error}</Callout> : null}</div></Modal>;
}
