import type { ChartType, ChartWidget, CredentialMeta, DashboardDocument, DashboardLayoutItem, DashboardWidget, FilterWidget, KeenFilter, QueryDraft, WorkspaceRecord } from '@shared/types';
import type { KeenClient } from '../api/KeenClient';
import { db } from '../db/database';
import { createDashboard } from './model';
import { isNumericSchemaType, isStringSchemaType, parseCollectionDetail, parseCollectionList, schemaFingerprint, type StreamSchema } from '../schema/collections';

export const AUTO_DASHBOARD_TEMPLATE_VERSION = 4;

export type AutoDashboardMetadata = {
  key: string;
  templateVersion: number;
  kind: 'stream' | 'event-type';
  collection: string;
  eventType?: string;
  eventTypeProperty: string;
  schemaFingerprint: string;
  contentFingerprint: string;
  generatedAt: string;
};

export type AutoDashboardSyncSummary = {
  streams: number;
  eventTypes: number;
  created: number;
  refreshed: number;
  skipped: number;
  schemaDetailsLoaded: number;
  filterOptionSetsLoaded: number;
  warnings: string[];
};

export type AutoDashboardDimensionValues = Record<string, Record<string, string[]>>;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(scope: string, label: string): string {
  return `auto-${stableHash(`${scope}|${label}`)}`;
}

function filter(property_name: string, property_value: unknown): KeenFilter {
  return { property_name, operator: 'eq', property_value };
}

function filterOptionState(values: Record<string, string[]>, propertyName: string, fallback: string[] = []): Pick<FilterWidget, 'options' | 'optionSource'> {
  const discovered = values[propertyName] ?? [];
  const source = discovered.length ? discovered : fallback;
  return {
    options: [...new Set(source.map(String).map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 200),
    optionSource: discovered.length ? 'query' : 'manual'
  };
}

function query(collection: string, analysis_type: string, options: Partial<QueryDraft> = {}): QueryDraft {
  const definition: QueryDraft = {
    analysis_type,
    event_collection: collection,
    timeframe: 'this_30_days',
    include_metadata: true,
    filters: [],
    ...options
  };
  if (definition.interval && definition.zero_fill === undefined) definition.zero_fill = true;
  if (!definition.interval) delete definition.zero_fill;
  return definition;
}

function chart(scope: string, label: string, title: string, chartType: ChartType, definition: QueryDraft, options: Partial<ChartWidget> = {}): ChartWidget {
  return {
    id: stableId(scope, label),
    type: 'chart',
    title,
    source: { kind: 'ad-hoc', query: definition },
    chartType,
    showTableFallback: true,
    valueFormat: 'number',
    ...options
  };
}

function packWidgets(widgets: DashboardWidget[]): DashboardLayoutItem[] {
  const layout: DashboardLayoutItem[] = [];
  const groups = [
    widgets.filter((widget) => widget.type === 'text'),
    widgets.filter((widget) => widget.type === 'filter' || widget.type === 'date-range'),
    widgets.filter((widget) => widget.type === 'chart' && ['metric', 'gauge'].includes(widget.chartType)),
    widgets.filter((widget) => widget.type === 'chart' && !['metric', 'gauge'].includes(widget.chartType)),
    widgets.filter((widget) => widget.type === 'image')
  ];
  let y = 0;
  for (const group of groups) {
    let x = 0;
    let rowHeight = 0;
    for (const widget of group) {
      const size = widget.type === 'text' ? { w: 12, h: 3 }
        : widget.type === 'filter' || widget.type === 'date-range' ? { w: 3, h: 3 }
          : widget.type === 'chart' && ['metric', 'gauge'].includes(widget.chartType) ? { w: 3, h: 4 }
            : { w: 6, h: 6 };
      if (x + size.w > 12) { y += rowHeight; x = 0; rowHeight = 0; }
      layout.push({ i: widget.id, x, y, ...size, minW: widget.type === 'text' ? 4 : 2, minH: 2 });
      x += size.w;
      rowHeight = Math.max(rowHeight, size.h);
    }
    if (group.length) y += rowHeight;
  }
  return layout;
}

function autoDocument(workspaceId: string, schema: StreamSchema, kind: 'stream' | 'event-type', eventTypeProperty: string, eventType: string | undefined, title: string, widgets: DashboardWidget[], tags: string[]): DashboardDocument {
  const key = `${kind}:${schema.name}:${eventType ?? '*'}`;
  const base = createDashboard(workspaceId, title);
  const now = new Date().toISOString();
  const documentTags = [...new Set(['automatic', schema.name, ...tags])];
  const layout = packWidgets(widgets);
  const autoDashboard: AutoDashboardMetadata = {
    key,
    templateVersion: AUTO_DASHBOARD_TEMPLATE_VERSION,
    kind,
    collection: schema.name,
    eventType,
    eventTypeProperty,
    schemaFingerprint: schemaFingerprint(schema),
    contentFingerprint: stableHash(JSON.stringify({ title, tags: documentTags, widgets, layout, settings: base.settings, theme: base.theme })),
    generatedAt: now
  };
  return {
    ...base,
    id: stableId(workspaceId, key),
    title,
    tags: documentTags,
    widgets,
    layout,
    metadata: { autoDashboard },
    createdAt: now,
    updatedAt: now
  };
}

function sessionProfile(schema: StreamSchema, eventTypeProperty: string): boolean {
  const fields = new Set(Object.keys(schema.properties));
  return fields.has(eventTypeProperty) && fields.has('session.sessionId') && fields.has('session.eventId') && fields.has('session.gameId') && fields.has('session.machineId');
}

function eventFilter(eventTypeProperty: string, eventType?: string): KeenFilter[] {
  return eventType ? [filter(eventTypeProperty, eventType)] : [];
}

function sessionDashboard(workspaceId: string, schema: StreamSchema, eventTypeProperty: string, timeframe: string, timezone: string | number, dimensionValues: Record<string, string[]>): DashboardDocument {
  const scope = `${workspaceId}|${schema.name}|sessions`;
  const hasStatus = 'session.status' in schema.properties;
  const hasDwell = 'session.dwellMs' in schema.properties;
  const hasResult = 'session.result' in schema.properties;
  const charts: ChartWidget[] = [
    chart(scope, 'starts', 'Sessions started', 'metric', query(schema.name, 'count', { timeframe, filters: [filter(eventTypeProperty, 'session_start')] }), { valueFormat: 'compact' }),
    chart(scope, 'ends', 'Sessions ended', 'metric', query(schema.name, 'count', { timeframe, filters: [filter(eventTypeProperty, 'session_end')] }), { valueFormat: 'compact' }),
    chart(scope, 'started-over-time', 'Starts over time', 'line', query(schema.name, 'count', { timeframe, interval: 'daily', filters: [filter(eventTypeProperty, 'session_start')] })),
    chart(scope, 'games', 'Sessions by game', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.gameId', limit: 50, order_by: [{ property_name: 'result', direction: 'DESC' }], filters: [filter(eventTypeProperty, 'session_start')] })),
    chart(scope, 'machines', 'Sessions by machine', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.machineId', limit: 100, order_by: [{ property_name: 'result', direction: 'DESC' }], filters: [filter(eventTypeProperty, 'session_start')] })),
    chart(scope, 'events', 'Sessions by event', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.eventId', limit: 100, order_by: [{ property_name: 'result', direction: 'DESC' }], filters: [filter(eventTypeProperty, 'session_start')] })),
    chart(scope, 'completion-funnel', 'Start-to-end conversion', 'funnel', {
      analysis_type: 'funnel', timeframe, include_metadata: true,
      steps: [
        { event_collection: schema.name, actor_property: 'session.sessionId', filters: [filter(eventTypeProperty, 'session_start')] },
        { event_collection: schema.name, actor_property: 'session.sessionId', filters: [filter(eventTypeProperty, 'session_end')] }
      ]
    })
  ];
  if (hasStatus) {
    charts.splice(2, 0,
      chart(scope, 'completed', 'Completed', 'metric', query(schema.name, 'count', { timeframe, filters: [filter(eventTypeProperty, 'session_end'), filter('session.status', 'completed')] }), { valueFormat: 'compact' }),
      chart(scope, 'abandoned', 'Abandoned', 'metric', query(schema.name, 'count', { timeframe, filters: [filter(eventTypeProperty, 'session_end'), filter('session.status', 'abandoned')] }), { valueFormat: 'compact' })
    );
    charts.push(chart(scope, 'outcomes', 'Session outcomes', 'bar', query(schema.name, 'count', { timeframe, interval: 'daily', group_by: 'session.status', filters: [filter(eventTypeProperty, 'session_end')] })));
  }
  if (hasDwell) {
    charts.push(
      chart(scope, 'avg-dwell', 'Average session duration', 'metric', query(schema.name, 'average', { timeframe, target_property: 'session.dwellMs', filters: [filter(eventTypeProperty, 'session_end')] }), { valueFormat: 'duration-ms' }),
      chart(scope, 'dwell-trend', 'Average duration over time', 'line', query(schema.name, 'average', { timeframe, target_property: 'session.dwellMs', interval: 'daily', filters: [filter(eventTypeProperty, 'session_end')] }), { valueFormat: 'duration-ms' })
    );
  }
  if (hasResult) {
    const numeric = isNumericSchemaType(schema.properties['session.result']);
    charts.push(numeric
      ? chart(scope, 'results', 'Average result by game', 'bar', query(schema.name, 'average', { timeframe, target_property: 'session.result', group_by: 'session.gameId', filters: [filter(eventTypeProperty, 'session_end')] }))
      : chart(scope, 'results', 'Results reached', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.result', limit: 100, filters: [filter(eventTypeProperty, 'session_end')] })));
  }
  const chartIds = charts.map((item) => item.id);
  const nonFunnelIds = charts.filter((item) => item.source.kind === 'ad-hoc' && item.source.query.analysis_type !== 'funnel').map((item) => item.id);
  const endChartIds = charts.filter((item) => item.source.kind === 'ad-hoc'
    && item.source.query.filters?.some((candidate) => candidate.operator !== 'or' && candidate.property_name === eventTypeProperty && candidate.property_value === 'session_end')
    && !item.source.query.filters?.some((candidate) => candidate.operator !== 'or' && candidate.property_name === 'session.status')).map((item) => item.id);
  const controls: DashboardWidget[] = [
    { id: stableId(scope, 'date'), type: 'date-range', title: 'Dashboard range', targetWidgetIds: chartIds, timeframe, timezone },
    { id: stableId(scope, 'event-id-filter'), type: 'filter', title: 'Event', eventCollection: schema.name, propertyName: 'session.eventId', targetWidgetIds: nonFunnelIds, ...filterOptionState(dimensionValues, 'session.eventId', ['Builders Lab']), selected: [], selectionMode: 'multiple', allowSearch: true },
    { id: stableId(scope, 'machine-filter'), type: 'filter', title: 'Machine', eventCollection: schema.name, propertyName: 'session.machineId', targetWidgetIds: nonFunnelIds, ...filterOptionState(dimensionValues, 'session.machineId'), selected: [], selectionMode: 'multiple', allowSearch: true },
    { id: stableId(scope, 'game-filter'), type: 'filter', title: 'Game', eventCollection: schema.name, propertyName: 'session.gameId', targetWidgetIds: nonFunnelIds, ...filterOptionState(dimensionValues, 'session.gameId'), selected: [], selectionMode: 'multiple', allowSearch: true }
  ];
  if (hasStatus) controls.push({ id: stableId(scope, 'status-filter'), type: 'filter', title: 'Status', eventCollection: schema.name, propertyName: 'session.status', targetWidgetIds: endChartIds, options: ['completed', 'abandoned'], selected: [], selectionMode: 'multiple', allowSearch: false });
  const intro: DashboardWidget = { id: stableId(scope, 'intro'), type: 'text', markdown: `## ${schema.name} session analytics\n\nAutomatically generated for the shared session stream. Starts and ends are separated by **${eventTypeProperty}**; session identity uses **session.sessionId**. Edit any widget visually or regenerate the template from the dashboard list.` };
  return autoDocument(workspaceId, schema, 'stream', eventTypeProperty, undefined, `${schema.name} — Session overview`, [intro, ...controls, ...charts], ['sessions', 'overview']);
}


function sessionEventDashboard(workspaceId: string, schema: StreamSchema, eventTypeProperty: string, eventType: 'session_start' | 'session_end', timeframe: string, timezone: string | number, dimensionValues: Record<string, string[]>): DashboardDocument {
  const scope = `${workspaceId}|${schema.name}|${eventType}`;
  const baseFilters = [filter(eventTypeProperty, eventType)];
  const charts: ChartWidget[] = [
    chart(scope, 'total', eventType === 'session_start' ? 'Sessions started' : 'Sessions ended', 'metric', query(schema.name, 'count', { timeframe, filters: baseFilters }), { valueFormat: 'compact' }),
    chart(scope, 'unique-sessions', 'Unique sessions', 'metric', query(schema.name, 'count_unique', { timeframe, target_property: 'session.sessionId', filters: baseFilters }), { valueFormat: 'compact' }),
    chart(scope, 'timeline', eventType === 'session_start' ? 'Starts over time' : 'Ends over time', 'line', query(schema.name, 'count', { timeframe, interval: 'daily', filters: baseFilters })),
    chart(scope, 'games', 'By game', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.gameId', limit: 50, order_by: [{ property_name: 'result', direction: 'DESC' }], filters: baseFilters })),
    chart(scope, 'machines', 'By machine', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.machineId', limit: 100, order_by: [{ property_name: 'result', direction: 'DESC' }], filters: baseFilters })),
    chart(scope, 'events', 'By event', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.eventId', limit: 100, order_by: [{ property_name: 'result', direction: 'DESC' }], filters: baseFilters }))
  ];

  if (eventType === 'session_end') {
    if ('session.status' in schema.properties) {
      charts.splice(2, 0,
        chart(scope, 'completed', 'Completed', 'metric', query(schema.name, 'count', { timeframe, filters: [...baseFilters, filter('session.status', 'completed')] }), { valueFormat: 'compact' }),
        chart(scope, 'abandoned', 'Abandoned', 'metric', query(schema.name, 'count', { timeframe, filters: [...baseFilters, filter('session.status', 'abandoned')] }), { valueFormat: 'compact' })
      );
      charts.push(chart(scope, 'outcomes', 'Completion outcomes', 'bar', query(schema.name, 'count', { timeframe, interval: 'daily', group_by: 'session.status', filters: baseFilters })));
    }
    if ('session.dwellMs' in schema.properties) {
      charts.push(
        chart(scope, 'average-duration', 'Average duration', 'metric', query(schema.name, 'average', { timeframe, target_property: 'session.dwellMs', filters: baseFilters }), { valueFormat: 'duration-ms' }),
        chart(scope, 'duration-trend', 'Duration over time', 'line', query(schema.name, 'average', { timeframe, target_property: 'session.dwellMs', interval: 'daily', filters: baseFilters }), { valueFormat: 'duration-ms' })
      );
    }
    if ('session.result' in schema.properties) {
      const numeric = isNumericSchemaType(schema.properties['session.result']);
      charts.push(numeric
        ? chart(scope, 'result-by-game', 'Average result by game', 'bar', query(schema.name, 'average', { timeframe, target_property: 'session.result', group_by: 'session.gameId', filters: baseFilters }))
        : chart(scope, 'results', 'Results reached', 'bar', query(schema.name, 'count', { timeframe, group_by: 'session.result', limit: 100, filters: baseFilters })));
    }
  }

  const chartIds = charts.map((item) => item.id);
  const statusTargetIds = charts.filter((item) => item.source.kind === 'ad-hoc'
    && !item.source.query.filters?.some((candidate) => candidate.operator !== 'or' && candidate.property_name === 'session.status')).map((item) => item.id);
  const controls: DashboardWidget[] = [
    { id: stableId(scope, 'date'), type: 'date-range', title: 'Dashboard range', targetWidgetIds: chartIds, timeframe, timezone },
    { id: stableId(scope, 'event-filter'), type: 'filter', title: 'Event', eventCollection: schema.name, propertyName: 'session.eventId', targetWidgetIds: chartIds, ...filterOptionState(dimensionValues, 'session.eventId', ['Builders Lab']), selected: [], selectionMode: 'multiple', allowSearch: true },
    { id: stableId(scope, 'game-filter'), type: 'filter', title: 'Game', eventCollection: schema.name, propertyName: 'session.gameId', targetWidgetIds: chartIds, ...filterOptionState(dimensionValues, 'session.gameId'), selected: [], selectionMode: 'multiple', allowSearch: true },
    { id: stableId(scope, 'machine-filter'), type: 'filter', title: 'Machine', eventCollection: schema.name, propertyName: 'session.machineId', targetWidgetIds: chartIds, ...filterOptionState(dimensionValues, 'session.machineId'), selected: [], selectionMode: 'multiple', allowSearch: true }
  ];
  if (eventType === 'session_end' && 'session.status' in schema.properties) {
    controls.push({ id: stableId(scope, 'status-filter'), type: 'filter', title: 'Status', eventCollection: schema.name, propertyName: 'session.status', targetWidgetIds: statusTargetIds, options: ['completed', 'abandoned'], selected: [], selectionMode: 'multiple', allowSearch: false });
  }
  const description = eventType === 'session_start'
    ? 'Starts are grouped by game, machine, and event. Session identity uses **session.sessionId**.'
    : 'Ends include completion status, dwell time, result, game, machine, and event analytics when those fields are present.';
  const intro: DashboardWidget = { id: stableId(scope, 'intro'), type: 'text', markdown: `## ${eventType}\n\n${description} Every widget can be edited through the visual dashboard builder.` };
  return autoDocument(workspaceId, schema, 'event-type', eventTypeProperty, eventType, `${schema.name} — ${eventType}`, [intro, ...controls, ...charts], ['event-type', eventType, 'sessions']);
}

function eventTypeDashboard(workspaceId: string, schema: StreamSchema, eventTypeProperty: string, eventType: string, timeframe: string, timezone: string | number, dimensionValues: Record<string, string[]>): DashboardDocument {
  const scope = `${workspaceId}|${schema.name}|${eventType}`;
  const baseFilters = eventFilter(eventTypeProperty, eventType);
  const stringFields = Object.entries(schema.properties).filter(([name, type]) => name !== eventTypeProperty && name !== 'keen.timestamp' && isStringSchemaType(type)).map(([name]) => name);
  const numericFields = Object.entries(schema.properties).filter(([, type]) => isNumericSchemaType(type)).map(([name]) => name);
  const charts: ChartWidget[] = [
    chart(scope, 'total', 'Total events', 'metric', query(schema.name, 'count', { timeframe, filters: baseFilters }), { valueFormat: 'compact' }),
    chart(scope, 'unique-sessions', 'Unique sessions', 'metric', query(schema.name, 'count_unique', { timeframe, target_property: schema.properties['session.sessionId'] ? 'session.sessionId' : stringFields[0], filters: baseFilters }), { valueFormat: 'compact' }),
    chart(scope, 'timeline', 'Events over time', 'line', query(schema.name, 'count', { timeframe, interval: 'daily', filters: baseFilters }))
  ].filter((item) => item.source.kind !== 'ad-hoc' || item.source.query.analysis_type !== 'count_unique' || Boolean(item.source.query.target_property));
  for (const field of stringFields.slice(0, 4)) charts.push(chart(scope, `group-${field}`, `By ${field}`, 'bar', query(schema.name, 'count', { timeframe, group_by: field, limit: 50, order_by: [{ property_name: 'result', direction: 'DESC' }], filters: baseFilters })));
  for (const field of numericFields.slice(0, 2)) charts.push(chart(scope, `average-${field}`, `Average ${field}`, 'metric', query(schema.name, 'average', { timeframe, target_property: field, filters: baseFilters }), { valueFormat: field.toLowerCase().includes('ms') ? 'duration-ms' : 'number' }));
  const chartIds = charts.map((item) => item.id);
  const controls: DashboardWidget[] = [
    { id: stableId(scope, 'date'), type: 'date-range', title: 'Dashboard range', targetWidgetIds: chartIds, timeframe, timezone },
    ...stringFields.slice(0, 3).map<FilterWidget>((field) => ({ id: stableId(scope, `filter-${field}`), type: 'filter', title: field.split('.').at(-1) ?? field, eventCollection: schema.name, propertyName: field, targetWidgetIds: chartIds, ...filterOptionState(dimensionValues, field, field === 'session.status' ? ['completed', 'abandoned'] : field === 'session.eventId' ? ['Builders Lab'] : []), selected: [], selectionMode: 'multiple', allowSearch: true }))
  ];
  const intro: DashboardWidget = { id: stableId(scope, 'intro'), type: 'text', markdown: `## ${eventType}\n\nAutomatically generated from **${schema.name}** where **${eventTypeProperty} = ${eventType}**.` };
  return autoDocument(workspaceId, schema, 'event-type', eventTypeProperty, eventType, `${schema.name} — ${eventType}`, [intro, ...controls, ...charts], ['event-type', eventType]);
}

function genericStreamDashboard(workspaceId: string, schema: StreamSchema, eventTypeProperty: string, timeframe: string, timezone: string | number, dimensionValues: Record<string, string[]>): DashboardDocument {
  const scope = `${workspaceId}|${schema.name}|overview`;
  const stringFields = Object.entries(schema.properties).filter(([name, type]) => !['keen.timestamp', eventTypeProperty].includes(name) && isStringSchemaType(type)).map(([name]) => name);
  const numericFields = Object.entries(schema.properties).filter(([, type]) => isNumericSchemaType(type)).map(([name]) => name);
  const charts: ChartWidget[] = [
    chart(scope, 'total', 'Total events', 'metric', query(schema.name, 'count', { timeframe }), { valueFormat: 'compact' }),
    chart(scope, 'timeline', 'Event volume', 'line', query(schema.name, 'count', { timeframe, interval: 'daily' }))
  ];
  for (const field of stringFields.slice(0, 4)) charts.push(chart(scope, `group-${field}`, `By ${field}`, 'bar', query(schema.name, 'count', { timeframe, group_by: field, limit: 50, order_by: [{ property_name: 'result', direction: 'DESC' }] })));
  for (const field of numericFields.slice(0, 2)) charts.push(chart(scope, `average-${field}`, `Average ${field}`, 'metric', query(schema.name, 'average', { timeframe, target_property: field }), { valueFormat: field.toLowerCase().includes('ms') ? 'duration-ms' : 'number' }));
  const chartIds = charts.map((item) => item.id);
  const controls: DashboardWidget[] = [
    { id: stableId(scope, 'date'), type: 'date-range', title: 'Dashboard range', targetWidgetIds: chartIds, timeframe, timezone },
    ...stringFields.slice(0, 3).map<FilterWidget>((field) => ({ id: stableId(scope, `filter-${field}`), type: 'filter', title: field.split('.').at(-1) ?? field, eventCollection: schema.name, propertyName: field, targetWidgetIds: chartIds, ...filterOptionState(dimensionValues, field), selected: [], selectionMode: 'multiple', allowSearch: true }))
  ];
  const intro: DashboardWidget = { id: stableId(scope, 'intro'), type: 'text', markdown: `## ${schema.name}\n\nThis dashboard was generated automatically from the stream schema. Use **Edit** on any widget to choose fields, filters, chart types, and formatting through the visual builder.` };
  return autoDocument(workspaceId, schema, 'stream', eventTypeProperty, undefined, `${schema.name} — Overview`, [intro, ...controls, ...charts], ['overview']);
}

export function buildAutomaticDashboards(workspaceId: string, schemas: StreamSchema[], eventTypes: Record<string, string[]> = {}, options?: { eventTypeProperty?: string; timeframe?: string; timezone?: string | number; dimensionValues?: AutoDashboardDimensionValues }): DashboardDocument[] {
  const eventTypeProperty = options?.eventTypeProperty?.trim() || 'eventType';
  const timeframe = options?.timeframe?.trim() || 'this_30_days';
  const timezone = options?.timezone ?? 'UTC';
  const documents: DashboardDocument[] = [];
  for (const schema of schemas) {
    const dimensionValues = options?.dimensionValues?.[schema.name] ?? {};
    const session = sessionProfile(schema, eventTypeProperty);
    documents.push(session
      ? sessionDashboard(workspaceId, schema, eventTypeProperty, timeframe, timezone, dimensionValues)
      : genericStreamDashboard(workspaceId, schema, eventTypeProperty, timeframe, timezone, dimensionValues));
    const values = session ? ['session_start', 'session_end'] : eventTypes[schema.name] ?? [];
    for (const value of [...new Set(values)].slice(0, 50)) {
      documents.push(session && (value === 'session_start' || value === 'session_end')
        ? sessionEventDashboard(workspaceId, schema, eventTypeProperty, value, timeframe, timezone, dimensionValues)
        : eventTypeDashboard(workspaceId, schema, eventTypeProperty, value, timeframe, timezone, dimensionValues));
    }
  }
  return documents;
}

function getAutoMetadata(document: DashboardDocument): AutoDashboardMetadata | undefined {
  const value = document.metadata.autoDashboard;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Partial<AutoDashboardMetadata>;
  return typeof record.key === 'string' && typeof record.collection === 'string' ? record as AutoDashboardMetadata : undefined;
}

export function previousAutomaticDashboardQueryValues(documents: DashboardDocument[]): AutoDashboardDimensionValues {
  const values: AutoDashboardDimensionValues = {};
  for (const document of documents) {
    if (!getAutoMetadata(document)) continue;
    for (const widget of document.widgets) {
      if (widget.type !== 'filter' || widget.optionSource !== 'query' || !widget.options.length) continue;
      const collectionValues = values[widget.eventCollection] ??= {};
      collectionValues[widget.propertyName] = [...new Set([
        ...(collectionValues[widget.propertyName] ?? []),
        ...widget.options.map(String).map((value) => value.trim()).filter(Boolean)
      ])].sort((a, b) => a.localeCompare(b)).slice(0, 200);
    }
  }
  return values;
}

export type AutoDashboardWriteDecision = 'create' | 'refresh' | 'preserve';

export function automaticDashboardWriteDecision(current: DashboardDocument | undefined, generated: DashboardDocument, forceRefresh = false): AutoDashboardWriteDecision {
  if (!current) return 'create';
  if (forceRefresh) return 'refresh';
  const currentMetadata = getAutoMetadata(current);
  const generatedMetadata = getAutoMetadata(generated);
  if (!currentMetadata || !generatedMetadata) return 'preserve';
  const generatedDocumentWasEdited = current.updatedAt !== currentMetadata.generatedAt;
  const generatedContentChanged = currentMetadata.templateVersion !== generatedMetadata.templateVersion
    || currentMetadata.schemaFingerprint !== generatedMetadata.schemaFingerprint
    || currentMetadata.contentFingerprint !== generatedMetadata.contentFingerprint;
  return generatedContentChanged && !generatedDocumentWasEdited ? 'refresh' : 'preserve';
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next; next += 1;
      results[index] = await task(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function syncAutomaticDashboards({ workspace, client, schemaCredential, queryCredential, refreshExisting = false }: {
  workspace: WorkspaceRecord;
  client: KeenClient;
  schemaCredential: CredentialMeta;
  queryCredential?: CredentialMeta;
  refreshExisting?: boolean;
}): Promise<AutoDashboardSyncSummary> {
  const warnings: string[] = [];
  const response = await client.listCollections(schemaCredential, true);
  let schemas = parseCollectionList(response.data);
  let schemaDetailsLoaded = 0;
  const missing = schemas.filter((schema) => Object.keys(schema.properties).length === 0);
  const detailCandidates = missing.slice(0, 200);
  if (missing.length > detailCandidates.length) warnings.push(`Detailed schema enrichment was capped at ${detailCandidates.length} of ${missing.length} streams; every stream still received a generic overview.`);
  if (detailCandidates.length) {
    const details = await mapWithConcurrency(detailCandidates, Math.max(1, Math.min(4, workspace.preferences.queryConcurrency || 4)), async (schema) => {
      try { const detail = parseCollectionDetail((await client.getCollection(schemaCredential, schema.name)).data, schema.name); schemaDetailsLoaded += 1; return detail; }
      catch (caught) { warnings.push(`Could not load detailed schema for ${schema.name}: ${caught instanceof Error ? caught.message : String(caught)}`); return schema; }
    });
    const byName = new Map(schemas.map((schema) => [schema.name, schema]));
    for (const detail of details) byName.set(detail.name, detail);
    schemas = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const existing = await db.dashboards.where('workspaceId').equals(workspace.id).toArray();
  const eventTypeProperty = workspace.preferences.autoDashboardEventTypeProperty?.trim() || 'eventType';
  const eventTypes: Record<string, string[]> = {};
  // Retain the last successful query-backed choices when a later discovery request
  // is denied, rate-limited, or temporarily offline. Successful empty responses still
  // replace the old values, because they are an authoritative current result.
  const dimensionValues = previousAutomaticDashboardQueryValues(existing);
  let filterOptionSetsLoaded = 0;
  if (queryCredential) {
    const sessionSchemas = schemas.filter((schema) => sessionProfile(schema, eventTypeProperty));
    const sessionCandidates = sessionSchemas.slice(0, 15);
    if (sessionSchemas.length > sessionCandidates.length) warnings.push(`Automatic Event, Machine, and Game filter lookup was capped at ${sessionCandidates.length} session streams to stay below Keen's documented project query-rate limit.`);
    await mapWithConcurrency(sessionCandidates, 3, async (schema) => {
      const valuesByProperty: Record<string, string[]> = {};
      for (const property of ['session.eventId', 'session.machineId', 'session.gameId']) {
        if (!(property in schema.properties)) continue;
        try {
          const result = await client.runQuery(queryCredential, { analysis_type: 'select_unique', event_collection: schema.name, target_property: property, timeframe: 'this_90_days', limit: 200 });
          const values = (result.data as { result?: unknown }).result;
          if (!Array.isArray(values)) continue;
          valuesByProperty[property] = [...new Set(values.filter((value) => ['string', 'number', 'boolean'].includes(typeof value)).map(String))].sort((a, b) => a.localeCompare(b)).slice(0, 200);
          filterOptionSetsLoaded += 1;
        } catch (caught) { warnings.push(`Filter choices for ${schema.name}.${property} could not be loaded: ${caught instanceof Error ? caught.message : String(caught)}`); }
      }
      if (Object.keys(valuesByProperty).length) dimensionValues[schema.name] = { ...(dimensionValues[schema.name] ?? {}), ...valuesByProperty };
    });

    const eventTypeSchemas = schemas.filter((schema) => eventTypeProperty in schema.properties && !sessionProfile(schema, eventTypeProperty));
    const discoverable = eventTypeSchemas.slice(0, 100);
    if (eventTypeSchemas.length > discoverable.length) warnings.push('Event-type discovery was capped at 100 streams for this sync to protect the project query limit.');
    await mapWithConcurrency(discoverable, 3, async (schema) => {
      try {
        const result = await client.runQuery(queryCredential, { analysis_type: 'select_unique', event_collection: schema.name, target_property: eventTypeProperty, timeframe: 'this_90_days', limit: 100 });
        const values = (result.data as { result?: unknown }).result;
        if (Array.isArray(values)) eventTypes[schema.name] = [...new Set(values.filter((value) => ['string', 'number', 'boolean'].includes(typeof value)).map(String))].sort((a, b) => a.localeCompare(b)).slice(0, 50);
      } catch (caught) { warnings.push(`Event-type discovery was skipped for ${schema.name}: ${caught instanceof Error ? caught.message : String(caught)}`); }
    });
  }

  const generated = buildAutomaticDashboards(workspace.id, schemas, eventTypes, {
    eventTypeProperty,
    timeframe: workspace.preferences.autoDashboardTimeframe || 'this_30_days',
    timezone: workspace.preferences.defaultTimezone || 'UTC',
    dimensionValues
  });
  const existingByKey = new Map(existing.map((document) => [getAutoMetadata(document)?.key, document] as const).filter((entry): entry is [string, DashboardDocument] => Boolean(entry[0])));
  const writes: DashboardDocument[] = [];
  let created = 0; let refreshed = 0; let skipped = 0; let customizedOutdated = 0;
  for (const document of generated) {
    const metadata = getAutoMetadata(document);
    if (!metadata) continue;
    const current = existingByKey.get(metadata.key);
    const decision = automaticDashboardWriteDecision(current, document, refreshExisting);
    if (decision === 'create') { writes.push(document); created += 1; continue; }
    if (decision === 'preserve') {
      skipped += 1;
      const currentMetadata = current ? getAutoMetadata(current) : undefined;
      if (current && currentMetadata && current.updatedAt !== currentMetadata.generatedAt
        && (currentMetadata.templateVersion !== metadata.templateVersion
          || currentMetadata.schemaFingerprint !== metadata.schemaFingerprint
          || currentMetadata.contentFingerprint !== metadata.contentFingerprint)) customizedOutdated += 1;
      continue;
    }
    if (!current) continue;
    writes.push({ ...document, id: current.id, createdAt: current.createdAt, revision: current.revision + 1, metadata: { ...current.metadata, ...document.metadata } });
    refreshed += 1;
  }
  if (customizedOutdated) warnings.push(`${customizedOutdated} customized automatic dashboard${customizedOutdated === 1 ? '' : 's'} were preserved even though their schema or template changed. Use Refresh automatic to rebuild them intentionally.`);
  if (writes.length) await db.dashboards.bulkPut(writes);
  return { streams: schemas.length, eventTypes: Object.values(eventTypes).reduce((sum, values) => sum + values.length, 0) + schemas.filter((schema) => sessionProfile(schema, eventTypeProperty)).length * 2, created, refreshed, skipped, schemaDetailsLoaded, filterOptionSetsLoaded, warnings };
}

export function autoDashboardMetadata(document: DashboardDocument): AutoDashboardMetadata | undefined {
  return getAutoMetadata(document);
}
