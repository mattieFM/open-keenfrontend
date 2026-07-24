import { useMemo, useState } from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, CircleAlert, Copy, Filter, GripVertical, Image as ImageIcon, Maximize2, Minimize2, Pencil, RefreshCw, Table2, Trash2 } from 'lucide-react';
import type { ChartType, ChartWidget, CredentialMeta, DashboardDocument, DashboardLayoutItem, DashboardWidget, KeenResponse, QueryDraft } from '@shared/types';
import { Badge, Button, Callout, EmptyState, IconButton, Select } from '../../components/ui';
import { normalizeResult, supportedCharts } from '../../lib/query/normalizer';
import { semanticResultToRows } from '../../lib/query/csv';
import { chartOption } from '../explorer/ResultView';
import { runtimeQuery, touch } from '../../lib/dashboard/model';

const ResponsiveGrid = WidthProvider(Responsive);
export type DashboardChartExecutor = (widget: ChartWidget, runtimeQuery: QueryDraft | undefined, credential?: CredentialMeta) => Promise<KeenResponse<Record<string, unknown>>>;

type Props = {
  document: DashboardDocument;
  editable?: boolean;
  credential?: CredentialMeta;
  executeChart?: DashboardChartExecutor;
  onChange?(document: DashboardDocument): void;
  onEditWidget?(widget: DashboardWidget): void;
  onCloneWidget?(widgetId: string): void;
  onRemoveWidget?(widgetId: string): void;
};

export function DashboardCanvas({ document, editable = false, credential, executeChart, onChange, onEditWidget, onCloneWidget, onRemoveWidget }: Props): JSX.Element {
  const [filterSelections, setFilterSelections] = useState<Record<string, string[]>>({});
  const [dateRanges, setDateRanges] = useState<Record<string, string>>({});
  const layouts = useMemo<Layouts>(() => ({ lg: document.layout.map(toGridLayout) }), [document.layout]);

  const updateLayout = (layout: Layout[]) => {
    if (editable && onChange) onChange(touch({ ...document, layout: layout.map(fromGridLayout) }));
  };
  const nudge = (widgetId: string, dx: number, dy: number, dw = 0, dh = 0) => {
    if (!onChange) return;
    const next = document.layout.map((item) => item.i === widgetId ? { ...item, x: Math.max(0, Math.min(11, item.x + dx)), y: Math.max(0, item.y + dy), w: Math.max(item.minW ?? 2, Math.min(12 - item.x, item.w + dw)), h: Math.max(item.minH ?? 2, item.h + dh) } : item);
    onChange(touch({ ...document, layout: next }));
  };

  if (!document.widgets.length) return <EmptyState title="This dashboard is empty" description={editable ? 'Add a chart, text, image, string filter, or date-range widget from the toolbar.' : 'No widgets have been added.'} />;

  return <div className={`dashboard-surface ${editable ? 'dashboard-surface--editing' : ''}`} style={{ background: document.settings.background }}>
    <ResponsiveGrid className="dashboard-grid" layouts={layouts} breakpoints={{ lg: 1100, md: 760, sm: 0 }} cols={{ lg: 12, md: 8, sm: 1 }} rowHeight={54} margin={[document.settings.gridGap, document.settings.gridGap]} containerPadding={[document.settings.gridGap, document.settings.gridGap]} isDraggable={editable} isResizable={editable} draggableHandle=".widget-drag-handle" onLayoutChange={updateLayout} compactType="vertical" preventCollision={false}>
      {document.widgets.map((widget) => <section key={widget.id} className="dashboard-widget" style={{ background: document.settings.tileBackground, borderRadius: document.settings.tileRadius }} aria-label={widgetTitle(widget)}>
        {editable ? <div className="dashboard-widget__chrome">
          <button className="widget-drag-handle" aria-label={`Move ${widgetTitle(widget)} by dragging`} title="Drag widget"><GripVertical size={15} /></button><span>{widget.type}</span>
          <div className="dashboard-widget__tools">
            <IconButton label="Move left" onClick={() => nudge(widget.id, -1, 0)}><ArrowLeft size={13} /></IconButton><IconButton label="Move right" onClick={() => nudge(widget.id, 1, 0)}><ArrowRight size={13} /></IconButton><IconButton label="Move up" onClick={() => nudge(widget.id, 0, -1)}><ArrowUp size={13} /></IconButton><IconButton label="Move down" onClick={() => nudge(widget.id, 0, 1)}><ArrowDown size={13} /></IconButton><IconButton label="Make smaller" onClick={() => nudge(widget.id, 0, 0, -1, -1)}><Minimize2 size={13} /></IconButton><IconButton label="Make larger" onClick={() => nudge(widget.id, 0, 0, 1, 1)}><Maximize2 size={13} /></IconButton><IconButton label="Edit widget" onClick={() => onEditWidget?.(widget)}><Pencil size={13} /></IconButton>{widget.type !== 'filter' && widget.type !== 'date-range' ? <IconButton label="Clone widget" onClick={() => onCloneWidget?.(widget.id)}><Copy size={13} /></IconButton> : null}<IconButton label="Delete widget" onClick={() => onRemoveWidget?.(widget.id)}><Trash2 size={13} /></IconButton>
          </div>
        </div> : null}
        <div className="dashboard-widget__content">{widget.type === 'chart' ? <ChartTile document={document} widget={widget} credential={credential} executeChart={executeChart} filterSelections={filterSelections} dateRanges={dateRanges} /> : widget.type === 'text' ? <TextTile markdown={widget.markdown} /> : widget.type === 'image' ? <ImageTile widget={widget} /> : widget.type === 'filter' ? <FilterTile widget={widget} value={filterSelections[widget.id] ?? widget.selected} onChange={(value) => setFilterSelections((current) => ({ ...current, [widget.id]: value }))} /> : <DateRangeTile widget={widget} value={dateRanges[widget.id] ?? (typeof widget.timeframe === 'string' ? widget.timeframe : '')} onChange={(value) => setDateRanges((current) => ({ ...current, [widget.id]: value }))} />}</div>
      </section>)}
    </ResponsiveGrid>
  </div>;
}

function ChartTile({ document, widget, credential, executeChart, filterSelections, dateRanges }: { document: DashboardDocument; widget: ChartWidget; credential?: CredentialMeta; executeChart?: DashboardChartExecutor; filterSelections: Record<string, string[]>; dateRanges: Record<string, string> }): JSX.Element {
  const query = useMemo(() => runtimeQuery(document, widget, filterSelections, dateRanges), [document, widget, filterSelections, dateRanges]);
  const state = useQuery({ queryKey: ['dashboard-chart', document.id, widget.id, document.revision, query, widget.source.kind === 'saved' ? widget.source.name : '', credential?.id], queryFn: () => { if (!executeChart) throw new Error('No chart execution adapter is available.'); return executeChart(widget, query, credential); }, enabled: Boolean(executeChart && credential), retry: false, staleTime: 15_000 });
  const semantic = useMemo(() => state.data ? normalizeResult(state.data.data, query ?? (widget.source.kind === 'ad-hoc' ? widget.source.query : { analysis_type: 'count' })) : undefined, [state.data, query, widget.source]);
  const supported = semantic ? supportedCharts(semantic) : [];
  const actualChart = semantic && supported.includes(widget.chartType) ? widget.chartType : (supported[0] ?? 'table');
  return <div className="chart-tile"><header className="chart-tile__header"><div><h3>{widget.title || 'Untitled chart'}</h3>{widget.subtitle ? <p>{widget.subtitle}</p> : null}</div><div className="row"><Badge tone={widget.source.kind === 'saved' ? 'blue' : 'purple'}>{widget.source.kind === 'saved' ? 'Saved query' : 'Ad hoc'}</Badge>{state.isFetching ? <RefreshCw className="spin" size={14} aria-label="Refreshing" /> : null}</div></header>
    {!credential ? <Callout tone="warning" title="No read credential">Select a query-capable key above the dashboard.</Callout> : state.error ? <Callout tone="danger" title="Chart request failed">{state.error instanceof Error ? state.error.message : String(state.error)}</Callout> : state.isPending ? <div className="widget-loading"><RefreshCw className="spin" size={20} /><span>Running query…</span></div> : !semantic ? <EmptyState title="No chart data" description="The chart has not returned a response." /> : actualChart === 'table' || ['records', 'unique', 'multi', 'unknown'].includes(semantic.kind) ? <MiniResultTable rows={semanticResultToRows(semantic)} /> : semantic.kind === 'scalar' && actualChart === 'metric' ? <div className="dashboard-metric"><strong>{typeof semantic.value === 'number' ? semantic.value.toLocaleString() : String(semantic.value ?? '')}</strong><span>{widget.title}</span></div> : <ReactECharts option={chartOption(semantic, actualChart as ChartType, widget.title)} style={{ width: '100%', height: '100%', minHeight: 210 }} notMerge lazyUpdate />}
    {widget.source.kind === 'saved' && document.widgets.some((candidate) => (candidate.type === 'filter' || candidate.type === 'date-range') && candidate.targetWidgetIds.includes(widget.id)) ? <div className="widget-note"><CircleAlert size={13} /> Saved-result endpoints do not accept runtime patches. Detach the query or use definition access.</div> : null}
  </div>;
}

function safeMarkdownHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, 'https://local.invalid');
    return ['https:', 'mailto:'].includes(url.protocol) ? value : undefined;
  } catch { return undefined; }
}
function TextTile({ markdown }: { markdown: string }): JSX.Element {
  const clean = DOMPurify.sanitize(markdown, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return <div className="markdown-widget"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ node: _node, href, ...props }) => {
      const safeHref = safeMarkdownHref(href);
      return safeHref ? <a {...props} href={safeHref} target="_blank" rel="noopener noreferrer" /> : <span>{props.children}</span>;
    },
    img: () => <span className="muted small">[Remote Markdown images are blocked; use an Image widget.]</span>
  }}>{clean}</ReactMarkdown></div>;
}
function ImageTile({ widget }: { widget: Extract<DashboardWidget, { type: 'image' }> }): JSX.Element {
  let valid = false; try { valid = new URL(widget.url).protocol === 'https:'; } catch { valid = false; }
  if (!valid) return <EmptyState icon={<ImageIcon size={26} />} title="No valid HTTPS image" description="Edit the widget and enter an HTTPS URL." />;
  return <figure className={`image-widget image-widget--${widget.fit}`}><img src={widget.url} alt={widget.decorative ? '' : widget.alt} referrerPolicy="no-referrer" loading="lazy" />{widget.caption ? <figcaption>{widget.caption}</figcaption> : null}</figure>;
}
function FilterTile({ widget, value, onChange }: { widget: Extract<DashboardWidget, { type: 'filter' }>; value: string[]; onChange(value: string[]): void }): JSX.Element {
  return <div className="control-widget"><div className="control-widget__title"><Filter size={16} /><div><strong>{widget.title}</strong><span>{widget.eventCollection}.{widget.propertyName}</span></div></div><Select value={value[0] ?? ''} onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}><option value="">All values</option>{widget.options.map((option) => <option key={option} value={option}>{option}</option>)}</Select>{value.length ? <Button variant="ghost" onClick={() => onChange([])}>Clear</Button> : null}</div>;
}
function DateRangeTile({ widget, value, onChange }: { widget: Extract<DashboardWidget, { type: 'date-range' }>; value: string; onChange(value: string): void }): JSX.Element {
  const choices = ['today', 'yesterday', 'this_7_days', 'this_14_days', 'this_30_days', 'previous_7_days', 'previous_30_days'];
  return <div className="control-widget"><div className="control-widget__title"><CalendarDays size={16} /><div><strong>{widget.title}</strong><span>{String(widget.timezone ?? 'Project timezone')}</span></div></div><Select value={value} onChange={(event) => onChange(event.target.value)}>{choices.map((choice) => <option key={choice} value={choice}>{choice.replace(/_/g, ' ')}</option>)}{value && !choices.includes(value) ? <option value={value}>{value.replace(/_/g, ' ')}</option> : null}</Select></div>;
}
function MiniResultTable({ rows }: { rows: Array<Record<string, unknown>> }): JSX.Element {
  if (!rows.length) return <EmptyState icon={<Table2 size={24} />} title="Empty result" description="The query succeeded but returned no rows." />;
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return <div className="mini-table"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}>{headers.map((header) => <td key={header}>{typeof row[header] === 'object' ? JSON.stringify(row[header]) : String(row[header] ?? '')}</td>)}</tr>)}</tbody></table></div>;
}
function widgetTitle(widget: DashboardWidget): string { if ('title' in widget && widget.title) return widget.title; if (widget.type === 'text') return 'Text widget'; if (widget.type === 'image') return widget.alt || 'Image widget'; return `${widget.type} widget`; }
function toGridLayout(item: DashboardLayoutItem): Layout { return { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, minH: item.minH }; }
function fromGridLayout(item: Layout): DashboardLayoutItem { return { i: item.i, x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, minH: item.minH }; }
