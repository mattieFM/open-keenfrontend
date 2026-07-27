import { describe, expect, it } from 'vitest';
import {
  buildRecentEventsQuery,
  formatEventTimestamp,
  recentEventRows,
  STREAM_EVENT_LIMIT,
  STREAM_REFRESH_INTERVAL_MS
} from '@/features/streams/streamEvents';

describe('stream recent event helpers', () => {
  it('builds the bounded latest-ten extraction used by the live feed', () => {
    expect(buildRecentEventsQuery('purchases', ['amount', 'keen.timestamp'])).toEqual({
      analysis_type: 'extraction',
      event_collection: 'purchases',
      timeframe: 'this_14_days',
      latest: 10,
      property_names: ['keen.timestamp', 'amount']
    });
    expect(STREAM_EVENT_LIMIT).toBe(10);
    expect(STREAM_REFRESH_INTERVAL_MS).toBe(10_000);
  });

  it('returns at most ten distinct event rows with timestamps and previews', () => {
    const rows = recentEventRows({
      result: Array.from({ length: 14 }, (_, index) => ({
        keen: { timestamp: `2026-07-27T12:${String(index).padStart(2, '0')}:00.000Z` },
        customer: { id: index },
        amount: index * 5,
        active: index % 2 === 0
      }))
    });

    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      timestamp: '2026-07-27T12:00:00.000Z',
      preview: expect.stringContaining('amount: 0')
    });
    expect(new Set(rows.map((row) => row.key)).size).toBe(10);
  });

  it('normalizes non-object events and invalid timestamps without throwing', () => {
    expect(recentEventRows({ result: ['raw-value'] })[0]?.event).toEqual({ value: 'raw-value' });
    expect(formatEventTimestamp('not-a-date')).toEqual({ date: 'not-a-date', time: '' });
  });
});
