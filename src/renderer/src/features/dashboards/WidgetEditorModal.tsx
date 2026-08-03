import { useMemo, useState } from 'react';
import { Bold, Heading2, Italic, List, ListTree, RefreshCw } from 'lucide-react';
import type { ChartType, DashboardDocument, DashboardWidget, KeenTimeframe, QueryDraft } from '@shared/types';
import { Button, Callout, CredentialSelect, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { validateQuery } from '../../lib/query/validation';
import { parseCollectionDetail, parseCollectionList, propertyNames } from '../../lib/schema/collections';
import { DashboardQueryBuilder } from './DashboardQueryBuilder';
import { TimeframePicker } from '../explorer/TimeframePicker';

const CHART_TYPES: Array<[ChartType, string]> = [
  ['metric', 'Metric'], ['table', 'Table'], ['line', 'Line'], ['area', 'Area'], ['bar', 'Bar'], ['pie', 'Pie'], ['donut', 'Donut'], ['funnel', 'Funnel'], ['gauge', 'Gauge'], ['heatmap', 'Heatmap'], ['bubble', 'Bubble'], ['choropleth', 'Choropleth']
];

function defaultQuery(): QueryDraft {
  return { analysis_type: 'count', event_collection: '', timeframe: 'this_30_days', interval: 'daily', zero_fill: true, include_metadata: true, filters: [] };
}

function compatibleChartTypes(query: QueryDraft): ChartType[] {
  if (query.analysis_type === 'extraction' || query.analysis_type === 'select_unique' || query.analysis_type === 'multi_analysis') return ['table'];
  if (query.analysis_type === 'funnel') return ['funnel', 'bar', 'table'];
  if (query.interval) return ['line', 'area', 'bar', 'table'];
  if (query.group_by) {
    const groupCount = Array.isArray(query.group_by) ? query.group_by.length : 1;
    return groupCount >= 2 ? ['bar', 'pie', 'donut', 'heatmap', 'table'] : ['bar', 'pie', 'donut', 'table'];
  }
  // Choropleth needs a registered GeoJSON map and bubble needs explicit numeric
  // axis mapping; neither is inferred safely from a query definition alone.
  return ['metric', 'gauge', 'table'];
}

export function WidgetEditorModal({ document, widget, onSave, onClose }: { document: DashboardDocument; widget: DashboardWidget; onSave(widget: DashboardWidget): void; onClose(): void }): JSX.Element {
  const [draft, setDraft] = useState<DashboardWidget>(structuredClone(widget));
  const [error, setError] = useState('');
  const [collections, setCollections] = useState<string[]>([]);
  const [properties, setProperties] = useState<string[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [optionLoading, setOptionLoading] = useState(false);
  const { client } = useWorkspaceContext();
  const schemaCredentials = useOperationCredentials('schema.read');
  const queryCredentials = useOperationCredentials('query.run');
  const [schemaCredentialId, setSchemaCredentialId] = useState(schemaCredentials.candidates[0]?.id ?? '');
  const [queryCredentialId, setQueryCredentialId] = useState(queryCredentials.candidates[0]?.id ?? '');
  const chartWidgets = useMemo(() => document.widgets.filter((item): item is Extract<DashboardWidget, { type: 'chart' }> => item.type === 'chart'), [document.widgets]);

  const toggleTarget = (id: string) => {
    if (draft.type !== 'filter' && draft.type !== 'date-range') return;
    setDraft({ ...draft, targetWidgetIds: draft.targetWidgetIds.includes(id) ? draft.targetWidgetIds.filter((target) => target !== id) : [...draft.targetWidgetIds, id] });
  };

  const loadCollections = async () => {
    if (!client || !schemaCredentialId) { setSchemaError('Choose a schema-capable Read, Access, or Master key.'); return; }
    setSchemaLoading(true); setSchemaError('');
    try {
      const response = await client.listCollections(schemaCredentials.select(schemaCredentialId), true);
      setCollections(parseCollectionList(response.data).map((stream) => stream.name));
    } catch (caught) { setSchemaError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSchemaLoading(false); }
  };

  const loadProperties = async (collection: string) => {
    if (!client || !schemaCredentialId || !collection.trim()) return;
    setSchemaLoading(true); setSchemaError('');
    try {
      const response = await client.getCollection(schemaCredentials.select(schemaCredentialId), collection.trim());
      setProperties(propertyNames(parseCollectionDetail(response.data, collection.trim())));
    } catch (caught) { setSchemaError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSchemaLoading(false); }
  };

  const loadFilterOptions = async () => {
    if (draft.type !== 'filter' || !client || !queryCredentialId || !draft.eventCollection.trim() || !draft.propertyName.trim()) return;
    setOptionLoading(true); setError('');
    try {
      const response = await client.runQuery(queryCredentials.select(queryCredentialId), {
        analysis_type: 'select_unique',
        event_collection: draft.eventCollection.trim(),
        target_property: draft.propertyName.trim(),
        timeframe: 'this_90_days',
        limit: 200
      });
      const result = (response.data as { result?: unknown }).result;
      if (!Array.isArray(result)) throw new Error('Keen did not return a unique-value list for this field.');
      const options = [...new Set(result.filter((value) => ['string', 'number', 'boolean'].includes(typeof value)).map(String))].sort((a, b) => a.localeCompare(b));
      setDraft({ ...draft, options, optionSource: 'query' });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setOptionLoading(false); }
  };

  const save = () => {
    setError('');
    if (draft.type === 'chart' && draft.source.kind === 'ad-hoc') {
      const errors = validateQuery(draft.source.query);
      if (errors.length) { setError(errors.join(' ')); return; }
      const supported = compatibleChartTypes(draft.source.query);
      onSave({ ...draft, chartType: supported.includes(draft.chartType) ? draft.chartType : supported[0] });
      return;
    }
    if (draft.type === 'chart' && draft.source.kind === 'saved' && !draft.source.name.trim()) { setError('Saved query API name is required.'); return; }
    if (draft.type === 'image') {
      if (!draft.decorative && !draft.alt.trim()) { setError('Alt text is required unless the image is decorative.'); return; }
      if (draft.url) { try { if (new URL(draft.url).protocol !== 'https:') throw new Error(); } catch { setError('Image URL must use HTTPS.'); return; } }
    }
    if (draft.type === 'filter' && (!draft.eventCollection.trim() || !draft.propertyName.trim())) { setError('Filter widgets require an event stream and string field.'); return; }
    if (draft.type === 'date-range' && !draft.timeframe) { setError('Choose a dashboard date range.'); return; }
    onSave(draft);
  };

  const modalWide = draft.type === 'chart' || draft.type === 'filter' || draft.type === 'date-range';
  return <Modal wide={modalWide} title={`Edit ${draft.type === 'date-range' ? 'date range' : draft.type} widget`} description="Every dashboard option is available through guided controls; no JSON payload authoring is required." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save widget</Button></>}>
    <div className="stack">
      {(draft.type === 'chart' || draft.type === 'filter') ? <div className="dashboard-credential-strip"><CredentialSelect credentials={schemaCredentials.candidates} value={schemaCredentialId} onChange={setSchemaCredentialId} label="Schema key" />{draft.type === 'filter' ? <CredentialSelect credentials={queryCredentials.candidates} value={queryCredentialId} onChange={setQueryCredentialId} label="Value lookup key" /> : null}</div> : null}
      {draft.type === 'chart' ? <>
        <div className="form-grid form-grid--3"><Field label="Title"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Chart type"><Select value={draft.chartType} onChange={(event) => setDraft({ ...draft, chartType: event.target.value as ChartType })}>{CHART_TYPES.map(([type, label]) => <option key={type} value={type} disabled={draft.source.kind === 'ad-hoc' && !compatibleChartTypes(draft.source.query).includes(type)}>{label}</option>)}</Select></Field><Field label="Number format"><Select value={draft.valueFormat ?? 'number'} onChange={(event) => setDraft({ ...draft, valueFormat: event.target.value as NonNullable<typeof draft.valueFormat> })}><option value="number">Number</option><option value="compact">Compact (1.2K)</option><option value="duration-ms">Duration from milliseconds</option><option value="percent">Percent</option></Select></Field></div>
        <Field label="Subtitle"><Input value={draft.subtitle ?? ''} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></Field>
        <Field label="Data source"><Select value={draft.source.kind} onChange={(event) => setDraft(event.target.value === 'saved' ? { ...draft, source: { kind: 'saved', name: '' } } : { ...draft, source: { kind: 'ad-hoc', query: defaultQuery() } })}><option value="ad-hoc">Build a query</option><option value="saved">Use a linked saved query</option></Select></Field>
        {draft.source.kind === 'saved' ? <Field label="Saved query API name" required hint="Enter a known name when the selected key cannot list definitions."><Input value={draft.source.name} onChange={(event) => setDraft({ ...draft, source: { kind: 'saved', name: event.target.value } })} placeholder="sessions_30d" /></Field> : <DashboardQueryBuilder query={draft.source.query} onChange={(query) => setDraft({ ...draft, source: { kind: 'ad-hoc', query } })} collections={collections} properties={properties} schemaLoading={schemaLoading} schemaError={schemaError} onLoadCollections={() => void loadCollections()} onLoadProperties={(collection) => void loadProperties(collection)} />}
        <label className="checkbox-row"><input type="checkbox" checked={draft.showTableFallback ?? true} onChange={(event) => setDraft({ ...draft, showTableFallback: event.target.checked })} /><span>Offer an accessible table view beside the chart</span></label>
      </> : draft.type === 'text' ? <>
        <div className="rich-text-toolbar" aria-label="Text formatting shortcuts"><Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, markdown: `## ${draft.markdown}` })}><Heading2 size={14} /> Heading</Button><Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, markdown: `**${draft.markdown}**` })}><Bold size={14} /> Bold</Button><Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, markdown: `_${draft.markdown}_` })}><Italic size={14} /> Italic</Button><Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, markdown: draft.markdown.split('\n').map((line) => `- ${line}`).join('\n') })}><List size={14} /> List</Button></div>
        <Field label="Dashboard text" hint="Safe Markdown formatting is rendered without scripts, forms, iframes, or remote images."><Textarea className="dashboard-text-editor" value={draft.markdown} onChange={(event) => setDraft({ ...draft, markdown: event.target.value })} /></Field>
      </> : draft.type === 'image' ? <>
        <Field label="HTTPS image URL" error={error}><Input type="url" value={draft.url} onChange={(event) => { setDraft({ ...draft, url: event.target.value }); setError(''); }} /></Field>
        <div className="form-grid"><Field label="Alt text"><Input value={draft.alt} disabled={draft.decorative} onChange={(event) => setDraft({ ...draft, alt: event.target.value })} /></Field><Field label="Fit"><Select value={draft.fit} onChange={(event) => setDraft({ ...draft, fit: event.target.value as 'contain' | 'cover' | 'original' })}><option value="contain">Contain</option><option value="cover">Cover</option><option value="original">Original</option></Select></Field></div>
        <label className="checkbox-row"><input type="checkbox" checked={draft.decorative ?? false} onChange={(event) => setDraft({ ...draft, decorative: event.target.checked, alt: event.target.checked ? '' : draft.alt })} /><span>Decorative image</span></label>
        <Field label="Caption"><Input value={draft.caption ?? ''} onChange={(event) => setDraft({ ...draft, caption: event.target.value })} /></Field>
        <Callout tone="warning">Remote image hosts receive each viewer’s network request. Images use <code>referrerpolicy=&quot;no-referrer&quot;</code>.</Callout>
      </> : draft.type === 'filter' ? <>
        <datalist id="dashboard-collection-options">{collections.map((name) => <option key={name} value={name} />)}</datalist><datalist id="explorer-property-options">{properties.map((name) => <option key={name} value={name} />)}</datalist>
        <div className="form-grid form-grid--3"><Field label="Title"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Event stream"><Input list="dashboard-collection-options" value={draft.eventCollection} onChange={(event) => setDraft({ ...draft, eventCollection: event.target.value })} /></Field><Field label="String field"><Input list="explorer-property-options" value={draft.propertyName} onChange={(event) => setDraft({ ...draft, propertyName: event.target.value })} /></Field></div>
        <div className="row"><Button type="button" variant="secondary" loading={schemaLoading} onClick={() => void loadCollections()}><ListTree size={14} /> Load streams</Button><Button type="button" variant="secondary" loading={schemaLoading} disabled={!draft.eventCollection.trim()} onClick={() => void loadProperties(draft.eventCollection)}><RefreshCw size={14} /> Load fields</Button><Button type="button" variant="secondary" loading={optionLoading} disabled={!queryCredentialId || !draft.eventCollection.trim() || !draft.propertyName.trim()} onClick={() => void loadFilterOptions()}><RefreshCw size={14} /> Fetch unique values</Button></div>
        {schemaError ? <Callout tone="warning">{schemaError}</Callout> : null}
        <div className="form-grid"><Field label="Selection"><Select value={draft.selectionMode ?? 'single'} onChange={(event) => setDraft({ ...draft, selectionMode: event.target.value as 'single' | 'multiple', selected: [] })}><option value="single">Single value</option><option value="multiple">Multiple values</option></Select></Field><label className="checkbox-row checkbox-row--field"><input type="checkbox" checked={draft.allowSearch ?? true} onChange={(event) => setDraft({ ...draft, allowSearch: event.target.checked })} /><span>Show option search</span></label></div>
        <Field label="Filter choices" hint="One value per line. Fetch unique values above or enter the choices manually."><Textarea value={draft.options.join('\n')} onChange={(event) => setDraft({ ...draft, options: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean), optionSource: 'manual' })} /></Field>
        <TargetSelector chartWidgets={chartWidgets} selected={draft.targetWidgetIds} onToggle={toggleTarget} filterCollection={draft.eventCollection} />
      </> : <>
        <div className="form-grid"><Field label="Title"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><div /></div>
        <TimeframePicker value={draft.timeframe} timezone={draft.timezone} onChange={(timeframe: KeenTimeframe | undefined, timezone) => setDraft({ ...draft, timeframe: timeframe ?? 'this_30_days', timezone })} />
        <TargetSelector chartWidgets={chartWidgets} selected={draft.targetWidgetIds} onToggle={toggleTarget} dateWidget document={document} />
      </>}
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  </Modal>;
}

function TargetSelector({ chartWidgets, selected, onToggle, dateWidget = false, document, filterCollection }: { chartWidgets: Array<Extract<DashboardWidget, { type: 'chart' }>>; selected: string[]; onToggle(id: string): void; dateWidget?: boolean; document?: DashboardDocument; filterCollection?: string }): JSX.Element {
  const normalizedFilterCollection = filterCollection?.trim();
  return <div className="field"><span className="field__label">Target charts</span><div className="target-list">{chartWidgets.map((chart) => {
    const claimed = Boolean(dateWidget && document?.widgets.some((widget) => widget.type === 'date-range' && widget.targetWidgetIds.includes(chart.id) && !selected.includes(chart.id)));
    const saved = chart.source.kind === 'saved';
    const funnel = !dateWidget && chart.source.kind === 'ad-hoc' && chart.source.query.analysis_type === 'funnel';
    const collectionMismatch = !dateWidget && chart.source.kind === 'ad-hoc' && Boolean(normalizedFilterCollection) && chart.source.query.event_collection !== normalizedFilterCollection;
    const incompatible = claimed || saved || funnel || collectionMismatch;
    const disabled = incompatible && !selected.includes(chart.id);
    const reason = claimed ? 'already controlled by another date widget' : saved ? 'linked saved-result charts cannot be runtime-patched; detach first' : funnel ? 'funnels cannot be targeted by string filters' : collectionMismatch ? 'stream does not match this filter' : '';
    return <label key={chart.id} className={`checkbox-row target-row ${disabled ? 'muted' : ''}`}><input type="checkbox" checked={selected.includes(chart.id)} disabled={disabled} onChange={() => onToggle(chart.id)} /><span><strong>{chart.title}</strong>{reason ? ` · ${reason}` : ''}</span></label>;
  })}{!chartWidgets.length ? <span className="muted small">Add a chart before connecting a control.</span> : null}</div></div>;
}
