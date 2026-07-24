import { describe, expect, it } from 'vitest';
import type { QueryDraft } from '@shared/types';
import { chartCompatibilityReason, normalizeResult, supportedCharts } from '@/lib/query/normalizer';
import { queryBody, validateQuery } from '@/lib/query/validation';

describe('query validation and semantic results', () => {
  it('validates nested OR and geo/group incompatibility', () => {
    const query: QueryDraft = { analysis_type: 'count', event_collection: 'events', timeframe: 'this_7_days', group_by: 'country', filters: [{ operator: 'or', operands: [{ property_name: 'geo', operator: 'within', property_value: { coordinates: [1, 2], max_distance_miles: 5 } }] }] };
    const errors = validateQuery(query);
    expect(errors.join(' ')).toMatch(/OR requires at least two/);
    expect(errors.join(' ')).toMatch(/Geo within filters cannot be combined/);
  });

  it('reports malformed raw OR filters without throwing', () => {
    const query = { analysis_type: 'count', event_collection: 'events', timeframe: 'this_7_days', filters: [{ operator: 'or', operands: null }] } as unknown as QueryDraft;
    expect(() => validateQuery(query)).not.toThrow();
    expect(validateQuery(query).join(' ')).toMatch(/OR requires at least two operands/);
  });

  it('requires a funnel timeframe and rejects first-step flags', () => {
    const query: QueryDraft = { analysis_type: 'funnel', steps: [{ event_collection: 'a', actor_property: 'id', optional: true }, { event_collection: 'b', actor_property: 'id' }] };
    expect(validateQuery(query).join(' ')).toMatch(/first funnel step/i);
    expect(validateQuery(query).join(' ')).toMatch(/shared timeframe/i);
  });

  it('removes ignored timezone from absolute request bodies', () => {
    const body = queryBody({ analysis_type: 'count', event_collection: 'events', timeframe: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' }, timezone: 'America/Toronto' });
    expect(body).not.toHaveProperty('timezone');
  });

  it('normalizes heatmap-compatible and bubble-compatible shapes', () => {
    const grouped = normalizeResult({ result: [{ country: 'CA', plan: 'pro', result: 2 }, { country: 'US', plan: 'free', result: 3 }] }, { analysis_type: 'count', event_collection: 'e', timeframe: 'this_7_days' });
    expect(supportedCharts(grouped)).toContain('heatmap');
    const records = normalizeResult({ result: [{ x: 1, y: 2, size: 3 }] }, { analysis_type: 'extraction', event_collection: 'e', timeframe: 'this_7_days' });
    expect(supportedCharts(records)).toContain('bubble');
    expect(chartCompatibilityReason(grouped, 'choropleth')).toMatch(/GeoJSON/);
  });
});
