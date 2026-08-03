import { ListTree, RefreshCw } from 'lucide-react';
import type { QueryDraft } from '@shared/types';
import { Button, Callout, Field, Input, Select } from '../../components/ui';
import { ANALYSIS_TYPES } from '../../lib/query/validation';
import { FilterBuilder } from '../explorer/FilterBuilder';
import { FunnelBuilder } from '../explorer/FunnelBuilder';
import { MultiAnalysisBuilder } from '../explorer/MultiAnalysisBuilder';
import { OrderByBuilder } from '../explorer/OrderByBuilder';
import { TimeframePicker } from '../explorer/TimeframePicker';

const TARGET_ANALYSES = new Set(['count_unique', 'sum', 'average', 'minimum', 'maximum', 'median', 'percentile', 'select_unique', 'standard_deviation']);
const INTERVALS = ['', 'minutely', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const;

function defaultFunnel(collection?: string) {
  const eventCollection = collection?.trim() || '';
  return [
    { event_collection: eventCollection, actor_property: 'session.sessionId' },
    { event_collection: eventCollection, actor_property: 'session.sessionId' }
  ];
}

export function DashboardQueryBuilder({ query, onChange, collections, properties, schemaLoading, schemaError, onLoadCollections, onLoadProperties }: {
  query: QueryDraft;
  onChange(query: QueryDraft): void;
  collections: string[];
  properties: string[];
  schemaLoading: boolean;
  schemaError?: string;
  onLoadCollections(): void;
  onLoadProperties(collection: string): void;
}): JSX.Element {
  const patch = (next: Partial<QueryDraft>) => onChange({ ...query, ...next });
  const isFunnel = query.analysis_type === 'funnel';
  const isExtraction = query.analysis_type === 'extraction';
  const isMulti = query.analysis_type === 'multi_analysis';

  const changeAnalysis = (analysisType: string) => {
    const next: QueryDraft = { ...query, analysis_type: analysisType };
    if (analysisType === 'funnel') {
      next.steps = query.steps?.length ? query.steps : defaultFunnel(query.event_collection);
      delete next.event_collection;
      delete next.target_property;
      delete next.group_by;
      delete next.order_by;
      delete next.interval;
      delete next.limit;
      delete next.filters;
      delete next.zero_fill;
      delete next.latest;
      delete next.property_names;
      delete next.analyses;
    } else {
      next.event_collection ??= query.steps?.[0]?.event_collection ?? '';
      delete next.steps;
      if (analysisType === 'multi_analysis') {
        next.analyses ??= { total: { analysis_type: 'count' } };
        delete next.target_property;
      } else {
        delete next.analyses;
        if (!TARGET_ANALYSES.has(analysisType)) delete next.target_property;
      }
      if (analysisType === 'extraction') {
        delete next.group_by;
        delete next.order_by;
        delete next.interval;
        delete next.limit;
        delete next.zero_fill;
      }
    }
    onChange(next);
  };

  const groupText = Array.isArray(query.group_by)
    ? query.group_by.filter((value): value is string => typeof value === 'string').join(', ')
    : typeof query.group_by === 'string' ? query.group_by : '';

  return <div className="dashboard-query-builder stack">
    <section className="builder-section">
      <div className="builder-section__header"><div><strong>Data source</strong><span>Choose the analysis and stream. Schema choices load only when requested.</span></div><div className="row"><Button type="button" variant="secondary" loading={schemaLoading} onClick={onLoadCollections}><ListTree size={14} /> Load streams</Button>{!isFunnel ? <Button type="button" variant="secondary" loading={schemaLoading} disabled={!query.event_collection?.trim()} onClick={() => onLoadProperties(query.event_collection?.trim() ?? '')}><RefreshCw size={14} /> Load fields</Button> : null}</div></div>
      <datalist id="dashboard-collection-options">{collections.map((name) => <option key={name} value={name} />)}</datalist>
      <datalist id="explorer-collection-options">{collections.map((name) => <option key={name} value={name} />)}</datalist>
      <datalist id="explorer-property-options">{properties.map((name) => <option key={name} value={name} />)}</datalist>
      {schemaError ? <Callout tone="warning">{schemaError}</Callout> : null}
      <div className="form-grid form-grid--3">
        <Field label="Analysis" required><Select value={query.analysis_type} onChange={(event) => changeAnalysis(event.target.value)}>{ANALYSIS_TYPES.map((analysis) => <option key={analysis} value={analysis}>{analysis.replace(/_/g, ' ')}</option>)}</Select></Field>
        {!isFunnel ? <Field label="Event stream" required><Input list="dashboard-collection-options" value={query.event_collection ?? ''} onChange={(event) => patch({ event_collection: event.target.value })} placeholder="slack_stream" /></Field> : <div />}
        {TARGET_ANALYSES.has(query.analysis_type) ? <Field label="Target field" required><Input list="explorer-property-options" value={query.target_property ?? ''} onChange={(event) => patch({ target_property: event.target.value })} placeholder="session.dwellMs" /></Field> : <div />}
      </div>
      {query.analysis_type === 'percentile' ? <Field label="Percentile"><Input type="number" min="0" max="100" step="0.1" value={query.percentile ?? 95} onChange={(event) => patch({ percentile: Number(event.target.value) })} /></Field> : null}
    </section>

    {isFunnel ? <section className="builder-section"><div className="builder-section__header"><div><strong>Funnel steps</strong><span>Build the sequence visually; no request payload editing is required.</span></div></div><FunnelBuilder steps={query.steps ?? defaultFunnel()} onChange={(steps) => patch({ steps })} /></section> : isMulti ? <section className="builder-section"><div className="builder-section__header"><div><strong>Named analyses</strong><span>Combine several calculations in one query.</span></div></div><MultiAnalysisBuilder value={query.analyses} onChange={(analyses) => patch({ analyses })} /></section> : null}

    <section className="builder-section"><TimeframePicker value={query.timeframe} timezone={query.timezone} onChange={(timeframe, timezone) => patch({ timeframe, timezone })} label={isFunnel ? 'Shared funnel timeframe' : 'Timeframe'} /></section>

    {!isFunnel ? <section className="builder-section"><div className="builder-section__header"><div><strong>Filters</strong><span>Rows are combined with AND. OR groups can be nested visually.</span></div></div><FilterBuilder filters={query.filters ?? []} onChange={(filters) => patch({ filters })} /></section> : null}

    {!isFunnel && !isExtraction ? <section className="builder-section"><div className="builder-section__header"><div><strong>Breakdown and timeline</strong><span>Group, order, and interval controls are optional.</span></div></div><div className="form-grid form-grid--3">
      <Field label="Interval"><Select value={INTERVALS.includes((query.interval ?? '') as typeof INTERVALS[number]) ? query.interval ?? '' : 'custom'} onChange={(event) => patch({ interval: event.target.value === 'custom' ? 'every_2_hours' : event.target.value || undefined })}>{INTERVALS.map((interval) => <option key={interval || 'none'} value={interval}>{interval ? interval[0].toUpperCase() + interval.slice(1) : 'No interval'}</option>)}<option value="custom">Custom interval</option></Select></Field>
      {query.interval && !INTERVALS.includes(query.interval as typeof INTERVALS[number]) ? <Field label="Custom interval" hint="For example every_2_hours"><Input value={query.interval} onChange={(event) => patch({ interval: event.target.value || undefined })} /></Field> : null}
      <Field label="Group by fields" hint="Separate multiple fields with commas"><Input list="explorer-property-options" value={groupText} onChange={(event) => { const values = event.target.value.split(',').map((value) => value.trim()).filter(Boolean); patch({ group_by: values.length > 1 ? values : values[0] }); }} placeholder="session.gameId" /></Field>
      <Field label="Result limit"><Input type="number" min="1" value={query.limit ?? ''} onChange={(event) => patch({ limit: event.target.value ? Number(event.target.value) : undefined })} /></Field>
    </div><div className="stack stack--compact"><strong className="small">Order results</strong><OrderByBuilder value={query.order_by ?? []} onChange={(order_by) => patch({ order_by })} /></div><div className="row"><label className="checkbox-row"><input type="checkbox" checked={query.zero_fill ?? true} onChange={(event) => patch({ zero_fill: event.target.checked })} /><span>Fill missing intervals with zero</span></label><label className="checkbox-row"><input type="checkbox" checked={query.include_metadata ?? true} onChange={(event) => patch({ include_metadata: event.target.checked })} /><span>Include execution metadata</span></label></div></section> : null}

    {isExtraction ? <section className="builder-section"><div className="builder-section__header"><div><strong>Records</strong><span>Extraction charts use an accessible table.</span></div></div><div className="form-grid"><Field label="Latest records"><Input type="number" min="1" max="100000" value={query.latest ?? 100} onChange={(event) => patch({ latest: Number(event.target.value) })} /></Field><Field label="Fields" hint="Comma-separated; blank includes all"><Input value={query.property_names?.join(', ') ?? ''} onChange={(event) => patch({ property_names: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></Field></div></section> : null}
  </div>;
}
