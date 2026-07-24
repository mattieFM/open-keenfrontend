import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Braces, History, ListTree, Play, RotateCcw, Save, Square, WandSparkles } from 'lucide-react';
import type { ChartType, KeenFilter, KeenResponse, QueryDraft, QueryDraftRecord } from '@shared/types';
import { Badge, Button, Callout, Card, CredentialSelect, ErrorPanel, Field, Input, PageHeader, Select, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { useWorkspaceStore } from '../../lib/db/workspaceStore';
import { ANALYSIS_TYPES, validateQuery } from '../../lib/query/validation';
import { defaultChart, normalizeResult } from '../../lib/query/normalizer';
import { db } from '../../lib/db/database';
import { ResultView } from './ResultView';
import { FilterBuilder } from './FilterBuilder';
import { FunnelBuilder } from './FunnelBuilder';
import { OrderByBuilder } from './OrderByBuilder';

const DEFAULT_QUERY: QueryDraft = {
  analysis_type: 'count',
  event_collection: '',
  timeframe: 'this_14_days',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  filters: [],
  zero_fill: true,
  include_metadata: true
};

const TARGET_ANALYSES = new Set(['count_unique', 'sum', 'average', 'minimum', 'maximum', 'median', 'percentile', 'select_unique', 'standard_deviation']);
const DEFAULT_FUNNEL_STEPS = [
  { event_collection: 'signups', actor_property: 'user.id' },
  { event_collection: 'purchases', actor_property: 'customer.id' }
];
const DEFAULT_ANALYSES = {
  total: { analysis_type: 'count' },
  revenue: { analysis_type: 'sum', target_property: 'amount' }
};

function parseJsonOr<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return structuredClone(fallback); }
}

function collectionName(item: unknown): string | undefined {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return undefined;
  const record = item as Record<string, unknown>;
  if (typeof record.name === 'string') return record.name;
  if (typeof record.event_collection === 'string') return record.event_collection;
  if (typeof record.url === 'string') {
    try { return decodeURIComponent(record.url.split('/').pop() ?? ''); } catch { return record.url.split('/').pop(); }
  }
  return undefined;
}

function schemaProperties(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : record;
  return Object.entries(properties).filter(([, type]) => typeof type === 'string').map(([name]) => name).sort((a, b) => a.localeCompare(b));
}

export function ExplorerPage(): JSX.Element {
  const { draftId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { workspace, client } = useWorkspaceContext();
  const { candidates, select } = useOperationCredentials('query.run');
  const schemaCredentials = useOperationCredentials('schema.read');
  const setCapability = useWorkspaceStore((state) => state.setCapability);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [credentialId, setCredentialId] = useState(candidates[0]?.id ?? '');
  const [schemaCredentialId, setSchemaCredentialId] = useState(schemaCredentials.candidates[0]?.id ?? '');
  const [collectionOptions, setCollectionOptions] = useState<string[]>([]);
  const [propertyOptions, setPropertyOptions] = useState<string[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<unknown>();
  const [query, setQuery] = useState<QueryDraft>({ ...DEFAULT_QUERY, event_collection: params.get('collection') ?? '', target_property: params.get('target') ?? undefined });
  const [chartType, setChartType] = useState<ChartType>('metric');
  const [mode, setMode] = useState<'form' | 'raw'>('form');
  const [rawJson, setRawJson] = useState(JSON.stringify(query, null, 2));
  const [filtersJson, setFiltersJson] = useState('[]');
  const [filtersMode, setFiltersMode] = useState<'visual' | 'json'>('visual');
  const [funnelMode, setFunnelMode] = useState<'visual' | 'json'>('visual');
  const [funnelJson, setFunnelJson] = useState(JSON.stringify(DEFAULT_FUNNEL_STEPS, null, 2));
  const [analysesJson, setAnalysesJson] = useState(JSON.stringify(DEFAULT_ANALYSES, null, 2));
  const [response, setResponse] = useState<KeenResponse<Record<string, unknown>>>();
  const [error, setError] = useState<unknown>();
  const [running, setRunning] = useState(false);
  const [rawError, setRawError] = useState<string>();
  const [timeMode, setTimeMode] = useState<'relative' | 'absolute'>('relative');
  const [draftName, setDraftName] = useState('Untitled analysis');
  const abortRef = useRef<AbortController>();

  useEffect(() => { if (!credentialId && candidates[0]) setCredentialId(candidates[0].id); }, [credentialId, candidates]);
  useEffect(() => { if (!schemaCredentialId && schemaCredentials.candidates[0]) setSchemaCredentialId(schemaCredentials.candidates[0].id); }, [schemaCredentialId, schemaCredentials.candidates]);
  useEffect(() => {
    if (!draftId) return;
    void db.queryDrafts.get(draftId).then((record) => {
      if (!record) return;
      setQuery(record.query);
      setRawJson(JSON.stringify(record.query, null, 2));
      setFiltersJson(JSON.stringify(record.query.filters ?? [], null, 2));
      setChartType(record.chartType);
      setDraftName(record.name);
      setTimeMode(typeof record.query.timeframe === 'object' ? 'absolute' : 'relative');
    });
  }, [draftId]);

  const errors = useMemo(() => validateQuery(query), [query]);
  const isFunnel = query.analysis_type === 'funnel';
  const isMulti = query.analysis_type === 'multi_analysis';
  const isExtraction = query.analysis_type === 'extraction';

  const patch = (next: Partial<QueryDraft>) => {
    setQuery((current) => {
      const updated = { ...current, ...next };
      setRawJson(JSON.stringify(updated, null, 2));
      return updated;
    });
  };

  const parseFilters = (text: string) => {
    setFiltersJson(text);
    try {
      const value = JSON.parse(text) as KeenFilter[];
      if (!Array.isArray(value)) throw new Error('Filters must be a JSON array.');
      patch({ filters: value });
      setRawError(undefined);
    } catch (parseError) {
      setRawError(parseError instanceof Error ? parseError.message : 'Invalid filter JSON.');
    }
  };

  const changeAnalysis = (analysis_type: string) => {
    const next: QueryDraft = { ...query, analysis_type };
    if (analysis_type === 'funnel') {
      const parsedSteps = parseJsonOr(funnelJson, DEFAULT_FUNNEL_STEPS);
      next.steps = Array.isArray(parsedSteps) ? parsedSteps : structuredClone(DEFAULT_FUNNEL_STEPS);
      delete next.event_collection;
      delete next.target_property;
      delete next.group_by;
      delete next.interval;
      delete next.order_by;
      delete next.limit;
      delete next.filters;
      delete next.zero_fill;
      delete next.latest;
      delete next.property_names;
      delete next.analyses;
    } else {
      next.event_collection ??= '';
      delete next.steps;
      if (analysis_type === 'multi_analysis') {
        const parsedAnalyses = parseJsonOr(analysesJson, DEFAULT_ANALYSES);
        next.analyses = parsedAnalyses && typeof parsedAnalyses === 'object' && !Array.isArray(parsedAnalyses) ? parsedAnalyses : structuredClone(DEFAULT_ANALYSES);
        delete next.target_property;
      } else {
        delete next.analyses;
        if (!TARGET_ANALYSES.has(analysis_type)) delete next.target_property;
      }
      if (analysis_type === 'extraction') {
        delete next.group_by;
        delete next.interval;
        delete next.order_by;
        delete next.limit;
        delete next.zero_fill;
      }
    }
    setRawError(undefined);
    setQuery(next);
    setRawJson(JSON.stringify(next, null, 2));
    setResponse(undefined);
  };

  const applyRaw = () => {
    try {
      const value = JSON.parse(rawJson) as QueryDraft;
      setQuery(value);
      setFiltersJson(JSON.stringify(value.filters ?? [], null, 2));
      if (value.steps) setFunnelJson(JSON.stringify(value.steps, null, 2));
      if (value.analyses) setAnalysesJson(JSON.stringify(value.analyses, null, 2));
      setTimeMode(typeof value.timeframe === 'object' ? 'absolute' : 'relative');
      setRawError(undefined);
      setMode('form');
    } catch (parseError) {
      setRawError(parseError instanceof Error ? parseError.message : 'Invalid JSON.');
    }
  };

  const run = async () => {
    setError(undefined);
    if (!client || !workspace || errors.length || rawError || !credentialId) return;
    setRunning(true);
    abortRef.current = new AbortController();
    try {
      const next = await client.runQuery(select(credentialId), query, abortRef.current.signal);
      await setCapability(workspace.id, 'query.run', 'allowed');
      setResponse(next);
      setChartType((current) => {
        const semantic = normalizeResult(next.data, query);
        const suggested = defaultChart(semantic);
        return current === 'metric' && suggested !== 'metric' ? suggested : current;
      });
    } catch (requestError) {
      if ((requestError as { status?: number }).status === 403) await setCapability(workspace.id, 'query.run', 'denied');
      setError(requestError);
    } finally {
      setRunning(false);
      abortRef.current = undefined;
    }
  };

  const saveDraft = async () => {
    if (!workspace) return;
    const id = draftId ?? crypto.randomUUID();
    const existing = draftId ? await db.queryDrafts.get(draftId) : undefined;
    const now = new Date().toISOString();
    const record: QueryDraftRecord = { id, workspaceId: workspace.id, name: draftName.trim() || 'Untitled analysis', query, chartType, createdAt: existing?.createdAt ?? now, updatedAt: now };
    await db.queryDrafts.put(record);
    if (!draftId) navigate(`/w/${workspace.id}/query/${id}`, { replace: true });
  };

  const syncFunnel = (text: string) => {
    setFunnelJson(text);
    try { patch({ steps: JSON.parse(text) }); setRawError(undefined); } catch (parseError) { setRawError(parseError instanceof Error ? parseError.message : 'Invalid funnel JSON.'); }
  };
  const syncAnalyses = (text: string) => {
    setAnalysesJson(text);
    try { patch({ analyses: JSON.parse(text) }); setRawError(undefined); } catch (parseError) { setRawError(parseError instanceof Error ? parseError.message : 'Invalid analyses JSON.'); }
  };
  const setAbsolute = (field: 'start' | 'end', value: string) => {
    const current = typeof query.timeframe === 'object' ? query.timeframe : { start: new Date(Date.now() - 14 * 86_400_000).toISOString(), end: new Date().toISOString() };
    patch({ timeframe: { ...current, [field]: value ? new Date(value).toISOString() : '' } });
  };
  const localDateValue = useCallback((value?: string) => value ? new Date(value).toISOString().slice(0, 16) : '', []);

  const loadCollectionSuggestions = async () => {
    if (!client || !schemaCredentialId) return;
    setSchemaLoading(true); setSchemaError(undefined);
    try {
      const response = await client.listCollections(schemaCredentials.select(schemaCredentialId), false);
      const names = (Array.isArray(response.data) ? response.data : []).map(collectionName).filter((name): name is string => Boolean(name)).sort((a, b) => a.localeCompare(b));
      setCollectionOptions([...new Set(names)]);
    } catch (caught) { setSchemaError(caught); } finally { setSchemaLoading(false); }
  };

  const loadPropertySuggestions = async () => {
    if (!client || !schemaCredentialId || !query.event_collection?.trim()) return;
    setSchemaLoading(true); setSchemaError(undefined);
    try {
      const response = await client.getCollection(schemaCredentials.select(schemaCredentialId), query.event_collection.trim());
      setPropertyOptions(schemaProperties(response.data));
    } catch (caught) { setSchemaError(caught); } finally { setSchemaLoading(false); }
  };

  const resetQuery = () => {
    const next = { ...DEFAULT_QUERY };
    setQuery(next);
    setRawJson(JSON.stringify(next, null, 2));
    setFiltersJson('[]');
    setFiltersMode('visual');
    setFunnelJson(JSON.stringify(DEFAULT_FUNNEL_STEPS, null, 2));
    setFunnelMode('visual');
    setAnalysesJson(JSON.stringify(DEFAULT_ANALYSES, null, 2));
    setTimeMode('relative');
    setChartType('metric');
    setRawError(undefined);
    setError(undefined);
    setResponse(undefined);
  };

  return (
    <>
      <PageHeader eyebrow="Data Explorer" title="Build an analysis" description="POST a documented Keen Analytics query with an explicitly selected query-capable key. Queries run only when you press Run; identical in-flight reads are deduplicated." actions={<><Button variant="secondary" onClick={resetQuery}><RotateCcw size={15} /> Reset</Button><Button variant="secondary" onClick={() => void saveDraft()}><Save size={15} /> Save local draft</Button>{running ? <Button variant="danger" onClick={() => abortRef.current?.abort()}><Square size={14} /> Cancel</Button> : <Button onClick={run} disabled={Boolean(errors.length || rawError || !credentialId)}><Play size={15} /> Run query</Button>}</>} />

      <div className="split-layout split-layout--wide">
        <Card>
          <div className="card__header"><div><h2>Query definition</h2><p>Unknown API fields are preserved in raw JSON mode.</p></div><div className="segmented"><button className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>Builder</button><button className={mode === 'raw' ? 'active' : ''} onClick={() => { setRawJson(JSON.stringify(query, null, 2)); setMode('raw'); }}>Raw JSON</button></div></div>
          <div className="card__body stack">
            <div className="form-grid"><Field label="Local draft name"><Input value={draftName} onChange={(event) => setDraftName(event.target.value)} /></Field><CredentialSelect credentials={candidates} value={credentialId} onChange={setCredentialId} /></div>
            <div className="schema-suggestion-panel"><div><strong className="small inline-icon"><ListTree size={15} /> Optional schema suggestions</strong><div className="field__hint">Loaded only when requested; manual entry always remains available.</div></div><CredentialSelect credentials={schemaCredentials.candidates} value={schemaCredentialId} onChange={setSchemaCredentialId} label="Schema credential" /><div className="row"><Button variant="secondary" loading={schemaLoading} disabled={!schemaCredentialId} onClick={() => void loadCollectionSuggestions()}>Load streams</Button><Button variant="secondary" loading={schemaLoading} disabled={!schemaCredentialId || !query.event_collection?.trim()} onClick={() => void loadPropertySuggestions()}>Load properties</Button></div></div>
            {schemaError ? <ErrorPanel error={schemaError} /> : null}
            <datalist id="explorer-collection-options">{collectionOptions.map((name) => <option key={name} value={name} />)}</datalist><datalist id="explorer-property-options">{propertyOptions.map((name) => <option key={name} value={name} />)}</datalist>
            {mode === 'raw' ? <><Field label="API-shaped query JSON" error={rawError}><Textarea className="textarea--code" value={rawJson} onChange={(event) => setRawJson(event.target.value)} spellCheck={false} /></Field><div className="form-actions"><Button variant="secondary" onClick={applyRaw}><Braces size={14} /> Apply to builder</Button></div></> : (
              <>
                <div className="form-grid">
                  <Field label="Analysis type" required><Select value={query.analysis_type} onChange={(event) => changeAnalysis(event.target.value)}>{ANALYSIS_TYPES.map((analysis) => <option key={analysis} value={analysis}>{analysis.replace(/_/g, ' ')}</option>)}</Select></Field>
                  {!isFunnel ? <Field label="Event collection" required><Input list="explorer-collection-options" value={query.event_collection ?? ''} onChange={(event) => { patch({ event_collection: event.target.value }); setPropertyOptions([]); }} placeholder="purchases" /></Field> : <div />}
                  {TARGET_ANALYSES.has(query.analysis_type) ? <Field label="Target property" required><Input list="explorer-property-options" value={query.target_property ?? ''} onChange={(event) => patch({ target_property: event.target.value })} placeholder="amount" /></Field> : null}
                  {query.analysis_type === 'percentile' ? <Field label="Percentile" required><Input type="number" min="0" max="100" step="0.01" value={query.percentile ?? 95} onChange={(event) => patch({ percentile: Number(event.target.value) })} /></Field> : null}
                </div>

                {isFunnel ? <div className="stack"><div className="row row--between"><strong className="small">Funnel steps</strong><div className="segmented"><button className={funnelMode === 'visual' ? 'active' : ''} onClick={() => setFunnelMode('visual')}>Builder</button><button className={funnelMode === 'json' ? 'active' : ''} onClick={() => { setFunnelJson(JSON.stringify(query.steps ?? [], null, 2)); setFunnelMode('json'); }}>Raw JSON</button></div></div>{funnelMode === 'visual' ? <FunnelBuilder steps={query.steps ?? []} onChange={(steps) => { patch({ steps }); setFunnelJson(JSON.stringify(steps, null, 2)); }} /> : <Field label="Funnel steps JSON" error={rawError}><Textarea className="textarea--code" value={funnelJson} onChange={(event) => syncFunnel(event.target.value)} /></Field>}</div> : isMulti ? <Field label="Named analyses" error={rawError}><Textarea className="textarea--code" value={analysesJson} onChange={(event) => syncAnalyses(event.target.value)} /></Field> : null}

                <>
                  <div className="row row--between"><div><strong className="small">{isFunnel ? 'Shared funnel timeframe' : 'Timeframe'}</strong>{isFunnel ? <div className="field__hint">Each step can override this shared range.</div> : null}</div><div className="segmented"><button className={timeMode === 'relative' ? 'active' : ''} onClick={() => { setTimeMode('relative'); patch({ timeframe: 'this_14_days' }); }}>Relative</button><button className={timeMode === 'absolute' ? 'active' : ''} onClick={() => { setTimeMode('absolute'); patch({ timeframe: { start: new Date(Date.now() - 14 * 86_400_000).toISOString(), end: new Date().toISOString() } }); }}>Absolute</button></div></div>
                  {timeMode === 'relative' ? <div className="form-grid"><Field label="Relative timeframe" required><Input value={typeof query.timeframe === 'string' ? query.timeframe : 'this_14_days'} onChange={(event) => patch({ timeframe: event.target.value })} placeholder="this_14_days" /></Field><Field label="Timezone" hint="IANA name or supported seconds offset."><Input value={String(query.timezone ?? '')} onChange={(event) => patch({ timezone: event.target.value })} /></Field></div> : <div className="form-grid"><Field label="Start" required><Input type="datetime-local" value={localDateValue(typeof query.timeframe === 'object' ? query.timeframe.start : undefined)} onChange={(event) => setAbsolute('start', event.target.value)} /></Field><Field label="End (exclusive)" required><Input type="datetime-local" value={localDateValue(typeof query.timeframe === 'object' ? query.timeframe.end : undefined)} onChange={(event) => setAbsolute('end', event.target.value)} /></Field></div>}
                </>

                {!isFunnel && !isExtraction ? <div className="form-grid form-grid--3"><Field label="Interval"><Input value={query.interval ?? ''} onChange={(event) => patch({ interval: event.target.value || undefined })} placeholder="daily / every_2_hours" /></Field><Field label="Group by"><Input list="explorer-property-options" value={Array.isArray(query.group_by) ? query.group_by.join(', ') : typeof query.group_by === 'string' ? query.group_by : ''} onChange={(event) => { const values = event.target.value.split(',').map((value) => value.trim()).filter(Boolean); patch({ group_by: values.length > 1 ? values : values[0] }); }} placeholder="country, plan" /></Field><Field label="Limit"><Input type="number" min="1" value={query.limit ?? ''} onChange={(event) => patch({ limit: event.target.value ? Number(event.target.value) : undefined })} /></Field></div> : null}

                {!isFunnel ? <div className="stack stack--compact"><div className="row row--between"><div><strong className="small">Filters</strong><div className="field__hint">Root filters are ANDed; OR groups can be nested.</div></div><div className="segmented"><button className={filtersMode === 'visual' ? 'active' : ''} onClick={() => setFiltersMode('visual')}>Builder</button><button className={filtersMode === 'json' ? 'active' : ''} onClick={() => { setFiltersJson(JSON.stringify(query.filters ?? [], null, 2)); setFiltersMode('json'); }}>Raw JSON</button></div></div>{filtersMode === 'visual' ? <FilterBuilder filters={query.filters ?? []} onChange={(filters) => { patch({ filters }); setFiltersJson(JSON.stringify(filters, null, 2)); setRawError(undefined); }} /> : <Field label="Filters JSON" hint="Normal entries are ANDed. Use an OR object with operands for alternatives." error={rawError}><Textarea className="textarea--code" value={filtersJson} onChange={(event) => parseFilters(event.target.value)} /></Field>}</div> : null}

                {!isFunnel && !isExtraction ? <div className="stack stack--compact"><strong className="small">Order by</strong><OrderByBuilder value={query.order_by ?? []} onChange={(order_by) => patch({ order_by })} /></div> : null}

                {isExtraction ? <div className="form-grid"><Field label="Latest records"><Input type="number" min="1" value={query.latest ?? 100} onChange={(event) => patch({ latest: Number(event.target.value) })} /></Field><Field label="Property names" hint="Comma-separated; blank returns all properties."><Input value={query.property_names?.join(', ') ?? ''} onChange={(event) => patch({ property_names: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></Field></div> : null}

                <div className="row"><label className="checkbox-row"><input type="checkbox" checked={query.include_metadata ?? false} onChange={(event) => patch({ include_metadata: event.target.checked })} /><span>Include execution metadata</span></label>{!isFunnel && !isExtraction ? <label className="checkbox-row"><input type="checkbox" checked={query.zero_fill ?? true} onChange={(event) => patch({ zero_fill: event.target.checked })} /><span>Zero fill intervals</span></label> : null}</div>
              </>
            )}

            {errors.length ? <Callout tone="warning" title="Query needs attention"><ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((validationError) => <li key={validationError}>{validationError}</li>)}</ul></Callout> : <Callout tone="success" title="Ready to run">The request is read-only, uses the selected credential explicitly, and will not auto-run on field changes.</Callout>}
            {error ? <ErrorPanel error={error} /> : null}
          </div>
          <div className="card__footer form-actions"><Button variant="secondary" onClick={() => void saveDraft()}><History size={14} /> Save draft</Button>{running ? <Button variant="danger" onClick={() => abortRef.current?.abort()}><Square size={14} /> Cancel</Button> : <Button onClick={run} disabled={Boolean(errors.length || rawError || !credentialId)} loading={running}><WandSparkles size={15} /> Run analysis</Button>}</div>
        </Card>

        <div className="sticky-panel stack">
          {response ? <ResultView response={response} query={query} chartType={chartType} onChartType={setChartType} /> : <Card><div className="card__body"><Callout tone="info" title="No request sent yet">Build a query and press Run. Results, chart compatibility, raw response, metadata, and redacted request details will appear here.</Callout></div></Card>}
        </div>
      </div>
    </>
  );
}
