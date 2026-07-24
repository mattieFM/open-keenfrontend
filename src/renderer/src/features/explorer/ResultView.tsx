import { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Braces, Download, FileImage, FileJson, Table2 } from 'lucide-react';
import type { ChartType, KeenResponse, QueryDraft, SemanticResult } from '@shared/types';
import { buildSafeCurl } from '@shared/url';
import { Badge, Button, Callout, Card, EmptyState } from '../../components/ui';
import { chartCompatibilityReason, normalizeResult, supportedCharts } from '../../lib/query/normalizer';
import { semanticResultToRows, toCsv } from '../../lib/query/csv';

const ALL_CHARTS: ChartType[] = ['metric', 'gauge', 'line', 'area', 'bar', 'pie', 'donut', 'funnel', 'heatmap', 'bubble', 'choropleth', 'table'];
const VALUE_KEYS = new Set(['result', 'value', 'timeframe']);

function valueFromRow(row: Record<string, unknown>): number {
  const value = row.result ?? row.value;
  return typeof value === 'number' ? value : Number(value ?? 0);
}
function groupFields(rows: Array<Record<string, unknown>>): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row).filter((name) => !VALUE_KEYS.has(name))))];
}
function numericFields(rows: Array<Record<string, unknown>>): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => rows.some((row) => typeof row[key] === 'number' && Number.isFinite(row[key] as number)));
}
function groupLabel(row: Record<string, unknown>): string {
  const key = Object.keys(row).find((name) => !VALUE_KEYS.has(name));
  return key ? String(row[key]) : 'Result';
}
function intervalLabel(row: Record<string, unknown>): string {
  const timeframe = row.timeframe;
  if (timeframe && typeof timeframe === 'object' && 'start' in timeframe) {
    const date = new Date(String((timeframe as Record<string, unknown>).start));
    return Number.isNaN(date.getTime()) ? String((timeframe as Record<string, unknown>).start) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return String(row.timeframe ?? 'Interval');
}
function summaryFor(result: SemanticResult): string {
  switch (result.kind) {
    case 'scalar': return `One scalar result: ${String(result.value ?? 'null')}.`;
    case 'grouped': return `${result.rows.length.toLocaleString()} grouped result rows.`;
    case 'interval': return `${result.rows.length.toLocaleString()} time intervals.`;
    case 'records': return `${result.rows.length.toLocaleString()} extracted records.`;
    case 'unique': return `${result.values.length.toLocaleString()} unique values.`;
    case 'funnel': return `${result.values.length} funnel steps, ending at ${String(result.values.at(-1) ?? 0)} actors.`;
    case 'multi': return `${Object.keys(result.values).length} named analysis results.`;
    case 'unknown': return 'The response shape is preserved but not recognized for charting.';
  }
}

export function chartOption(result: SemanticResult, chartType: ChartType, title: string): Record<string, unknown> {
  const base = {
    animationDuration: 350,
    textStyle: { fontFamily: 'Inter, ui-sans-serif, sans-serif', color: '#3b4668' },
    color: ['#6f5bd3', '#13b98a', '#2873d6', '#ef9f32', '#d94b72', '#3aa6a0', '#8b6fd9'],
    tooltip: { trigger: chartType === 'pie' || chartType === 'donut' || chartType === 'funnel' ? 'item' : 'axis' },
    grid: { left: 52, right: 24, top: 28, bottom: 52, containLabel: true }
  };
  if (result.kind === 'scalar') {
    const value = typeof result.value === 'number' ? result.value : Number(result.value ?? 0);
    if (chartType === 'gauge') return { ...base, series: [{ type: 'gauge', progress: { show: true, width: 14 }, axisLine: { lineStyle: { width: 14 } }, axisTick: { show: false }, splitLine: { length: 8 }, axisLabel: { distance: 20 }, detail: { valueAnimation: true, formatter: '{value}' }, data: [{ value, name: title }] }] };
    return {};
  }
  if (result.kind === 'funnel') {
    if (chartType === 'bar') return { ...base, xAxis: { type: 'category', data: result.values.map((_, index) => `Step ${index + 1}`) }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: result.values }] };
    return { ...base, series: [{ type: 'funnel', left: '10%', right: '10%', top: 20, bottom: 20, minSize: '28%', maxSize: '100%', sort: 'none', gap: 3, label: { show: true, formatter: '{b}: {c}' }, data: result.values.map((value, index) => ({ name: `Step ${index + 1}`, value })) }] };
  }
  if (result.kind === 'grouped') {
    if (chartType === 'heatmap') {
      const fields = groupFields(result.rows).slice(0, 2);
      const x = [...new Set(result.rows.map((row) => String(row[fields[0]] ?? '')))].sort();
      const y = [...new Set(result.rows.map((row) => String(row[fields[1]] ?? '')))].sort();
      const values = result.rows.map((row) => [x.indexOf(String(row[fields[0]] ?? '')), y.indexOf(String(row[fields[1]] ?? '')), valueFromRow(row)]);
      const max = Math.max(0, ...values.map((item) => Number(item[2])));
      return { ...base, tooltip: { position: 'top' }, xAxis: { type: 'category', data: x, splitArea: { show: true } }, yAxis: { type: 'category', data: y, splitArea: { show: true } }, visualMap: { min: 0, max: max || 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0 }, series: [{ name: title, type: 'heatmap', data: values, label: { show: values.length <= 80 }, emphasis: { itemStyle: { shadowBlur: 10 } } }] };
    }
    if (chartType === 'bubble') {
      const fields = numericFields(result.rows).filter((key) => !['result', 'value'].includes(key)).slice(0, 2);
      const values = result.rows.map((row) => [Number(row[fields[0]]), Number(row[fields[1]]), Math.max(0, valueFromRow(row)), groupLabel(row)]);
      const maxSize = Math.max(1, ...values.map((item) => Number(item[2])));
      return { ...base, tooltip: { formatter: (params: { value: unknown[] }) => `${String(params.value[3])}<br/>${fields[0]}: ${String(params.value[0])}<br/>${fields[1]}: ${String(params.value[1])}<br/>result: ${String(params.value[2])}` }, xAxis: { type: 'value', name: fields[0] }, yAxis: { type: 'value', name: fields[1] }, series: [{ type: 'scatter', data: values, symbolSize: (value: unknown[]) => 10 + 48 * Math.sqrt(Number(value[2]) / maxSize) }] };
    }
    const data = result.rows.map((row) => ({ name: groupLabel(row), value: valueFromRow(row) }));
    if (chartType === 'pie' || chartType === 'donut') return { ...base, legend: { type: 'scroll', bottom: 0 }, series: [{ type: 'pie', radius: chartType === 'donut' ? ['42%', '70%'] : ['0%', '70%'], center: ['50%', '45%'], data, label: { formatter: '{b}\n{d}%' } }] };
    return { ...base, xAxis: { type: 'category', data: data.map((item) => item.name), axisLabel: { interval: 0, rotate: data.length > 8 ? 35 : 0 } }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: data.map((item) => item.value), barMaxWidth: 54, itemStyle: { borderRadius: [4, 4, 0, 0] } }] };
  }
  if (result.kind === 'records' && chartType === 'bubble') {
    const fields = numericFields(result.rows).slice(0, 3);
    const values = result.rows.map((row, index) => [Number(row[fields[0]]), Number(row[fields[1]]), Math.max(0, Number(row[fields[2]])), `Row ${index + 1}`]);
    const maxSize = Math.max(1, ...values.map((item) => Number(item[2])));
    return { ...base, tooltip: { formatter: (params: { value: unknown[] }) => `${String(params.value[3])}<br/>${fields[0]}: ${String(params.value[0])}<br/>${fields[1]}: ${String(params.value[1])}<br/>${fields[2]}: ${String(params.value[2])}` }, xAxis: { type: 'value', name: fields[0] }, yAxis: { type: 'value', name: fields[1] }, series: [{ type: 'scatter', data: values, symbolSize: (value: unknown[]) => 10 + 48 * Math.sqrt(Number(value[2]) / maxSize) }] };
  }
  if (result.kind === 'interval') {
    const firstValue = result.rows[0]?.value;
    if (Array.isArray(firstValue)) {
      const seriesNames = [...new Set(result.rows.flatMap((row) => (Array.isArray(row.value) ? row.value : []).map((item) => item && typeof item === 'object' ? groupLabel(item as Record<string, unknown>) : 'Result')))];
      return { ...base, legend: { type: 'scroll', bottom: 0 }, xAxis: { type: 'category', boundaryGap: chartType === 'bar', data: result.rows.map(intervalLabel) }, yAxis: { type: 'value' }, series: seriesNames.map((name) => ({ name, type: chartType === 'bar' ? 'bar' : 'line', areaStyle: chartType === 'area' ? {} : undefined, smooth: true, showSymbol: false, data: result.rows.map((row) => { const item = (Array.isArray(row.value) ? row.value : []).find((candidate) => candidate && typeof candidate === 'object' && groupLabel(candidate as Record<string, unknown>) === name) as Record<string, unknown> | undefined; return item ? valueFromRow(item) : 0; }) })) };
    }
    return { ...base, xAxis: { type: 'category', boundaryGap: chartType === 'bar', data: result.rows.map(intervalLabel) }, yAxis: { type: 'value' }, series: [{ type: chartType === 'bar' ? 'bar' : 'line', areaStyle: chartType === 'area' ? {} : undefined, smooth: true, showSymbol: false, data: result.rows.map(valueFromRow) }] };
  }
  return {};
}

export function ResultView({ response, query, chartType, onChartType }: { response: KeenResponse<Record<string, unknown>>; query: QueryDraft; chartType: ChartType; onChartType(type: ChartType): void }): JSX.Element {
  const [tab, setTab] = useState<'visual' | 'table' | 'metadata' | 'raw' | 'request'>('visual');
  const chartRef = useRef<ReactECharts>(null);
  const semantic = useMemo(() => normalizeResult(response.data, query), [response.data, query]);
  const supported = useMemo(() => supportedCharts(semantic), [semantic]);
  const rows = useMemo(() => semanticResultToRows(semantic), [semantic]);
  const headers = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row)))], [rows]);
  const metadata = useMemo(() => Object.fromEntries(Object.entries(response.data).filter(([key]) => key !== 'result')), [response.data]);
  const hasMetadata = Object.keys(metadata).length > 0;

  useEffect(() => { if (!supported.includes(chartType)) onChartType(supported[0] ?? 'table'); }, [supported, chartType, onChartType]);

  const exportJson = () => window.keenDesktop.saveText({ suggestedName: `keen-${query.analysis_type}-result.json`, content: JSON.stringify(response.data, null, 2) });
  const exportCsv = () => window.keenDesktop.saveText({ suggestedName: `keen-${query.analysis_type}-result.csv`, content: toCsv(semantic) });
  const exportPng = async () => {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const dataUrl = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    const base64 = dataUrl.split(',')[1];
    if (base64) await window.keenDesktop.saveBinary({ suggestedName: `keen-${query.analysis_type}-chart.png`, base64 });
  };

  const chartUnavailable = chartCompatibilityReason(semantic, chartType);
  return (
    <Card className="result-panel">
      <div className="card__header"><div><h2>Query result</h2><p>{response.elapsedMs} ms client elapsed{response.requestId ? ` · Request ${response.requestId}` : ''}</p></div><div className="row"><Badge tone="success">HTTP {response.status}</Badge>{tab === 'visual' && !['metric', 'table', 'choropleth'].includes(chartType) ? <Button variant="secondary" onClick={() => void exportPng()}><FileImage size={14} /> PNG</Button> : null}<Button variant="secondary" onClick={() => void exportCsv()}><Download size={14} /> CSV</Button><Button variant="secondary" onClick={() => void exportJson()}><FileJson size={14} /> JSON</Button></div></div>
      <div className="tabs" role="tablist"><button className={`tab ${tab === 'visual' ? 'active' : ''}`} onClick={() => setTab('visual')}>Visualization</button><button className={`tab ${tab === 'table' ? 'active' : ''}`} onClick={() => setTab('table')}>Table</button>{hasMetadata ? <button className={`tab ${tab === 'metadata' ? 'active' : ''}`} onClick={() => setTab('metadata')}>Metadata</button> : null}<button className={`tab ${tab === 'raw' ? 'active' : ''}`} onClick={() => setTab('raw')}>Raw response</button><button className={`tab ${tab === 'request' ? 'active' : ''}`} onClick={() => setTab('request')}>Redacted request</button></div>
      <div className="card__body">
        {tab === 'visual' ? <div className="stack"><div className="toolbar"><span className="small muted">Chart</span><div className="segmented segmented--wrap">{ALL_CHARTS.map((type) => { const reason = chartCompatibilityReason(semantic, type); return <button key={type} className={chartType === type ? 'active' : ''} disabled={Boolean(reason)} title={reason} onClick={() => onChartType(type)}>{type}</button>; })}</div></div><p className="chart-summary" aria-live="polite">{summaryFor(semantic)}</p>{chartUnavailable ? <Callout tone="info">{chartUnavailable}</Callout> : chartType === 'table' ? <ResultTable rows={rows} headers={headers} /> : semantic.kind === 'scalar' && chartType === 'metric' ? <div className="metric-result"><strong>{typeof semantic.value === 'number' ? semantic.value.toLocaleString() : String(semantic.value)}</strong><span>{query.analysis_type.replace(/_/g, ' ')}</span></div> : ['unique', 'multi', 'unknown'].includes(semantic.kind) || (semantic.kind === 'records' && chartType !== 'bubble') ? <EmptyState icon={<Table2 size={28} />} title="Use the table for this result shape" description="This result is preserved without coercing it into a misleading aggregate chart." action={<Button variant="secondary" onClick={() => setTab('table')}>Open table</Button>} /> : <div role="img" aria-label={`${query.analysis_type} ${chartType} chart. ${summaryFor(semantic)}`}><ReactECharts ref={chartRef} option={chartOption(semantic, chartType, query.analysis_type)} className="chart-container" style={{ height: 370 }} notMerge lazyUpdate /></div>}</div> : tab === 'table' ? <ResultTable rows={rows} headers={headers} /> : tab === 'metadata' ? <pre className="json-view">{JSON.stringify(metadata, null, 2)}</pre> : tab === 'raw' ? <pre className="json-view">{JSON.stringify(response.data, null, 2)}</pre> : <div className="stack"><div className="request-meta"><div><strong>Method</strong><span>{response.redactedRequest.method}</span></div><div><strong>Credential</strong><span>{response.redactedRequest.credentialLabel ?? 'Selected key'}</span></div><div><strong>Authorization</strong><span>&lt;redacted&gt;</span></div></div><pre className="json-view">{JSON.stringify(response.redactedRequest, null, 2)}</pre><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(buildSafeCurl({ method: response.redactedRequest.method, url: response.redactedRequest.url, body: response.redactedRequest.body }))}><Braces size={14} /> Copy safe cURL</Button></div>}
      </div>
    </Card>
  );
}

function ResultTable({ rows, headers }: { rows: Array<Record<string, unknown>>; headers: string[] }): JSX.Element {
  if (!rows.length) return <EmptyState icon={<Table2 size={28} />} title="Empty result" description="The request succeeded but returned no rows or values for this scope." />;
  return <div className="table-wrap" style={{ maxHeight: 500 }}><table><caption className="sr-only">Keen query result table</caption><thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{rows.slice(0, 2000).map((row, index) => <tr key={index}>{headers.map((header) => <td key={header}>{row[header] && typeof row[header] === 'object' ? <code>{JSON.stringify(row[header])}</code> : String(row[header] ?? '')}</td>)}</tr>)}</tbody></table>{rows.length > 2000 ? <div className="card__footer">Showing the first 2,000 rows. Export CSV/JSON for the full in-memory result.</div> : null}</div>;
}
