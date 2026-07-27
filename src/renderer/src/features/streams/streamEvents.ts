import type { QueryDraft } from '@shared/types';

export const STREAM_EVENT_LIMIT = 10;
export const STREAM_REFRESH_INTERVAL_MS = 10_000;

type EventRecord = Record<string, unknown>;

export type RecentEventRow = {
  event: EventRecord;
  key: string;
  preview: string;
  timestamp?: string;
};

function isRecord(value: unknown): value is EventRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function eventTimestamp(event: EventRecord): string | undefined {
  const keen = isRecord(event.keen) ? event.keen : undefined;
  const value = keen?.timestamp ?? keen?.created_at ?? event['keen.timestamp'] ?? event['keen.created_at'];
  return typeof value === 'string' ? value : undefined;
}

function previewValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (isRecord(value)) return `{${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}}`;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return serialized.length > 42 ? `${serialized.slice(0, 39)}...` : serialized;
}

function eventPreview(event: EventRecord): string {
  const entries = Object.entries(event).filter(([name]) => name !== 'keen' && !name.startsWith('keen.'));
  const shown = entries.slice(0, 4).map(([name, value]) => `${name}: ${previewValue(value)}`);
  if (!shown.length) return 'Keen metadata only';
  return `${shown.join('  |  ')}${entries.length > shown.length ? `  |  +${entries.length - shown.length} more` : ''}`;
}

export function buildRecentEventsQuery(collection: string, propertyNames: string[] = []): QueryDraft {
  const selectedProperties = [
    'keen.timestamp',
    ...propertyNames.filter((name) => name !== 'keen.timestamp')
  ].slice(0, 30);
  return {
    analysis_type: 'extraction',
    event_collection: collection,
    timeframe: 'this_14_days',
    latest: STREAM_EVENT_LIMIT,
    property_names: selectedProperties
  };
}

export function recentEventRows(data: unknown): RecentEventRow[] {
  const result = isRecord(data) && Array.isArray(data.result) ? data.result : [];
  return result.slice(0, STREAM_EVENT_LIMIT).map((value, index) => {
    const event = isRecord(value) ? value : { value };
    const timestamp = eventTimestamp(event);
    return {
      event,
      timestamp,
      preview: eventPreview(event),
      key: `${timestamp ?? 'event'}-${index}`
    };
  });
}

export function formatEventTimestamp(timestamp?: string): { date: string; time: string } {
  if (!timestamp) return { date: 'Timestamp unavailable', time: '' };
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return { date: timestamp, time: '' };
  return {
    date: value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  };
}
