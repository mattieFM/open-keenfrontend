import type { ApiBridgeResponse, QueryDraft } from '@shared/types';

export const demoCollections = [
  { name: 'slack_stream', properties: { 'keen.timestamp': 'string', eventType: 'string', 'session.sessionId': 'string', 'session.eventId': 'string', 'session.machineId': 'string', 'session.gameId': 'string', 'session.status': 'string', 'session.dwellMs': 'num', 'session.result': 'num' } },
  { name: 'purchases', properties: { 'keen.timestamp': 'string', 'customer.id': 'string', amount: 'num', country: 'string', plan: 'string' } },
  { name: 'signups', properties: { 'keen.timestamp': 'string', 'user.id': 'string', plan: 'string', source: 'string' } },
  { name: 'pageviews', properties: { 'keen.timestamp': 'string', 'user.id': 'string', path: 'string', browser: 'string', duration_ms: 'num' } }
];

function intervalRows(): unknown[] {
  return Array.from({ length: 14 }, (_, index) => {
    const start = new Date(Date.now() - (13 - index) * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    return { timeframe: { start: start.toISOString(), end: end.toISOString() }, value: 60 + Math.round(Math.sin(index / 2) * 22 + index * 4) };
  });
}

export function demoQuery(query: QueryDraft): unknown {
  if (query.analysis_type === 'extraction') {
    return {
      result: Array.from({ length: Math.min(query.latest ?? 25, 25) }, (_, index) => ({
        keen: { timestamp: new Date(Date.now() - index * 3_600_000).toISOString() },
        customer: { id: `customer-${String(index + 1).padStart(3, '0')}` },
        amount: 19 + (index % 7) * 8.5,
        country: ['CA', 'US', 'GB', 'DE'][index % 4],
        plan: ['starter', 'growth', 'enterprise'][index % 3]
      }))
    };
  }
  if (query.analysis_type === 'funnel') return { result: [12540, 9870, 6340, 2912] };
  if (query.analysis_type === 'select_unique') {
    if (query.target_property === 'eventType') return { result: ['session_start', 'session_end'] };
    if (query.target_property === 'session.status') return { result: ['completed', 'abandoned'] };
    if (query.target_property === 'session.eventId') return { result: ['Builders Lab'] };
    if (query.target_property === 'session.gameId') return { result: ['word-grid', 'reaction-race', 'memory-match'] };
    if (query.target_property === 'session.machineId') return { result: ['tablet-01', 'tablet-02', 'tablet-03', 'tablet-04'] };
    return { result: ['CA', 'US', 'GB', 'DE', 'AU'] };
  }
  if (query.analysis_type === 'multi_analysis') return { result: { purchases: 4213, revenue: 188_492.2, average_order: 44.74 } };
  if (query.interval) return { result: intervalRows(), metadata: { processing_time: 0.014, scanned_events: 58420 } };
  if (query.group_by) return { result: [{ country: 'US', result: 1820 }, { country: 'CA', result: 1240 }, { country: 'GB', result: 760 }, { country: 'DE', result: 393 }] };
  return { result: query.analysis_type === 'average' ? 44.74 : query.analysis_type === 'sum' ? 188_492.2 : 4213, metadata: { processing_time: 0.009, scanned_events: 58420 } };
}

export function demoBridgeResponse(data: unknown): ApiBridgeResponse {
  return { status: 200, ok: true, headers: { 'content-type': 'application/json' }, rawText: JSON.stringify(data), elapsedMs: 18 };
}
