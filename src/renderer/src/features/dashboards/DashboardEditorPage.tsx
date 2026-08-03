import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CloudUpload,
  Copy,
  Eye,
  Filter,
  Image,
  KeyRound,
  LayoutDashboard,
  Palette,
  Share2,
  ShieldOff,
  Sparkles,
  Text,
  Undo2
} from 'lucide-react';
import type { CredentialMeta, DashboardDocument, DashboardWidget, KeenFilter } from '@shared/types';
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
  Modal,
  PageHeader,
  ReadOnlyGate
} from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { db } from '../../lib/db/database';
import {
  addWidget,
  cloneWidget,
  createDashboard,
  defaultWidget,
  migrateDashboard,
  removeWidget,
  touch,
  updateWidget
} from '../../lib/dashboard/model';
import { analyzePublicDashboardAccess, buildPublicDashboardAccessPolicy } from '../../lib/dashboard/sharing';
import { autoDashboardMetadata } from '../../lib/dashboard/autoDashboard';
import { FilterBuilder } from '../explorer/FilterBuilder';
import { DashboardCanvas, type DashboardChartExecutor } from './DashboardCanvas';
import { DashboardSettingsModal } from './DashboardSettingsModal';
import { WidgetEditorModal } from './WidgetEditorModal';
import type { KeenDashboardMetadata } from '../../lib/api/DashboardServiceClient';

export function DashboardEditorPage(): JSX.Element {
  const { dashboardId } = useParams();
  const { workspace, workspaceId, client, dashboardClient, runtimeMode } = useWorkspaceContext();
  const queryCredentials = useOperationCredentials('query.run').candidates;
  const dashboardReadCredentials = useOperationCredentials('dashboard.read').candidates;
  const dashboardWriteCredentials = useOperationCredentials('dashboard.manage').candidates;
  const accessKeyCredentials = useOperationCredentials('accessKey.manage').candidates;
  const [document, setDocument] = useState<DashboardDocument>();
  const [history, setHistory] = useState<DashboardDocument[]>([]);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget>();
  const [credentialId, setCredentialId] = useState(queryCredentials[0]?.id ?? '');
  const [writeCredentialId, setWriteCredentialId] = useState(dashboardWriteCredentials[0]?.id ?? '');
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'saving' | 'failed'>('loading');
  const [error, setError] = useState<unknown>();
  const [shareOpen, setShareOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    if (!workspaceId || !dashboardId) return;
    let active = true;
    void (async () => {
      let loaded = await db.dashboards.get(dashboardId);
      if (loaded?.metadata.remoteOnly && workspace?.dashboardServiceEnabled && dashboardClient && dashboardReadCredentials[0]) {
        try {
          loaded = migrateDashboard((await dashboardClient.get(dashboardId, dashboardReadCredentials[0])).data, workspaceId);
          await db.dashboards.put(loaded);
        } catch (caught) {
          setError(caught);
        }
      }
      if (!loaded) loaded = createDashboard(workspaceId);
      if (active) {
        setDocument(loaded);
        setSaveState('saved');
      }
    })();
    return () => { active = false; };
  }, [workspaceId, dashboardId, workspace?.dashboardServiceEnabled]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const change = useCallback((next: DashboardDocument) => {
    if (!document) return;
    setHistory((items) => [...items.slice(-29), document]);
    setDocument(next);
    setSaveState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void db.dashboards.put(next)
        .then(() => setSaveState('saved'))
        .catch((caught) => {
          setError(caught);
          setSaveState('failed');
        });
    }, 900);
  }, [document]);

  const add = (type: DashboardWidget['type']) => {
    if (!document || !workspace) return;
    const widget = defaultWidget(type);
    const automatic = autoDashboardMetadata(document);
    if (automatic && widget.type === 'chart' && widget.source.kind === 'ad-hoc') {
      widget.source.query.event_collection = automatic.collection;
      widget.source.query.timeframe = workspace.preferences.autoDashboardTimeframe || 'this_30_days';
      if (automatic.eventType) {
        widget.source.query.filters = [{
          property_name: automatic.eventTypeProperty,
          operator: 'eq',
          property_value: automatic.eventType
        }];
      }
    } else if (automatic && widget.type === 'filter') {
      widget.eventCollection = automatic.collection;
    } else if (widget.type === 'date-range') {
      widget.timeframe = workspace.preferences.autoDashboardTimeframe || 'this_30_days';
      widget.timezone = workspace.preferences.defaultTimezone || 'UTC';
    }
    change(addWidget(document, widget));
    setEditingWidget(widget);
  };

  const executeChart = useCallback<DashboardChartExecutor>(async (widget, runtime, credential) => {
    if (!client || !credential) throw new Error('No query-capable credential is selected.');
    return widget.source.kind === 'saved'
      ? client.getSavedQueryResult(credential, widget.source.name)
      : client.runQuery(credential, runtime ?? widget.source.query);
  }, [client]);

  const publishRemote = async () => {
    if (!document || !dashboardClient) return;
    const credential = dashboardWriteCredentials.find((item) => item.id === writeCredentialId);
    if (!credential) {
      setError(new Error('Select a Master Key for dashboard persistence.'));
      return;
    }
    setSaveState('saving');
    setError(undefined);
    try {
      await db.dashboards.put(document);
      await dashboardClient.put(document, metadata(document), credential);
      const next = touch({
        ...document,
        metadata: { ...document.metadata, remoteSyncedAt: new Date().toISOString() }
      });
      await db.dashboards.put(next);
      setDocument(next);
      setSaveState('saved');
    } catch (caught) {
      setError(caught);
      setSaveState('failed');
    }
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setDocument(previous);
    void db.dashboards.put(previous);
  };

  if (!workspace || !workspaceId || !document) {
    return <EmptyState title={saveState === 'loading' ? 'Opening dashboard…' : 'Dashboard not found'} description="The dashboard record could not be loaded." />;
  }

  const selectedCredential = queryCredentials.find((item) => item.id === credentialId);
  const automatic = autoDashboardMetadata(document);

  return <>
    <PageHeader
      eyebrow="Dashboard editor"
      title={document.title}
      description="Build and tune the entire dashboard through guided controls. Drag and resize widgets, or use the keyboard controls. Local autosave remains available in read-only mode."
      actions={<>
        <Button variant="secondary" onClick={() => navigate(`/w/${workspaceId}/dashboards`)}><ArrowLeft size={15} /> Dashboards</Button>
        <Button variant="secondary" onClick={() => navigate(`/w/${workspaceId}/dashboards/${document.id}/view`)}><Eye size={15} /> Preview</Button>
        <Button variant="secondary" disabled={!history.length} onClick={undo}><Undo2 size={15} /> Undo</Button>
        <Badge tone={saveState === 'saved' ? 'success' : saveState === 'failed' ? 'danger' : 'warning'}>{saveState === 'saved' ? 'Saved locally' : saveState === 'saving' ? 'Saving…' : saveState}</Badge>
        <Button variant="secondary" onClick={() => setAppearanceOpen(true)}><Palette size={15} /> Appearance</Button>
        <Button variant="secondary" onClick={() => setShareOpen(true)}><Share2 size={15} /> Share</Button>
        {workspace.dashboardServiceEnabled ? <Button onClick={publishRemote} disabled={runtimeMode !== 'changes-enabled' || !writeCredentialId}><CloudUpload size={15} /> Publish remote</Button> : null}
      </>}
    />

    {automatic ? <Callout tone="info" title="Automatically generated dashboard">
      <span className="inline-icon"><Sparkles size={15} /> This dashboard was created from <strong>{automatic.collection}</strong>{automatic.eventType ? <> for <strong>{automatic.eventType}</strong></> : null}. Editing it is safe and local. Use <strong>Refresh automatic</strong> on the dashboard list only when you intentionally want to rebuild it from the current stream schema.</span>
    </Callout> : null}

    <Card className="dashboard-editor-toolbar">
      <div className="card__body">
        <div className="row dashboard-toolbar-row">
          <div className="widget-add-buttons" aria-label="Add dashboard widget">
            <Button variant="secondary" onClick={() => add('chart')}><LayoutDashboard size={15} /> Chart</Button>
            <Button variant="secondary" onClick={() => add('text')}><Text size={15} /> Text</Button>
            <Button variant="secondary" onClick={() => add('image')}><Image size={15} /> Image</Button>
            <Button variant="secondary" onClick={() => add('filter')}><Filter size={15} /> String filter</Button>
            <Button variant="secondary" onClick={() => add('date-range')}><CalendarDays size={15} /> Date range</Button>
          </div>
          <div className="dashboard-title-fields">
            <Field label="Dashboard title"><Input value={document.title} onChange={(event) => change(touch({ ...document, title: event.target.value }))} /></Field>
            <Field label="Tags" hint="Separate tags with commas"><Input value={document.tags.join(', ')} onChange={(event) => change(touch({ ...document, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) }))} /></Field>
            <CredentialSelect credentials={queryCredentials} value={credentialId} onChange={setCredentialId} label="Preview key" />
          </div>
        </div>
      </div>
    </Card>

    {workspace.dashboardServiceEnabled ? <Card className="remote-publish-strip">
      <div className="card__body form-grid">
        <CredentialSelect credentials={dashboardWriteCredentials} value={writeCredentialId} onChange={setWriteCredentialId} label="Master key for remote publish" />
        <ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}>
          <Callout tone="warning" title="Source-observed compatibility">Remote dashboard routes and metadata headers are isolated and require a disposable-project contract test. Local recovery is never blocked.</Callout>
        </ReadOnlyGate>
      </div>
    </Card> : null}

    {error ? <ErrorPanel error={error} /> : null}

    <DashboardCanvas
      document={document}
      editable
      credential={selectedCredential}
      executeChart={executeChart}
      onChange={change}
      onEditWidget={setEditingWidget}
      onCloneWidget={(id) => change(cloneWidget(document, id))}
      onRemoveWidget={(id) => change(removeWidget(document, id))}
    />

    {editingWidget ? <WidgetEditorModal
      document={document}
      widget={editingWidget}
      onClose={() => setEditingWidget(undefined)}
      onSave={(widget) => {
        change(updateWidget(document, widget));
        setEditingWidget(undefined);
      }}
    /> : null}

    {appearanceOpen ? <DashboardSettingsModal
      document={document}
      onClose={() => setAppearanceOpen(false)}
      onSave={(next) => change(touch(next))}
    /> : null}

    {shareOpen ? <ShareModal
      document={document}
      projectId={workspace.projectId}
      runtimeMode={runtimeMode}
      masterCredentials={accessKeyCredentials}
      client={client}
      dashboardServiceEnabled={workspace.dashboardServiceEnabled}
      defaultPublicHosts={workspace.analyticsBaseUrl.replace(/\/+$/, '') === 'https://api.keen.io/3.0' && (workspace.dashboardBaseUrl ?? 'https://dashboard-service.k-n.io').replace(/\/+$/, '') === 'https://dashboard-service.k-n.io'}
      onClose={() => setShareOpen(false)}
    /> : null}
  </>;
}

function metadata(document: DashboardDocument): KeenDashboardMetadata {
  const existing = document.metadata as Partial<KeenDashboardMetadata>;
  return {
    ...existing,
    id: document.id,
    title: document.title,
    widgets: document.widgets.length,
    queries: document.widgets.filter((widget) => widget.type === 'chart').length,
    tags: document.tags,
    lastModificationDate: Date.now(),
    isPublic: Boolean(existing.isPublic),
    publicAccessKey: typeof existing.publicAccessKey === 'string' ? existing.publicAccessKey : null
  };
}

function normalizeViewerBase(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    const localDevelopment = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !localDevelopment) return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character);
}

function ShareModal({
  document,
  projectId,
  runtimeMode,
  masterCredentials,
  client,
  dashboardServiceEnabled,
  defaultPublicHosts,
  onClose
}: {
  document: DashboardDocument;
  projectId: string;
  runtimeMode: 'read-only' | 'changes-enabled';
  masterCredentials: CredentialMeta[];
  client?: NonNullable<ReturnType<typeof useWorkspaceContext>['client']>;
  dashboardServiceEnabled: boolean;
  defaultPublicHosts: boolean;
  onClose(): void;
}): JSX.Element {
  const accessAnalysis = analyzePublicDashboardAccess(document);
  const { savedNames, adHocChartCount: adHocCount } = accessAnalysis;
  const [credentialId, setCredentialId] = useState(masterCredentials[0]?.id ?? '');
  const [keyName, setKeyName] = useState(`dashboard-${document.id}`.slice(0, 256));
  const [mandatoryFilters, setMandatoryFilters] = useState<KeenFilter[]>([]);
  const [generatedKey, setGeneratedKey] = useState('');
  const [viewerBase, setViewerBase] = useState(['http:', 'https:'].includes(window.location.protocol) ? `${window.location.origin}${window.location.pathname}` : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedMaster = masterCredentials.find((credential) => credential.id === credentialId);

  const knownFilterProperties = useMemo(() => {
    const values = new Set<string>();
    for (const widget of document.widgets) {
      if (widget.type !== 'chart' || widget.source.kind !== 'ad-hoc') continue;
      if (widget.source.query.target_property) values.add(widget.source.query.target_property);
      const groups = Array.isArray(widget.source.query.group_by) ? widget.source.query.group_by : [widget.source.query.group_by];
      groups.filter((value): value is string => typeof value === 'string').forEach((value) => values.add(value));
      for (const candidate of widget.source.query.filters ?? []) {
        if ('property_name' in candidate && typeof candidate.property_name === 'string') values.add(candidate.property_name);
      }
    }
    return [...values].sort();
  }, [document.widgets]);

  const buildPolicy = (): Record<string, unknown> => buildPublicDashboardAccessPolicy({
    document,
    name: keyName,
    mandatoryFilters: adHocCount ? mandatoryFilters : undefined
  });

  let policyPreview: Record<string, unknown> | undefined;
  try {
    policyPreview = buildPolicy();
  } catch {
    // Incomplete restrictions are described by the visual form and on submit.
  }
  const permitted = Array.isArray(policyPreview?.permitted) ? policyPreview.permitted.filter((value): value is string => typeof value === 'string') : [];

  const provision = async () => {
    setError('');
    if (runtimeMode !== 'changes-enabled') {
      setError('Enable remote changes from the workspace header before creating an Access Key.');
      return;
    }
    if (!defaultPublicHosts) {
      setError('The bundled public viewer is restricted to Keen’s default Analytics and Dashboard hosts. Configure and deploy a custom-host viewer before provisioning a public key.');
      return;
    }
    if (!normalizeViewerBase(viewerBase)) {
      setError('Enter a valid HTTPS public-viewer deployment URL before creating a key. Localhost HTTP is accepted only for development.');
      return;
    }
    if (!client || !selectedMaster) {
      setError('Select a Master Key.');
      return;
    }
    if (!keyName.trim() || keyName.length > 256) {
      setError('Key name is required and must not exceed 256 characters.');
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = buildPolicy();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid public-key policy.');
      return;
    }
    setBusy(true);
    try {
      const response = await client.createAccessKey(selectedMaster, body);
      const data = response.data as Record<string, unknown>;
      const key = typeof data.key === 'string' ? data.key : typeof data.value === 'string' ? data.value : '';
      if (!key) throw new Error('Keen created a key but did not return a recognizable key value. Inspect the Access Key manager before retrying to avoid duplicate active keys.');
      setGeneratedKey(key);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String((caught as { message?: string })?.message ?? caught));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!client || !selectedMaster || !generatedKey) return;
    setBusy(true);
    setError('');
    try {
      await client.accessKeyAction(selectedMaster, generatedKey, 'revoke');
      setGeneratedKey('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String((caught as { message?: string })?.message ?? caught));
    } finally {
      setBusy(false);
    }
  };

  const normalizedViewerBase = normalizeViewerBase(viewerBase);
  const link = normalizedViewerBase
    ? `${normalizedViewerBase}#/public/${encodeURIComponent(projectId)}/${encodeURIComponent(document.id)}#key=${generatedKey ? encodeURIComponent(generatedKey) : '{RESTRICTED_ACCESS_KEY}'}`
    : '';
  const iframe = link ? `<iframe src="${link}" title="${escapeHtmlAttribute(document.title)}" referrerpolicy="no-referrer"></iframe>` : '';

  return <Modal wide title="Share dashboard" description="Provision a dedicated least-privilege Access Key through guided controls. Never use a Master, default Read, Write, or Organization Key in a public link." onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
    <div className="stack">
      <Callout tone="warning" title="Bearer-key boundary">Every viewer can inspect the restricted key. Its allow-list and mandatory filters—not secrecy in the browser—protect the project.</Callout>
      {window.location.protocol === 'file:' ? <Callout tone="warning" title="HTTPS viewer deployment required">A packaged Electron <code>file://</code> page is not a shareable web origin. Deploy the public-viewer bundle over HTTPS before distributing a link or iframe.</Callout> : null}
      {!defaultPublicHosts ? <Callout tone="danger" title="Custom-host viewer required">This workspace uses custom service hosts. The bundled public viewer deliberately sends bearer keys only to Keen’s default hosts; deploy and review a host-specific viewer before creating a public key.</Callout> : null}
      {!dashboardServiceEnabled
        ? <Callout tone="warning" title="Remote dashboard document required">The isolated public route cannot read this device’s IndexedDB. Enable and contract-test the Keen-compatible dashboard service, or host an exported dashboard document in a separate trusted viewer.</Callout>
        : <Callout tone="info" title="Publish layout first">Publish the current dashboard to the configured dashboard service before distributing the link. Dashboard-service acceptance of restricted Access Keys remains source-observed and must be live-tested with a disposable project.</Callout>}

      <Field label="Public viewer deployment URL" required hint="An HTTPS URL where the isolated public viewer bundle is hosted. The packaged Electron file is not a public deployment.">
        <Input value={viewerBase} onChange={(event) => { setViewerBase(event.target.value); setError(''); }} placeholder="https://analytics-viewer.example.com/" />
      </Field>
      <div className="form-grid">
        <CredentialSelect credentials={masterCredentials} value={credentialId} onChange={setCredentialId} label="Master Key for provisioning" />
        <Field label="Access Key name"><Input value={keyName} maxLength={256} onChange={(event) => setKeyName(event.target.value)} /></Field>
      </div>

      <div className="permission-summary">
        <div><strong>{savedNames.length}</strong><span>saved/cached names allow-listed</span></div>
        <div><strong>{adHocCount}</strong><span>ad-hoc charts requiring enforced filters</span></div>
      </div>

      {savedNames.length ? <section className="builder-section">
        <div className="builder-section__header"><div><strong>Saved-query allow-list</strong><span>Only these named saved or cached queries can be retrieved with the generated key.</span></div></div>
        <div className="tag-row">{savedNames.map((name) => <Badge key={name} tone="purple">{name}</Badge>)}</div>
      </section> : null}

      {adHocCount ? <section className="builder-section">
        <div className="builder-section__header"><div><strong>Mandatory security filters</strong><span>Keen adds these constraints to every ad-hoc query made with the generated key. At least one restriction is required.</span></div></div>
        <datalist id="explorer-property-options">{knownFilterProperties.map((property) => <option key={property} value={property} />)}</datalist>
        <FilterBuilder filters={mandatoryFilters} onChange={(filters) => { setMandatoryFilters(filters); setError(''); }} />
      </section> : null}

      <section className="builder-section">
        <div className="builder-section__header"><div><strong>Effective key permissions</strong><span>This summary is derived from the dashboard’s data sources and the restrictions above.</span></div></div>
        {permitted.length ? <div className="tag-row">{permitted.map((permission) => <Badge key={permission} tone="success">{permission.replace(/_/g, ' ')}</Badge>)}</div> : <Callout tone="warning">Complete the required restrictions before the key can be created.</Callout>}
        <ul className="plain-summary-list">
          {savedNames.length ? <li>Saved and cached results are restricted to {savedNames.length} named resource{savedNames.length === 1 ? '' : 's'}.</li> : null}
          {adHocCount ? <li>Ad-hoc query access is restricted by {mandatoryFilters.length} mandatory root filter{mandatoryFilters.length === 1 ? '' : 's'}.</li> : null}
          <li>No write, schema, administration, or organization permission is added by this workflow.</li>
        </ul>
      </section>

      {!generatedKey ? <ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}>
        <Button loading={busy} disabled={!selectedMaster || !defaultPublicHosts || !normalizedViewerBase} onClick={() => void provision()}><KeyRound size={15} /> Create dedicated restricted key</Button>
      </ReadOnlyGate> : <Callout tone="success" title="Restricted key created">The key is held only in this dialog’s memory. Copy the link now. Closing the dialog does not revoke the key; use the Access Key manager and the displayed name for later lifecycle operations.</Callout>}

      <Field label={generatedKey ? 'Public viewer link' : 'Public viewer template'}>
        <Input readOnly type={generatedKey ? 'password' : 'text'} value={link || 'Enter an HTTPS viewer deployment URL above.'} onFocus={(event) => event.currentTarget.select()} />
      </Field>
      <div className="row">
        <Button variant="secondary" disabled={!link} onClick={() => void navigator.clipboard.writeText(link)}><Copy size={14} /> Copy link</Button>
        {generatedKey ? <Button variant="danger" loading={busy} onClick={() => void revoke()}><ShieldOff size={14} /> Revoke generated key</Button> : null}
      </div>
      <Field label="HTTPS deployment iframe"><Input readOnly value={iframe || 'Available after a valid viewer deployment URL is entered.'} onFocus={(event) => event.currentTarget.select()} /></Field>
      <p className="muted small">The iframe requires a separately deployed viewer whose CSP permits the intended embedding origins. The public route reads the fragment into memory and removes it from visible history immediately. The key is still visible to browser users and extensions. This flow creates or revokes a key but deliberately does not persist it in local dashboard metadata.</p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  </Modal>;
}
