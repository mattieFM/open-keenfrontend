import ReactGridLayout, { type Layout, type Layouts } from 'react-grid-layout';
import type { DashboardDocument, DashboardLayoutItem } from '@shared/types';
import { touch } from './model';

export const DASHBOARD_BREAKPOINTS = { lg: 1100, md: 760, sm: 0 };
export const DASHBOARD_COLUMNS = { lg: 12, md: 8, sm: 1 };
export type DashboardBreakpoint = keyof typeof DASHBOARD_COLUMNS;

// These utilities are exported by react-grid-layout 1.x but omitted from its
// DefinitelyTyped declarations. Use the same collision rules for keyboard and
// pointer edits, rather than maintaining a second grid implementation.
const gridUtils = (ReactGridLayout as typeof ReactGridLayout & {
  utils: {
    compact(layout: Layout[], compactType: null, cols: number): Layout[];
    moveElement(layout: Layout[], item: Layout, x: number, y: number, isUserAction: boolean, preventCollision: boolean, compactType: null, cols: number): Layout[];
  };
}).utils;

export function isDashboardBreakpoint(value: string): value is DashboardBreakpoint {
  return Object.prototype.hasOwnProperty.call(DASHBOARD_COLUMNS, value);
}

export function dashboardBreakpointForWidth(width: number): DashboardBreakpoint {
  // Match react-grid-layout 1.x's strict greater-than breakpoint comparison.
  return width > DASHBOARD_BREAKPOINTS.lg ? 'lg' : width > DASHBOARD_BREAKPOINTS.md ? 'md' : 'sm';
}

function integer(value: number | undefined, fallback: number, minimum: number): number {
  return Math.max(minimum, Number.isFinite(value) ? Math.round(value as number) : fallback);
}

function constrain(item: DashboardLayoutItem, cols: number): Layout {
  const minW = Math.min(cols, integer(item.minW, 1, 1));
  const minH = integer(item.minH, 1, 1);
  const w = Math.max(minW, Math.min(cols, integer(item.w, minW, 1)));
  return {
    i: item.i,
    x: Math.min(cols - w, integer(item.x, 0, 0)),
    y: integer(item.y, 0, 0),
    w,
    h: Math.max(minH, integer(item.h, minH, 1)),
    minW,
    minH
  };
}

function canonicalLayout(document: DashboardDocument): DashboardLayoutItem[] {
  const widgetIds = new Set(document.widgets.map((widget) => widget.id));
  const seen = new Set<string>();
  const layout = document.layout.filter((item) => {
    if (!widgetIds.has(item.i) || seen.has(item.i)) return false;
    seen.add(item.i);
    return true;
  });
  let bottom = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (const widget of document.widgets) {
    if (seen.has(widget.id)) continue;
    const control = widget.type === 'filter' || widget.type === 'date-range';
    const h = control ? 3 : 6;
    layout.push({ i: widget.id, x: 0, y: bottom, w: control ? 4 : 6, h, minW: 2, minH: 2 });
    bottom += h;
  }
  return layout;
}

/** Derive render-only layouts. Measuring/reflowing the canvas never edits a document. */
export function dashboardLayouts(document: DashboardDocument): Layouts {
  const canonical = canonicalLayout(document);
  const layouts: Layouts = {};
  for (const breakpoint of Object.keys(DASHBOARD_COLUMNS) as DashboardBreakpoint[]) {
    const cols = DASHBOARD_COLUMNS[breakpoint];
    const overrides = new Map((breakpoint === 'lg' ? [] : document.responsiveLayouts?.[breakpoint] ?? []).map((item) => [item.i, item]));
    // Preserve the desktop reading order when a row becomes a single column.
    const source = breakpoint === 'sm' ? [...canonical].sort((a, b) => a.y - b.y || a.x - b.x) : canonical;
    let nextRow = 0;
    let nextOverrideRow = [...overrides.values()].reduce((bottom, item) => Math.max(bottom, item.y + item.h), 0);
    const projected = source.map((item) => {
      const fallback = breakpoint === 'lg' ? item : {
        ...item,
        x: Math.round(item.x * cols / DASHBOARD_COLUMNS.lg),
        y: breakpoint === 'sm' ? nextRow : item.y,
        w: Math.round(item.w * cols / DASHBOARD_COLUMNS.lg)
      };
      const override = overrides.get(item.i);
      const result = constrain(override ?? (overrides.size ? { ...fallback, x: 0, y: nextOverrideRow } : fallback), cols);
      if (!override && overrides.size) nextOverrideRow = result.y + result.h;
      nextRow += result.h;
      return result;
    });
    // Resolve actual overlap without pulling later rows up into deliberate gaps.
    layouts[breakpoint] = gridUtils.compact(projected, null, cols);
  }
  return layouts;
}

export function sameDashboardLayout(first: DashboardLayoutItem[], second: DashboardLayoutItem[]): boolean {
  if (first.length !== second.length) return false;
  const byId = new Map(first.map((item) => [item.i, item]));
  return second.every((item) => {
    const previous = byId.get(item.i);
    return previous && previous.x === item.x && previous.y === item.y && previous.w === item.w && previous.h === item.h
      && (previous.minW ?? 1) === (item.minW ?? 1) && (previous.minH ?? 1) === (item.minH ?? 1);
  });
}

/** Commit a completed user edit to its own breakpoint, retaining unknown stored fields. */
export function updateDashboardLayout(document: DashboardDocument, breakpoint: DashboardBreakpoint, layout: Layout[]): DashboardDocument {
  const current = dashboardLayouts(document)[breakpoint];
  const allowedIds = new Set(current.map((item) => item.i));
  const next = layout.filter((item) => allowedIds.has(item.i)).map((item) => constrain(item, DASHBOARD_COLUMNS[breakpoint]));
  if (next.length !== current.length || sameDashboardLayout(current, next)) return document;

  const canonicalById = new Map(document.layout.map((item) => [item.i, item]));
  const storedById = new Map((breakpoint === 'lg' ? document.layout : document.responsiveLayouts?.[breakpoint] ?? []).map((item) => [item.i, item]));
  const saved = next.map((item) => ({ ...canonicalById.get(item.i), ...storedById.get(item.i), ...item }));
  return touch(breakpoint === 'lg'
    ? { ...document, layout: saved }
    : { ...document, responsiveLayouts: { ...document.responsiveLayouts, [breakpoint]: saved } });
}

/** Move/resize within the visible column count, then resolve collisions exactly like dragging. */
export function nudgeDashboardLayout(layout: Layout[], breakpoint: DashboardBreakpoint, widgetId: string, dx: number, dy: number, dw = 0, dh = 0): Layout[] {
  const cols = DASHBOARD_COLUMNS[breakpoint];
  const next = layout.map((item) => constrain(item, cols));
  const item = next.find((candidate) => candidate.i === widgetId);
  if (!item) return layout;

  const w = Math.max(item.minW ?? 1, Math.min(cols - item.x, item.w + dw));
  const h = Math.max(item.minH ?? 1, item.h + dh);
  const x = Math.max(0, Math.min(cols - w, item.x + dx));
  const y = Math.max(0, item.y + dy);
  if (item.x === x && item.y === y && item.w === w && item.h === h) return layout;

  item.w = w;
  item.h = h;
  const moved = gridUtils.moveElement(next, item, x, y, true, false, null, cols);
  const resolved = gridUtils.compact(moved, null, cols);
  return sameDashboardLayout(layout, resolved) ? layout : resolved;
}
