import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Layout, Layouts } from 'react-grid-layout';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartWidget, CredentialMeta, DashboardDocument } from '@shared/types';
import { DashboardCanvas } from '@/features/dashboards/DashboardCanvas';
import { createDashboard } from '@/lib/dashboard/model';
import { dashboardLayouts } from '@/lib/dashboard/layout';

type GridProps = {
  children: ReactNode;
  layouts: Layouts;
  width: number;
  onBreakpointChange?(breakpoint: string, cols: number): void;
  onLayoutChange?(layout: Layout[], layouts: Layouts): void;
  onDragStop?(layout: Layout[]): void;
  onResizeStop?(layout: Layout[]): void;
};
const grid = vi.hoisted(() => ({ props: undefined as GridProps | undefined, width: 1280, resize: undefined as ((width: number) => void) | undefined }));

vi.mock('react-grid-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-grid-layout')>();
  return {
    ...actual,
    Responsive: (props: GridProps) => { grid.props = props; return <div>{props.children}</div>; }
  };
});
vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="chart" /> }));

function document(): DashboardDocument {
  return {
    ...createDashboard('canvas-test'),
    widgets: [{ id: 'text', type: 'text', markdown: 'Sample text' }],
    layout: [{ i: 'text', x: 6, y: 0, w: 6, h: 4, minW: 2, minH: 2 }]
  };
}

describe('dashboard canvas editing', () => {
  beforeEach(() => {
    grid.props = undefined;
    grid.width = 1280;
    grid.resize = undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() {
        grid.resize = (width) => this.callback([{ contentRect: { width } }]);
        grid.resize(grid.width);
      }
      disconnect() { grid.resize = undefined; }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('never saves layout measurement or responsive reflow', () => {
    const original = document();
    const onChange = vi.fn();
    render(<DashboardCanvas document={original} editable onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      grid.props?.onLayoutChange?.(grid.props.layouts.lg, grid.props.layouts);
      grid.props?.onBreakpointChange?.('sm', 1);
      grid.props?.onLayoutChange?.(grid.props.layouts.sm, grid.props.layouts);
      grid.props?.onBreakpointChange?.('lg', 12);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(original.layout[0]).toMatchObject({ x: 6, w: 6 });
  });

  it('continues measuring a mounted grid through live resize and ignores hidden zero-width readings', () => {
    const onChange = vi.fn();
    render(<DashboardCanvas document={document()} editable onChange={onChange} />);
    expect(grid.props?.width).toBe(1280);
    act(() => grid.resize?.(900));
    expect(grid.props?.width).toBe(900);
    act(() => grid.resize?.(480));
    expect(grid.props?.width).toBe(480);
    act(() => grid.resize?.(0));
    expect(grid.props?.width).toBe(480);
    act(() => grid.resize?.(1600));
    expect(grid.props?.width).toBe(1600);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('persists completed narrow-screen resize and keyboard edits to that breakpoint', () => {
    const original = document();
    const onChange = vi.fn();
    render(<DashboardCanvas document={original} editable onChange={onChange} />);
    act(() => {
      grid.props?.onBreakpointChange?.('sm', 1);
      grid.props?.onResizeStop?.(grid.props.layouts.sm.map((item) => ({ ...item, h: item.h + 1 })));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ layout: original.layout, responsiveLayouts: { sm: [{ i: 'text', w: 1, h: 5 }] } });
    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Make larger' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].layout).toBe(original.layout);
    expect(onChange.mock.calls[0][0].responsiveLayouts.sm[0]).toMatchObject({ x: 0, w: 1, h: 5 });
  });

  it.each([{ breakpoint: 'md', width: 900 }, { breakpoint: 'sm', width: 480 }])('uses the measured $breakpoint breakpoint for the first edit after opening', ({ breakpoint, width }) => {
    grid.width = width;
    const original = document();
    const onChange = vi.fn();
    render(<DashboardCanvas document={original} editable onChange={onChange} />);
    // No breakpoint-change event occurs when Responsive first mounts at this width.
    fireEvent.click(screen.getByRole('button', { name: 'Make larger' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].layout).toBe(original.layout);
    expect(onChange.mock.calls[0][0].responsiveLayouts[breakpoint][0].h).toBe(5);
  });

  it('saves completed drags once and ignores same-position stops', () => {
    const original = document();
    const onChange = vi.fn();
    render(<DashboardCanvas document={original} editable onChange={onChange} />);
    act(() => grid.props?.onDragStop?.(grid.props.layouts.lg));
    expect(onChange).not.toHaveBeenCalled();
    act(() => grid.props?.onDragStop?.(grid.props.layouts.lg.map((item) => ({ ...item, x: 0 }))));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].layout[0]).toMatchObject({ x: 0, w: 6 });
    expect(onChange.mock.calls[0][0].revision).toBe(original.revision + 1);
  });

  it('uses the current layout when a widget is added to an empty canvas', () => {
    const original = createDashboard('canvas-test');
    const onChange = vi.fn();
    const view = render(<DashboardCanvas document={original} editable onChange={onChange} />);
    view.rerender(<DashboardCanvas document={document()} editable onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].layout[0]).toMatchObject({ x: 5, w: 6 });
  });

  it('does not save anything from a read-only canvas', () => {
    const onChange = vi.fn();
    render(<DashboardCanvas document={document()} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Move left' })).not.toBeInTheDocument();
    act(() => grid.props?.onResizeStop?.(grid.props.layouts.lg.map((item) => ({ ...item, h: 8 }))));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps chart data during layout edits and refetches when the query changes', async () => {
    const chart: ChartWidget = { id: 'chart', type: 'chart', title: 'Total', source: { kind: 'ad-hoc', query: { analysis_type: 'count', event_collection: 'synthetic_events' } }, chartType: 'metric' };
    const original: DashboardDocument = { ...document(), widgets: [chart], layout: [{ i: 'chart', x: 0, y: 0, w: 6, h: 4 }] };
    const credential: CredentialMeta = { id: 'test-read', workspaceId: 'canvas-test', label: 'Synthetic read', type: 'read', storageMode: 'memory', hint: '', createdAt: new Date(0).toISOString() };
    const executeChart = vi.fn(async () => ({ data: { result: 42 }, status: 200, headers: {}, elapsedMs: 1, rawText: '', redactedRequest: { method: 'POST' as const, url: 'https://local.invalid/query', headers: {} } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const canvas = (value: DashboardDocument) => <QueryClientProvider client={client}><DashboardCanvas document={value} credential={credential} executeChart={executeChart} /></QueryClientProvider>;
    const view = render(canvas(original));
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(executeChart).toHaveBeenCalledTimes(1);
    const moved = { ...original, revision: original.revision + 1, layout: dashboardLayouts(original).lg.map((item) => ({ ...item, w: 8 })) };
    view.rerender(canvas(moved));
    await act(async () => { await Promise.resolve(); });
    expect(executeChart).toHaveBeenCalledTimes(1);
    view.rerender(canvas({ ...moved, widgets: [{ ...chart, source: { kind: 'ad-hoc', query: { analysis_type: 'count', event_collection: 'other_synthetic_events' } } }] }));
    await waitFor(() => expect(executeChart).toHaveBeenCalledTimes(2));
  });
});
