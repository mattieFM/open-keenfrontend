import type { ChartWidget, DashboardDocument, DashboardWidget, DateRangeWidget, FilterWidget, ImageWidget, KeenTimeframe, QueryDraft, TextWidget } from '@shared/types';

const PALETTE = ['#6f5bd3', '#13b98a', '#2873d6', '#ef9f32', '#d94b72', '#3aa6a0', '#8b6fd9'];

export function createDashboard(workspaceId: string, title = 'Untitled dashboard'): DashboardDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    workspaceId,
    title,
    tags: [],
    widgets: [],
    layout: [],
    settings: { gridGap: 12, background: '#eef1f6', tileBackground: '#ffffff', tileRadius: 8 },
    theme: { palette: PALETTE },
    metadata: {},
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
}

export function defaultWidget(type: DashboardWidget['type']): DashboardWidget {
  const id = crypto.randomUUID();
  if (type === 'chart') {
    const query: QueryDraft = { analysis_type: 'count', event_collection: '', timeframe: 'this_30_days', interval: 'daily', include_metadata: true, zero_fill: true, filters: [] };
    return { id, type, title: 'New chart', subtitle: '', source: { kind: 'ad-hoc', query }, chartType: 'line', valueFormat: 'number', showTableFallback: true } satisfies ChartWidget;
  }
  if (type === 'text') return { id, type, markdown: '## Add context\n\nExplain what this dashboard shows.' } satisfies TextWidget;
  if (type === 'image') return { id, type, url: '', alt: '', fit: 'contain', caption: '' } satisfies ImageWidget;
  if (type === 'filter') return { id, type, title: 'Filter', eventCollection: '', propertyName: '', targetWidgetIds: [], options: [], selected: [], selectionMode: 'single', allowSearch: true, optionSource: 'manual' } satisfies FilterWidget;
  return { id, type, title: 'Date range', targetWidgetIds: [], timeframe: 'this_30_days', timezone: 'UTC' } satisfies DateRangeWidget;
}

export function addWidget(document: DashboardDocument, widget: DashboardWidget): DashboardDocument {
  const y = document.layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const defaultSize = widget.type === 'filter' || widget.type === 'date-range' ? { w: 4, h: 3 } : { w: 6, h: 6 };
  return touch({ ...document, widgets: [...document.widgets, widget], layout: [...document.layout, { i: widget.id, x: 0, y, ...defaultSize, minW: 2, minH: 2 }] });
}

export function updateWidget(document: DashboardDocument, widget: DashboardWidget): DashboardDocument {
  return touch({ ...document, widgets: document.widgets.map((item) => item.id === widget.id ? widget : item) });
}

export function removeWidget(document: DashboardDocument, id: string): DashboardDocument {
  return touch({
    ...document,
    widgets: document.widgets.filter((widget) => widget.id !== id).map((widget) => {
      if (widget.type === 'filter' || widget.type === 'date-range') return { ...widget, targetWidgetIds: widget.targetWidgetIds.filter((target) => target !== id) };
      return widget;
    }),
    layout: document.layout.filter((item) => item.i !== id)
  });
}

export function cloneWidget(document: DashboardDocument, id: string): DashboardDocument {
  const source = document.widgets.find((widget) => widget.id === id);
  if (!source || source.type === 'filter' || source.type === 'date-range') return document;
  const clone = structuredClone(source);
  clone.id = crypto.randomUUID();
  if (clone.type === 'chart') clone.title = `${clone.title} copy`;
  return addWidget(document, clone);
}

export function touch(document: DashboardDocument): DashboardDocument {
  return { ...document, revision: document.revision + 1, updatedAt: new Date().toISOString() };
}

export function migrateDashboard(value: unknown, workspaceId?: string): DashboardDocument {
  if (!value || typeof value !== 'object') throw new Error('Dashboard import must be a JSON object.');
  const record = value as Partial<DashboardDocument>;
  if (!Array.isArray(record.widgets) || !Array.isArray(record.layout)) throw new Error('Dashboard import is missing widgets or layout.');
  const base = createDashboard(workspaceId ?? record.workspaceId ?? 'imported');
  return {
    ...base,
    ...record,
    schemaVersion: 1,
    id: record.id ?? crypto.randomUUID(),
    workspaceId: workspaceId ?? record.workspaceId ?? 'imported',
    widgets: (record.widgets as DashboardWidget[]).map((widget) => widget.type === 'chart' ? { valueFormat: 'number', showTableFallback: true, ...widget } : widget.type === 'filter' ? { selectionMode: 'single', allowSearch: true, optionSource: 'manual', ...widget } : widget),
    layout: record.layout,
    settings: { ...base.settings, ...(record.settings ?? {}) },
    theme: { ...base.theme, ...(record.theme ?? {}) },
    metadata: record.metadata ?? {},
    revision: Number(record.revision ?? 1),
    createdAt: record.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function runtimeQuery(document: DashboardDocument, chart: ChartWidget, filterSelections: Record<string, string[]>, dateRanges: Record<string, KeenTimeframe | undefined>): QueryDraft | undefined {
  if (chart.source.kind !== 'ad-hoc') return undefined;
  const query = structuredClone(chart.source.query);
  const filters = [...(query.filters ?? [])];
  for (const widget of document.widgets) {
    if (widget.type !== 'filter' || !widget.targetWidgetIds.includes(chart.id)) continue;
    const selected = filterSelections[widget.id] ?? widget.selected;
    if (!selected.length) continue;
    filters.push({ property_name: widget.propertyName, operator: selected.length === 1 ? 'eq' : 'in', property_value: selected.length === 1 ? selected[0] : selected });
  }
  query.filters = filters;
  const dateWidget = document.widgets.find((widget): widget is DateRangeWidget => widget.type === 'date-range' && widget.targetWidgetIds.includes(chart.id));
  if (dateWidget) {
    const timeframe = dateRanges[dateWidget.id] ?? dateWidget.timeframe;
    query.timeframe = timeframe;
    if (typeof timeframe === 'object') delete query.timezone;
    else query.timezone = dateWidget.timezone;
  }
  return query;
}
