import { useMemo, useState } from 'react';
import type { ChartType, DashboardDocument, DashboardWidget, QueryDraft } from '@shared/types';
import { Button, Callout, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { validateQuery } from '../../lib/query/validation';

const CHART_TYPES: ChartType[] = ['metric', 'table', 'line', 'area', 'bar', 'pie', 'donut', 'funnel', 'gauge', 'heatmap', 'bubble', 'choropleth'];

export function WidgetEditorModal({ document, widget, onSave, onClose }: { document: DashboardDocument; widget: DashboardWidget; onSave(widget: DashboardWidget): void; onClose(): void }): JSX.Element {
  const [draft, setDraft] = useState<DashboardWidget>(structuredClone(widget));
  const [queryJson, setQueryJson] = useState(() => draft.type === 'chart' && draft.source.kind === 'ad-hoc' ? JSON.stringify(draft.source.query, null, 2) : '{}');
  const [error, setError] = useState('');
  const chartWidgets = useMemo(() => document.widgets.filter((item): item is Extract<DashboardWidget, { type: 'chart' }> => item.type === 'chart'), [document.widgets]);

  const toggleTarget = (id: string) => {
    if (draft.type !== 'filter' && draft.type !== 'date-range') return;
    setDraft({ ...draft, targetWidgetIds: draft.targetWidgetIds.includes(id) ? draft.targetWidgetIds.filter((target) => target !== id) : [...draft.targetWidgetIds, id] });
  };
  const save = () => {
    if (draft.type === 'chart' && draft.source.kind === 'ad-hoc') {
      try {
        const query = JSON.parse(queryJson) as QueryDraft;
        const errors = validateQuery(query);
        if (errors.length) { setError(errors.join(' ')); return; }
        onSave({ ...draft, source: { kind: 'ad-hoc', query } });
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid query JSON.'); }
      return;
    }
    if (draft.type === 'chart' && draft.source.kind === 'saved' && !draft.source.name.trim()) {
      setError('Saved query API name is required.'); return;
    }
    if (draft.type === 'image') {
      if (!draft.decorative && !draft.alt.trim()) { setError('Alt text is required unless the image is decorative.'); return; }
      if (draft.url) { try { if (new URL(draft.url).protocol !== 'https:') throw new Error(); } catch { setError('Image URL must use HTTPS.'); return; } }
    }
    if (draft.type === 'filter') {
      if (!draft.eventCollection.trim() || !draft.propertyName.trim()) { setError('Filter widgets require an event collection and string property.'); return; }
    }
    if (draft.type === 'date-range' && typeof draft.timeframe === 'string' && draft.timeframe.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(draft.timeframe) as { start?: unknown; end?: unknown };
        const start = typeof parsed.start === 'string' ? Date.parse(parsed.start) : Number.NaN;
        const end = typeof parsed.end === 'string' ? Date.parse(parsed.end) : Number.NaN;
        if (typeof parsed.start !== 'string' || typeof parsed.end !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error();
        onSave({ ...draft, timeframe: { start: parsed.start, end: parsed.end } });
      } catch { setError('Absolute timeframe must be JSON with valid start and exclusive end ISO values.'); }
      return;
    }
    if (draft.type === 'date-range' && typeof draft.timeframe === 'string' && !draft.timeframe.trim()) { setError('Date range timeframe is required.'); return; }
    onSave(draft);
  };

  return <Modal title={`Edit ${draft.type} widget`} description="Configuration is stored in the versioned dashboard document. Query JSON preserves unknown API fields." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save widget</Button></>}>
    <div className="stack">
      {draft.type === 'chart' ? <>
        <div className="form-grid"><Field label="Title"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Chart type"><Select value={draft.chartType} onChange={(event) => setDraft({ ...draft, chartType: event.target.value as ChartType })}>{CHART_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</Select></Field></div>
        <Field label="Subtitle"><Input value={draft.subtitle ?? ''} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></Field>
        <Field label="Data source"><Select value={draft.source.kind} onChange={(event) => setDraft(event.target.value === 'saved' ? { ...draft, source: { kind: 'saved', name: '' } } : { ...draft, source: { kind: 'ad-hoc', query: { analysis_type: 'count', event_collection: 'purchases', timeframe: 'this_14_days' } } })}><option value="ad-hoc">Ad-hoc query</option><option value="saved">Linked saved query</option></Select></Field>
        {draft.source.kind === 'saved' ? <Field label="Saved query API name" required><Input value={draft.source.name} onChange={(event) => setDraft({ ...draft, source: { kind: 'saved', name: event.target.value } })} placeholder="purchases_14d" /></Field> : <Field label="API-shaped query JSON" error={error}><Textarea className="textarea--code" value={queryJson} onChange={(event) => { setQueryJson(event.target.value); setError(''); }} spellCheck={false} /></Field>}
      </> : draft.type === 'text' ? <Field label="Safe Markdown"><Textarea className="textarea--code" value={draft.markdown} onChange={(event) => setDraft({ ...draft, markdown: event.target.value })} /></Field> : draft.type === 'image' ? <>
        <Field label="HTTPS image URL" error={error}><Input type="url" value={draft.url} onChange={(event) => { setDraft({ ...draft, url: event.target.value }); setError(''); }} /></Field>
        <div className="form-grid"><Field label="Alt text"><Input value={draft.alt} disabled={draft.decorative} onChange={(event) => setDraft({ ...draft, alt: event.target.value })} /></Field><Field label="Fit"><Select value={draft.fit} onChange={(event) => setDraft({ ...draft, fit: event.target.value as 'contain' | 'cover' | 'original' })}><option value="contain">Contain</option><option value="cover">Cover</option><option value="original">Original</option></Select></Field></div>
        <label className="checkbox-row"><input type="checkbox" checked={draft.decorative ?? false} onChange={(event) => setDraft({ ...draft, decorative: event.target.checked, alt: event.target.checked ? '' : draft.alt })} /><span>Decorative image (empty alt text)</span></label>
        <Field label="Caption"><Input value={draft.caption ?? ''} onChange={(event) => setDraft({ ...draft, caption: event.target.value })} /></Field>
        <Callout tone="warning">Remote image hosts receive each viewer’s network request. Images use <code>referrerpolicy=&quot;no-referrer&quot;</code>.</Callout>
      </> : draft.type === 'filter' ? <>
        <div className="form-grid"><Field label="Title"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Event collection"><Input value={draft.eventCollection} onChange={(event) => setDraft({ ...draft, eventCollection: event.target.value })} /></Field></div>
        <Field label="String property"><Input value={draft.propertyName} onChange={(event) => setDraft({ ...draft, propertyName: event.target.value })} /></Field>
        <Field label="Options" hint="One value per line. Explicit options avoid hidden query consumption."><Textarea value={draft.options.join('\n')} onChange={(event) => setDraft({ ...draft, options: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) })} /></Field>
        <TargetSelector chartWidgets={chartWidgets} selected={draft.targetWidgetIds} onToggle={toggleTarget} filterCollection={draft.eventCollection} />
      </> : <>
        <div className="form-grid"><Field label="Title"><Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Timeframe" hint="Relative value or absolute {start,end} JSON; end is exclusive."><Input value={typeof draft.timeframe === 'string' ? draft.timeframe : JSON.stringify(draft.timeframe)} onChange={(event) => setDraft({ ...draft, timeframe: event.target.value })} /></Field></div>
        <Field label="Timezone"><Input value={String(draft.timezone ?? '')} onChange={(event) => setDraft({ ...draft, timezone: event.target.value || undefined })} /></Field>
        <TargetSelector chartWidgets={chartWidgets} selected={draft.targetWidgetIds} onToggle={toggleTarget} dateWidget document={document} />
      </>}
      {error && !(draft.type === 'chart' && draft.source.kind === 'ad-hoc') && draft.type !== 'image' ? <Callout tone="danger">{error}</Callout> : null}
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
    const reason = claimed
      ? 'already controlled by another date widget'
      : saved
        ? 'linked saved-result charts cannot be runtime-patched; detach first'
        : funnel
          ? 'funnels cannot be targeted by string filters'
          : collectionMismatch
            ? 'event collection does not match this filter'
            : '';
    return <label key={chart.id} className={`checkbox-row target-row ${disabled ? 'muted' : ''}`}><input type="checkbox" checked={selected.includes(chart.id)} disabled={disabled} onChange={() => onToggle(chart.id)} /><span><strong>{chart.title}</strong>{reason ? ` · ${reason}` : ''}</span></label>;
  })}{!chartWidgets.length ? <span className="muted small">Add a chart before connecting a control.</span> : null}</div></div>;
}
