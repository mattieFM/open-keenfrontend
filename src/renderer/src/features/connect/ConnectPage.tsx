import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Database, Eye, KeyRound, LockKeyhole, Plus, Server, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import type { CredentialMeta, CredentialType, StorageMode, WorkspaceRecord } from '@shared/types';
import { normalizeBaseUrl } from '@shared/url';
import { Badge, Button, Callout, Card, Field, Input, Select } from '../../components/ui';
import { useWorkspaceStore } from '../../lib/db/workspaceStore';
import { maskSecret } from '../../lib/security/redact';
import { storeCredential } from '../../lib/vault/credentialVault';
import { KeenClient } from '../../lib/api/KeenClient';
import { db } from '../../lib/db/database';
import { buildAutomaticDashboards, syncAutomaticDashboards } from '../../lib/dashboard/autoDashboard';
import { demoCollections } from '../../lib/demo/fixtures';
import { parseCollectionList } from '../../lib/schema/collections';

const DEFAULT_ANALYTICS = 'https://api.keen.io/3.0';
const DEFAULT_DASHBOARD = 'https://dashboard-service.k-n.io';

type CredentialInput = { id: string; label: string; type: CredentialType; value: string };

function newCredential(type: CredentialType = 'read'): CredentialInput {
  const labels: Record<CredentialType, string> = { read: 'Read key', write: 'Write key', master: 'Master key', access: 'Restricted access key', organization: 'Organization key' };
  return { id: crypto.randomUUID(), label: labels[type], type, value: '' };
}

export function ConnectPage(): JSX.Element {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const updateWorkspace = useWorkspaceStore((state) => state.updateWorkspace);
  const setCapability = useWorkspaceStore((state) => state.setCapability);
  const [localName, setLocalName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [analyticsHost, setAnalyticsHost] = useState(DEFAULT_ANALYTICS);
  const [dashboardHost, setDashboardHost] = useState(DEFAULT_DASHBOARD);
  const [dashboardEnabled, setDashboardEnabled] = useState(false);
  const [organizationEnabled, setOrganizationEnabled] = useState(false);
  const [organizationId, setOrganizationId] = useState('');
  const [storageMode, setStorageMode] = useState<StorageMode>('memory');
  const [passphrase, setPassphrase] = useState('');
  const [credentials, setCredentials] = useState<CredentialInput[]>([newCredential('read')]);
  const [safeTest, setSafeTest] = useState(true);
  const [autoDashboards, setAutoDashboards] = useState(true);
  const [testCredentialId, setTestCredentialId] = useState(credentials[0]?.id ?? '');
  const [savedWorkspaceId, setSavedWorkspaceId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'danger'; message: string }>();
  const [errors, setErrors] = useState<string[]>([]);

  const schemaTestCandidates = useMemo(() => credentials.filter((item) => ['read', 'master', 'access'].includes(item.type) && item.value.trim()), [credentials]);
  const selectedTestCredential = schemaTestCandidates.find((item) => item.id === testCredentialId) ?? schemaTestCandidates[0];
  const canTestSchema = Boolean(selectedTestCredential);

  const updateCredential = (id: string, patch: Partial<CredentialInput>) => {
    setCredentials((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const validate = (): string[] => {
    const next: string[] = [];
    if (!localName.trim()) next.push('Workspace name is required.');
    if (!projectId.trim()) next.push('Project ID is required.');
    if (!credentials.some((credential) => credential.value.trim())) next.push('Add at least one Keen project key.');
    if (credentials.some((credential) => credential.value.trim() && !credential.label.trim())) next.push('Every supplied key needs a local label.');
    if (storageMode === 'encrypted' && passphrase.length < 10) next.push('Encrypted storage requires a passphrase of at least 10 characters.');
    try { normalizeBaseUrl(analyticsHost, 'analytics'); } catch (error) { next.push(error instanceof Error ? error.message : 'Invalid Analytics host.'); }
    if (dashboardEnabled) {
      try { normalizeBaseUrl(dashboardHost, 'dashboard'); } catch (error) { next.push(error instanceof Error ? error.message : 'Invalid Dashboard host.'); }
    }
    if (organizationEnabled && !organizationId.trim()) next.push('Organization ID is required when Organization Admin is enabled.');
    if (organizationEnabled && !credentials.some((credential) => credential.type === 'organization' && credential.value.trim())) next.push('Add a separately supplied Organization Key to enable Organization Admin.');
    return next;
  };

  const save = async () => {
    if (savedWorkspaceId) { navigate(`/w/${savedWorkspaceId}`); return; }
    const validationErrors = validate();
    setErrors(validationErrors);
    setResult(undefined);
    if (validationErrors.length) return;
    setSubmitting(true);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      const analyticsBaseUrl = normalizeBaseUrl(analyticsHost, 'analytics');
      const dashboardBaseUrl = dashboardEnabled ? normalizeBaseUrl(dashboardHost, 'dashboard') : undefined;
      await window.keenDesktop.approveHosts([analyticsBaseUrl, ...(dashboardBaseUrl ? [dashboardBaseUrl] : [])]);

      const populated = credentials.filter((credential) => credential.value.trim());
      const metadata: CredentialMeta[] = populated.map((credential) => ({
        id: credential.id,
        workspaceId: id,
        label: credential.label.trim(),
        type: credential.type,
        storageMode,
        hint: maskSecret(credential.value),
        createdAt: now
      }));

      const workspace: WorkspaceRecord = {
        id,
        localName: localName.trim(),
        projectId: projectId.trim(),
        analyticsBaseUrl,
        dashboardBaseUrl,
        dashboardServiceEnabled: dashboardEnabled,
        organizationId: organizationEnabled ? organizationId.trim() : undefined,
        credentials: metadata,
        capabilities: {},
        preferences: {
          defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          queryConcurrency: 4,
          includeSchemaOnStreamList: false,
          dashboardPersistence: 'local',
          autoDashboards,
          autoDashboardTimeframe: 'this_30_days',
          autoDashboardEventTypeProperty: 'eventType'
        },
        createdAt: now,
        updatedAt: now
      };

      for (const [index, credential] of populated.entries()) {
        await storeCredential(metadata[index], credential.value, storageMode, storageMode === 'encrypted' ? passphrase : undefined);
      }
      await createWorkspace(workspace);
      setSavedWorkspaceId(id);

      if (safeTest && canTestSchema) {
        const credentialIndex = populated.findIndex((item) => item.id === selectedTestCredential?.id);
        const testCredential = metadata[credentialIndex];
        if (!testCredential) throw new Error('The selected schema-test credential is no longer available.');
        try {
          const readOnlyClient = new KeenClient(workspace, 'read-only');
          await readOnlyClient.listCollections(testCredential, false);
          await setCapability(id, 'schema.read', 'allowed');
          let automaticMessage = '';
          if (autoDashboards) {
            try {
              const summary = await syncAutomaticDashboards({
                workspace,
                client: readOnlyClient,
                schemaCredential: testCredential,
                queryCredential: testCredential
              });
              const syncedAt = new Date().toISOString();
              await updateWorkspace(id, {
                preferences: { ...workspace.preferences, autoDashboardLastSync: syncedAt }
              });
              automaticMessage = ` ${summary.created} automatic dashboard${summary.created === 1 ? '' : 's'} were created from ${summary.streams} stream${summary.streams === 1 ? '' : 's'}, with ${summary.filterOptionSetsLoaded} live filter option set${summary.filterOptionSetsLoaded === 1 ? '' : 's'} loaded.`;
              if (summary.warnings.length) automaticMessage += ` ${summary.warnings.length} optional discovery warning${summary.warnings.length === 1 ? '' : 's'} can be reviewed from the Dashboards page.`;
            } catch (automaticError) {
              automaticMessage = ` The workspace is connected, but automatic dashboard setup could not finish: ${automaticError instanceof Error ? automaticError.message : String(automaticError)}`;
            }
          }
          setResult({ tone: 'success', message: `Workspace saved. The selected key was accepted for the read-only schema test.${automaticMessage}` });
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status === 403) await setCapability(id, 'schema.read', 'denied');
          setResult({ tone: 'warning', message: error instanceof Error ? error.message : 'Workspace saved, but the schema test did not complete.' });
        }
      } else {
        setResult({ tone: 'success', message: 'Workspace saved without making a network request.' });
      }
    } catch (error) {
      setResult({ tone: 'danger', message: error instanceof Error ? error.message : 'The workspace could not be saved.' });
    } finally {
      setSubmitting(false);
    }
  };

  const openDemo = async () => {
    setSubmitting(true);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const workspace: WorkspaceRecord = {
      id,
      localName: 'Keen product demo',
      projectId: 'synthetic-demo-project',
      analyticsBaseUrl: DEFAULT_ANALYTICS,
      dashboardBaseUrl: DEFAULT_DASHBOARD,
      dashboardServiceEnabled: false,
      credentials: [{ id: crypto.randomUUID(), workspaceId: id, label: 'Synthetic read key', type: 'read', storageMode: 'memory', hint: 'demo••••data', createdAt: now }],
      capabilities: { 'schema.read': 'allowed', 'query.run': 'allowed', 'saved.result.read': 'allowed', 'dataset.read': 'allowed' },
      preferences: { defaultTimezone: 'UTC', queryConcurrency: 4, includeSchemaOnStreamList: false, dashboardPersistence: 'local', autoDashboards: true, autoDashboardTimeframe: 'this_30_days', autoDashboardEventTypeProperty: 'eventType', autoDashboardLastSync: now },
      demo: true,
      createdAt: now,
      updatedAt: now
    };
    await createWorkspace(workspace);
    const demoDashboards = buildAutomaticDashboards(
      id,
      parseCollectionList(demoCollections),
      { slack_stream: ['session_start', 'session_end'] },
      {
        eventTypeProperty: 'eventType',
        timeframe: 'this_30_days',
        timezone: 'UTC',
        dimensionValues: {
          slack_stream: {
            'session.eventId': ['Builders Lab'],
            'session.machineId': ['tablet-01', 'tablet-02', 'tablet-03', 'tablet-04'],
            'session.gameId': ['word-grid', 'reaction-race', 'memory-match']
          }
        }
      }
    );
    await db.dashboards.bulkPut(demoDashboards);
    navigate(`/w/${id}/dashboards`);
  };

  return (
    <div className="connect-shell">
      <section className="connect-hero" aria-labelledby="connect-hero-title">
        <div className="connect-brand"><div className="brand-mark brand-mark--small">K</div><div><strong>Keen Key Console</strong><span>Project-key workspace</span></div></div>
        <div className="connect-hero__copy">
          <Badge tone="success"><LockKeyhole size={12} /> Read-only on every boot</Badge>
          <h1 id="connect-hero-title">Explore a Keen project without a Keen account session.</h1>
          <p>Connect directly with a Project ID and the keys supplied during a developer handoff. The console exposes only operations those keys can perform.</p>
          <div className="connect-points">
            <div className="connect-point"><CheckCircle2 size={18} /><span>Inspect streams, run analyses, extract data, and validate instrumentation.</span></div>
            <div className="connect-point"><CheckCircle2 size={18} /><span>Keep keys in memory by default or encrypt them with a local passphrase.</span></div>
            <div className="connect-point"><CheckCircle2 size={18} /><span>Remote writes and administration remain locked until explicitly enabled.</span></div>
          </div>
        </div>
        <div className="connect-hero__foot">Independent open-source software. No Keen login, billing, membership, or organization session is requested.</div>
      </section>

      <main className="connect-content">
        <div className="connect-content__inner">
          <div className="connect-title-row">
            <div><div className="eyebrow">Connect workspace</div><h1>Project credentials</h1><p>Keys are never inferred from their shape. Label each credential by the role provided to you.</p></div>
            <div className="row"><Button variant="secondary" onClick={openDemo} disabled={submitting}><Sparkles size={16} /> Demo</Button>{workspaces.length ? <Button variant="ghost" onClick={() => navigate('/workspaces')}>Workspaces ({workspaces.length})</Button> : null}</div>
          </div>

          <Callout tone="info" title="Safe startup behavior">The application always opens in read-only mode. The optional connection test performs only <code>GET /events?include_schema=false</code>.</Callout>

          <Card className="connection-card" style={{ marginTop: 16 }}>
            <section className="connection-section">
              <div className="connection-section__title"><span className="section-number">1</span><Server size={18} /><h2>Project and service hosts</h2></div>
              <div className="form-grid">
                <Field label="Workspace name on this device" required hint="A local alias; it is not fetched from Keen."><Input value={localName} onChange={(event) => setLocalName(event.target.value)} placeholder="Acme production analytics" autoFocus /></Field>
                <Field label="Keen Project ID" required><Input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="Enter the project ID" autoComplete="off" spellCheck={false} /></Field>
                <Field label="Analytics API host" hint="The default already includes /3.0."><Input value={analyticsHost} onChange={(event) => setAnalyticsHost(event.target.value)} spellCheck={false} /></Field>
                <Field label="Dashboard API host" hint="Source-observed and optional; local dashboards work without it."><Input value={dashboardHost} onChange={(event) => setDashboardHost(event.target.value)} disabled={!dashboardEnabled} spellCheck={false} /></Field>
              </div>
              <label className="checkbox-row" style={{ marginTop: 14 }}><input type="checkbox" checked={dashboardEnabled} onChange={(event) => setDashboardEnabled(event.target.checked)} /><span><strong>Enable Keen-compatible dashboard service</strong><br /><span className="muted small">Uses the separately configured source-observed dashboard adapter.</span></span></label>
              <label className="checkbox-row" style={{ marginTop: 10 }}><input type="checkbox" checked={organizationEnabled} onChange={(event) => setOrganizationEnabled(event.target.checked)} /><span><strong>Enable separate Organization Admin module</strong><br /><span className="muted small">Requires an Organization ID and Organization Key. A Master Key is never substituted.</span></span></label>
              {organizationEnabled ? <div style={{ marginTop: 12 }}><Field label="Organization ID" required hint="Used only by the isolated Organization API module."><Input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} placeholder="Enter the Organization ID" autoComplete="off" spellCheck={false} /></Field></div> : null}
            </section>

            <section className="connection-section">
              <div className="connection-section__title"><span className="section-number">2</span><KeyRound size={18} /><h2>Project keys</h2></div>
              <div className="stack stack--tight">
                {credentials.map((credential) => (
                  <div className="credential-row" key={credential.id}>
                    <Select value={credential.type} onChange={(event) => updateCredential(credential.id, { type: event.target.value as CredentialType })} aria-label="Credential type">
                      <option value="read">Read Key</option><option value="write">Write Key</option><option value="master">Master Key</option><option value="access">Restricted Access Key</option><option value="organization">Organization Key</option>
                    </Select>
                    <Input value={credential.value} type="password" onChange={(event) => updateCredential(credential.id, { value: event.target.value })} placeholder="Paste key" autoComplete="new-password" spellCheck={false} aria-label="Credential value" />
                    <Input value={credential.label} onChange={(event) => updateCredential(credential.id, { label: event.target.value })} placeholder="Local label" aria-label="Credential label" />
                    <Button className="credential-row__remove" variant="ghost" onClick={() => setCredentials((items) => items.filter((item) => item.id !== credential.id))} disabled={credentials.length === 1} aria-label="Remove credential"><Trash2 size={16} /></Button>
                  </div>
                ))}
              </div>
              <Button variant="secondary" onClick={() => setCredentials((items) => [...items, newCredential('access')])} style={{ marginTop: 11 }}><Plus size={15} /> Add another key</Button>
            </section>

            <section className="connection-section">
              <div className="connection-section__title"><span className="section-number">3</span><ShieldCheck size={18} /><h2>Credential storage</h2></div>
              <div className="storage-options">
                <label className="storage-option"><input type="radio" name="storage" checked={storageMode === 'memory'} onChange={() => setStorageMode('memory')} /><strong>Memory only</strong><span>Recommended. Keys disappear when the application closes or workspace locks.</span></label>
                <label className="storage-option"><input type="radio" name="storage" checked={storageMode === 'session'} onChange={() => setStorageMode('session')} /><strong>App session</strong><span>Kept only in process memory for this running application session.</span></label>
                <label className="storage-option"><input type="radio" name="storage" checked={storageMode === 'encrypted'} onChange={() => setStorageMode('encrypted')} /><strong>Encrypted on device</strong><span>AES-256-GCM in IndexedDB, protected by your passphrase.</span></label>
              </div>
              {storageMode === 'encrypted' ? <div style={{ marginTop: 14 }}><Field label="Vault passphrase" required hint="The passphrase and derived key are never stored."><Input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" /></Field></div> : null}
            </section>

            <section className="connection-section">
              <div className="connection-section__title"><span className="section-number">4</span><Eye size={18} /><h2>Connection test</h2></div>
              <label className="checkbox-row"><input type="checkbox" checked={safeTest} disabled={!canTestSchema} onChange={(event) => setSafeTest(event.target.checked)} /><span><strong>Test read-only schema access after saving</strong><br /><span className="muted small">No query, write, key-management, or mutation endpoint is probed.</span></span></label>
              <label className="checkbox-row" style={{ marginTop: 10 }}><input type="checkbox" checked={autoDashboards} disabled={!canTestSchema || !safeTest} onChange={(event) => setAutoDashboards(event.target.checked)} /><span><strong>Create dashboards automatically for every stream</strong><br /><span className="muted small">After the safe test succeeds, the app reads schemas and may run bounded <code>select_unique</code> analyses to discover event types. Matching session streams receive dedicated start, end, status, duration, game, machine, event, result, and conversion views.</span></span></label>
              {canTestSchema ? <div style={{ marginTop: 12 }}><Field label="Credential used for the safe test" hint="The app will not silently retry with a broader key if this credential is denied."><Select value={selectedTestCredential?.id ?? ''} onChange={(event) => setTestCredentialId(event.target.value)}>{schemaTestCandidates.map((credential) => <option key={credential.id} value={credential.id}>{credential.label} · {credential.type}</option>)}</Select></Field></div> : <Callout tone="warning">Add a Read, restricted Access, or Master key to enable the optional schema test. A Write-only workspace can still be saved without it.</Callout>}
            </section>

            <section className="connection-section">
              {errors.length ? <Callout tone="danger" title="Check these fields"><ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((error) => <li key={error}>{error}</li>)}</ul></Callout> : null}
              {result ? <Callout tone={result.tone} title={result.tone === 'success' ? 'Connected' : 'Connection result'}>{result.message}</Callout> : null}
              <div className="form-actions"><Button onClick={save} loading={submitting}><Database size={16} /> {savedWorkspaceId ? 'Open saved workspace' : safeTest && canTestSchema ? 'Save workspace and test schema access' : 'Save workspace without test'}</Button></div>
            </section>
          </Card>
        </div>
      </main>
    </div>
  );
}
