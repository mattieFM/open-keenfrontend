import { describe, expect, it } from 'vitest';
import type { DashboardDocument, DashboardLayoutItem } from '@shared/types';
import { addWidget, createDashboard, migrateDashboard, removeWidget } from '@/lib/dashboard/model';
import { DASHBOARD_COLUMNS, dashboardLayouts, nudgeDashboardLayout, sameDashboardLayout, updateDashboardLayout } from '@/lib/dashboard/layout';

function dashboard(): DashboardDocument {
  return {
    ...createDashboard('layout-test'),
    widgets: ['left', 'right', 'below'].map((id) => ({ id, type: 'text', markdown: id })),
    layout: [
      { i: 'left', x: 0, y: 0, w: 6, h: 4, minW: 2, minH: 2 },
      { i: 'right', x: 6, y: 0, w: 6, h: 4, minW: 2, minH: 2 },
      { i: 'below', x: 0, y: 4, w: 12, h: 3, minW: 4, minH: 2 }
    ]
  };
}

describe('dashboard responsive layout persistence', () => {
  it('derives bounded, nonoverlapping layouts without changing the canonical document', () => {
    const document = dashboard();
    const original = structuredClone(document);
    const layouts = dashboardLayouts(document);
    expect(document).toEqual(original);
    expect(layouts.md.map(({ x, w }) => ({ x, w }))).toEqual([{ x: 0, w: 4 }, { x: 4, w: 4 }, { x: 0, w: 8 }]);
    expect(layouts.sm.map(({ x, y, w, minW }) => ({ x, y, w, minW }))).toEqual([
      { x: 0, y: 0, w: 1, minW: 1 }, { x: 0, y: 4, w: 1, minW: 1 }, { x: 0, y: 8, w: 1, minW: 1 }
    ]);
    for (const breakpoint of Object.keys(DASHBOARD_COLUMNS) as Array<keyof typeof DASHBOARD_COLUMNS>) {
      const layout = layouts[breakpoint];
      for (const item of layout) {
        expect(item.x + item.w).toBeLessThanOrEqual(DASHBOARD_COLUMNS[breakpoint]);
        expect(item.minW).toBeLessThanOrEqual(item.w);
        expect(layout.filter((other) => other.i !== item.i && item.x < other.x + other.w && item.x + item.w > other.x && item.y < other.y + other.h && item.y + item.h > other.y)).toHaveLength(0);
      }
    }
  });

  it('stacks narrow screens in the saved visual reading order', () => {
    const document = dashboard();
    document.layout[0].x = 6;
    document.layout[1].x = 0;
    expect(dashboardLayouts(document).sm.map(({ i }) => i)).toEqual(['right', 'left', 'below']);
  });

  it('preserves intentional gaps and aligned rows when rendering a saved layout', () => {
    const original = dashboard();
    const document = { ...original, layout: original.layout.map((item) => ({ ...item, y: item.y + 3 })) };
    const layouts = dashboardLayouts(document);
    expect(layouts.lg.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))).toEqual(document.layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })));
    expect(layouts.md.map(({ y }) => y)).toEqual([3, 3, 7]);
    expect(layouts.sm.map(({ y }) => y)).toEqual([0, 4, 8]);
  });

  it('keeps deliberate medium and small edits separate from the desktop layout and each other', () => {
    const document = dashboard();
    const md = nudgeDashboardLayout(dashboardLayouts(document).md, 'md', 'left', 0, 0, 0, 1);
    const medium = updateDashboardLayout(document, 'md', md);
    expect(medium.layout).toBe(document.layout);
    expect(medium.revision).toBe(document.revision + 1);
    expect(medium.responsiveLayouts?.md.find((item) => item.i === 'left')?.h).toBe(5);
    const sm = nudgeDashboardLayout(dashboardLayouts(medium).sm, 'sm', 'left', 0, 0, 0, 2);
    const small = updateDashboardLayout(medium, 'sm', sm);
    expect(small.layout).toBe(document.layout);
    expect(small.responsiveLayouts?.md).toBe(medium.responsiveLayouts?.md);
    expect(dashboardLayouts(small).sm.find((item) => item.i === 'left')?.h).toBe(6);
    expect(dashboardLayouts(migrateDashboard(JSON.parse(JSON.stringify(small)))).sm).toEqual(dashboardLayouts(small).sm);
  });

  it('preserves unknown document, breakpoint, and per-item fields across edits', () => {
    const document = dashboard();
    const extended = { ...document.layout[0], customMetadata: { description: 'Retain me' } };
    const mediumItem = { ...extended, x: 0, w: 4, responsiveNote: 'Also retain me' };
    const unknownLayout: DashboardLayoutItem[] = [{ i: 'left', x: 0, y: 0, w: 2, h: 4 }];
    const original = migrateDashboard({
      ...document,
      sourceExtension: { supported: true },
      layout: [extended, ...document.layout.slice(1)],
      responsiveLayouts: { md: [mediumItem], futureBreakpoint: unknownLayout }
    });
    const next = updateDashboardLayout(original, 'md', nudgeDashboardLayout(dashboardLayouts(original).md, 'md', 'left', 0, 0, 0, 1));
    expect(next).toHaveProperty('sourceExtension', { supported: true });
    expect(next.layout[0]).toEqual(extended);
    expect(next.responsiveLayouts?.md[0]).toMatchObject({ customMetadata: extended.customMetadata, responsiveNote: 'Also retain me', h: 5 });
    expect(next.responsiveLayouts?.futureBreakpoint).toBe(original.responsiveLayouts?.futureBreakpoint);
    expect(dashboardLayouts(next)).not.toHaveProperty('futureBreakpoint');
  });

  it('does not create revisions for reflow, equivalent ordering, or a blocked keyboard move', () => {
    const document = dashboard();
    const layouts = dashboardLayouts(document);
    expect(updateDashboardLayout(document, 'lg', [...layouts.lg].reverse())).toBe(document);
    expect(updateDashboardLayout(document, 'sm', layouts.sm)).toBe(document);
    expect(nudgeDashboardLayout(layouts.lg, 'lg', 'right', 1, 0)).toBe(layouts.lg);
    expect(nudgeDashboardLayout(layouts.sm, 'sm', 'left', -1, 0)).toBe(layouts.sm);
    const shifted = { ...document, layout: document.layout.map((item) => ({ ...item, y: item.y + 2 })) };
    expect(updateDashboardLayout(shifted, 'lg', dashboardLayouts(shifted).lg)).toBe(shifted);
  });

  it('resolves keyboard collisions and respects size and right-edge constraints', () => {
    const layouts = dashboardLayouts(dashboard());
    const resized = nudgeDashboardLayout(layouts.lg, 'lg', 'right', 0, 0, 1, 1);
    expect(resized.find((item) => item.i === 'right')).toMatchObject({ x: 6, w: 6, h: 5 });
    expect(resized.find((item) => item.i === 'below')?.y).toBe(5);
    const moved = nudgeDashboardLayout(layouts.sm, 'sm', 'left', 0, 1);
    expect(moved.find((item) => item.i === 'left')?.y).toBeGreaterThan(0);
    expect(moved.every((item) => !moved.some((other) => other.i !== item.i && item.y < other.y + other.h && item.y + item.h > other.y))).toBe(true);
    expect(sameDashboardLayout(moved, layouts.sm)).toBe(false);
    const shrunken = nudgeDashboardLayout([{ i: 'tiny', x: 11, y: 0, w: 1, h: 2, minW: 1, minH: 2 }], 'lg', 'tiny', 1, 0, -1, -1);
    expect(shrunken[0]).toMatchObject({ x: 11, w: 1, h: 2 });
  });

  it('adds newly created widgets to customized breakpoints and removes deleted IDs everywhere', () => {
    const document = dashboard();
    const customized = updateDashboardLayout(document, 'sm', nudgeDashboardLayout(dashboardLayouts(document).sm, 'sm', 'left', 0, 0, 0, 1));
    const added = addWidget(customized, { id: 'new', type: 'text', markdown: 'New text' });
    expect(dashboardLayouts(added).sm.find((item) => item.i === 'new')).toMatchObject({ w: 1, h: 6 });
    const removed = removeWidget(added, 'left');
    expect(removed.responsiveLayouts?.sm.some((item) => item.i === 'left')).toBe(false);
    expect(dashboardLayouts(removed).sm.map((item) => item.i)).toEqual(['right', 'below', 'new']);
  });

  it('appends new widgets after the saved bottom of a custom layout with gaps', () => {
    const original = dashboard();
    const customized = { ...original, responsiveLayouts: { sm: dashboardLayouts(original).sm.map((item) => ({ ...item, y: item.y + 10 })) } };
    const added = addWidget(customized, { id: 'new', type: 'text', markdown: 'New text' });
    expect(dashboardLayouts(added).sm.find((item) => item.i === 'new')).toMatchObject({ y: 21, w: 1, h: 6 });
    expect(dashboardLayouts(added).sm.find((item) => item.i === 'left')?.y).toBe(10);
  });
});
