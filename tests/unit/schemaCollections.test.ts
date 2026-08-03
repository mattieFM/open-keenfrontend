import { describe, expect, it } from 'vitest';
import { parseCollectionDetail, parseCollectionList, schemaProperties } from '@/lib/schema/collections';

describe('stream schema normalization', () => {
  it('preserves already flattened Keen property paths', () => {
    expect(schemaProperties({ properties: {
      eventType: 'string',
      'session.sessionId': 'string',
      'session.dwellMs': 'num'
    } })).toEqual({
      eventType: 'string',
      'session.sessionId': 'string',
      'session.dwellMs': 'num'
    });
  });

  it('flattens nested schema objects into Keen dot paths', () => {
    const detail = parseCollectionDetail({
      name: 'slack_stream',
      properties: {
        eventType: { type: 'string' },
        session: {
          sessionId: 'string',
          eventId: { data_type: 'string' },
          machineId: 'string',
          gameId: 'string',
          dwellMs: { property_type: 'num' }
        }
      }
    }, 'fallback');

    expect(detail.name).toBe('slack_stream');
    expect(detail.properties).toEqual({
      eventType: 'string',
      'session.sessionId': 'string',
      'session.eventId': 'string',
      'session.machineId': 'string',
      'session.gameId': 'string',
      'session.dwellMs': 'num'
    });
    expect(detail.raw).toBeDefined();
  });

  it('normalizes keyed and array collection-list responses', () => {
    expect(parseCollectionList({
      slack_stream: { properties: { eventType: 'string' } },
      purchases: { properties: { amount: 'num' } }
    }).map((stream) => stream.name)).toEqual(['purchases', 'slack_stream']);

    expect(parseCollectionList([
      { name: 'slack_stream', properties: { eventType: 'string' } },
      { event_collection: 'slack_stream', properties: { 'session.sessionId': 'string' } }
    ])).toEqual([expect.objectContaining({
      name: 'slack_stream',
      properties: { eventType: 'string', 'session.sessionId': 'string' }
    })]);
  });
});
