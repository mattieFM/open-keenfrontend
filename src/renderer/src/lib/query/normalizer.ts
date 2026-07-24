import type { ChartType, QueryDraft, SemanticResult } from '@shared/types';

export function normalizeResult(payload: unknown, query: QueryDraft): SemanticResult {
  const result = payload && typeof payload === 'object' && 'result' in payload
    ? (payload as Record<string, unknown>).result
    : payload;

  if (query.analysis_type === 'funnel' && Array.isArray(result) && result.every((value) => typeof value === 'number')) {
    return { kind: 'funnel', values: result };
  }
  if (query.analysis_type === 'multi_analysis' && result && typeof result === 'object' && !Array.isArray(result)) {
    return { kind: 'multi', values: result as Record<string, unknown> };
  }
  if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean' || result === null) {
    return { kind: 'scalar', value: result };
  }
  if (Array.isArray(result)) {
    if (query.analysis_type === 'extraction' && result.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
      return { kind: 'records', rows: result as Array<Record<string, unknown>> };
    }
    if (query.analysis_type === 'select_unique') return { kind: 'unique', values: result };
    if (result.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
      const rows = result as Array<Record<string, unknown>>;
      if (rows.some((row) => 'timeframe' in row && 'value' in row)) return { kind: 'interval', rows };
      return { kind: 'grouped', rows };
    }
  }
  return { kind: 'unknown', value: result };
}

const VALUE_KEYS = new Set(['result', 'value', 'timeframe']);

function numericFields(rows: Array<Record<string, unknown>>): string[] {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return keys.filter((key) => rows.some((row) => typeof row[key] === 'number' && Number.isFinite(row[key] as number)));
}

function groupFields(rows: Array<Record<string, unknown>>): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !VALUE_KEYS.has(key))))];
}

export function supportedCharts(result: SemanticResult): ChartType[] {
  switch (result.kind) {
    case 'scalar': return typeof result.value === 'number' ? ['metric', 'gauge', 'table'] : ['table'];
    case 'interval': return ['line', 'area', 'bar', 'table'];
    case 'grouped': {
      const groups = groupFields(result.rows);
      const numerics = numericFields(result.rows);
      const charts: ChartType[] = ['bar', 'pie', 'donut'];
      if (groups.length >= 2) charts.push('heatmap');
      if (numerics.filter((key) => !['result', 'value'].includes(key)).length >= 2) charts.push('bubble');
      charts.push('table');
      return charts;
    }
    case 'records': {
      const charts: ChartType[] = [];
      if (numericFields(result.rows).length >= 3) charts.push('bubble');
      charts.push('table');
      return charts;
    }
    case 'funnel': return ['funnel', 'bar', 'table'];
    case 'unique':
    case 'multi':
    case 'unknown':
      return ['table'];
  }
}

export function chartCompatibilityReason(result: SemanticResult, chart: ChartType): string | undefined {
  if (supportedCharts(result).includes(chart)) return undefined;
  if (chart === 'choropleth') return 'Choropleth requires an explicitly registered GeoJSON map and a geographic identifier mapping. No map is bundled, so the table fallback prevents misleading geography.';
  if (chart === 'heatmap') return 'Heatmap requires at least two grouped dimensions plus a numeric result.';
  if (chart === 'bubble') return 'Bubble requires at least three numeric dimensions, or two numeric grouped dimensions plus the result.';
  if (chart === 'metric' || chart === 'gauge') return 'Metric and gauge require a single numeric scalar.';
  if (chart === 'funnel') return 'Funnel visualization requires a funnel result.';
  if (chart === 'line' || chart === 'area') return 'Line and area charts require an interval result.';
  if (chart === 'pie' || chart === 'donut' || chart === 'bar') return 'This chart requires a grouped, interval, or funnel-compatible result.';
  return 'This visualization is incompatible with the returned semantic result shape.';
}

export function defaultChart(result: SemanticResult): ChartType {
  return supportedCharts(result)[0] ?? 'table';
}
