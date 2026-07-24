import type { DashboardDocument, DashboardWidget, KeenFilter } from '@shared/types';

export type PublicDashboardAccessAnalysis = {
  savedNames: string[];
  adHocChartCount: number;
  chartCount: number;
};

export function analyzePublicDashboardAccess(document: DashboardDocument): PublicDashboardAccessAnalysis {
  const charts = document.widgets.filter((widget): widget is Extract<DashboardWidget, { type: 'chart' }> => widget.type === 'chart');
  const savedNames = [...new Set(charts.flatMap((widget) => widget.source.kind === 'saved' && widget.source.name ? [widget.source.name] : []))].sort();
  return {
    savedNames,
    adHocChartCount: charts.filter((widget) => widget.source.kind === 'ad-hoc').length,
    chartCount: charts.length
  };
}

export function buildPublicDashboardAccessPolicy(input: {
  document: DashboardDocument;
  name: string;
  mandatoryFilters?: KeenFilter[];
}): Record<string, unknown> {
  const name = input.name.trim();
  if (!name) throw new Error('Access Key name is required.');
  if (name.length > 256) throw new Error('Access Key name must not exceed 256 characters.');
  const analysis = analyzePublicDashboardAccess(input.document);
  if (!analysis.chartCount) throw new Error('The dashboard has no chart data sources to authorize.');

  const permitted: string[] = [];
  const options: Record<string, unknown> = {};
  if (analysis.savedNames.length) {
    // A name may refer to either a cached or non-cached saved query. Both scopes stay
    // resource-allow-listed so the key cannot retrieve any other query by name.
    permitted.push('saved_queries', 'cached_queries');
    options.saved_queries = { allowed: analysis.savedNames };
    options.cached_queries = { allowed: analysis.savedNames };
  }
  if (analysis.adHocChartCount) {
    if (!Array.isArray(input.mandatoryFilters) || input.mandatoryFilters.length === 0) {
      throw new Error('Ad-hoc public charts require at least one mandatory query filter. Convert them to saved queries or provide an enforced tenant/security-boundary filter.');
    }
    permitted.push('queries');
    options.queries = { filters: input.mandatoryFilters };
  }
  return { name, is_active: true, permitted, options };
}
