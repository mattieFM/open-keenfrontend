import { describe, expect, it } from 'vitest';
import type { ChartWidget, DashboardDocument, FilterWidget, DateRangeWidget } from '@shared/types';
import { addWidget, createDashboard, runtimeQuery } from '@/lib/dashboard/model';
import { analyzePublicDashboardAccess, buildPublicDashboardAccessPolicy } from '@/lib/dashboard/sharing';

function dashboardWithCharts(): DashboardDocument {
  let document = createDashboard('workspace', 'Public');
  const saved: ChartWidget = { id: 'saved', type: 'chart', title: 'Saved', source: { kind: 'saved', name: 'orders_cache' }, chartType: 'line' };
  const adhoc: ChartWidget = { id: 'adhoc', type: 'chart', title: 'Ad hoc', source: { kind: 'ad-hoc', query: { analysis_type: 'count', event_collection: 'orders', timeframe: 'this_7_days', filters: [{ property_name: 'active', operator: 'eq', property_value: true }] } }, chartType: 'metric' };
  document = addWidget(document, saved); document = addWidget(document, adhoc);
  return document;
}

describe('dashboard runtime and sharing policy', () => {
  it('patches controls at runtime without mutating the source query', () => {
    let document = createDashboard('workspace');
    const chart: ChartWidget = { id: 'chart', type: 'chart', title: 'Orders', source: { kind: 'ad-hoc', query: { analysis_type: 'count', event_collection: 'orders', timeframe: 'this_30_days', filters: [{ property_name: 'active', operator: 'eq', property_value: true }] } }, chartType: 'line' };
    const filter: FilterWidget = { id: 'filter', type: 'filter', title: 'Country', eventCollection: 'orders', propertyName: 'country', targetWidgetIds: ['chart'], options: ['CA', 'US'], selected: [] };
    const date: DateRangeWidget = { id: 'date', type: 'date-range', title: 'Date', targetWidgetIds: ['chart'], timeframe: 'this_7_days', timezone: 'UTC' };
    document = addWidget(addWidget(addWidget(document, chart), filter), date);
    const patched = runtimeQuery(document, chart, { filter: ['CA', 'US'] }, { date: 'previous_1_days' });
    expect(patched?.filters).toHaveLength(2);
    expect(patched?.timeframe).toBe('previous_1_days');
    expect(chart.source.kind === 'ad-hoc' && chart.source.query.filters).toHaveLength(1);
  });

  it('requires enforced filters for public ad-hoc charts and allow-lists saved names', () => {
    const document = dashboardWithCharts();
    expect(analyzePublicDashboardAccess(document)).toMatchObject({ savedNames: ['orders_cache'], adHocChartCount: 1, chartCount: 2 });
    expect(() => buildPublicDashboardAccessPolicy({ document, name: 'dashboard-key' })).toThrow(/mandatory query filter/i);
    const policy = buildPublicDashboardAccessPolicy({ document, name: 'dashboard-key', mandatoryFilters: [{ property_name: 'customer.id', operator: 'eq', property_value: 'tenant-a' }] }) as { permitted: string[]; options: Record<string, unknown> };
    expect(policy.permitted).toEqual(['saved_queries', 'cached_queries', 'queries']);
    expect(policy.options).toMatchObject({ saved_queries: { allowed: ['orders_cache'] }, cached_queries: { allowed: ['orders_cache'] }, queries: { filters: [{ property_name: 'customer.id' }] } });
  });
});
