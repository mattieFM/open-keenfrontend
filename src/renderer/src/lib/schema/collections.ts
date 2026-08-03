export type StreamSchema = {
  name: string;
  properties: Record<string, string>;
  /** Original service payload, retained for diagnostics and forward-compatible adapters. */
  raw?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeType(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ['type', 'data_type', 'property_type']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return undefined;
}

export function collectionName(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ['name', 'event_collection', 'collection']) {
    if (typeof record[key] === 'string' && (record[key] as string).trim()) return record[key] as string;
  }
  if (typeof record.url === 'string') {
    const segment = record.url.split('/').filter(Boolean).at(-1);
    if (!segment) return undefined;
    try { return decodeURIComponent(segment); } catch { return segment; }
  }
  return undefined;
}

const SCHEMA_WRAPPER_FIELDS = new Set(['name', 'event_collection', 'collection', 'url', 'schema', 'properties', 'event_schema']);

function flattenProperties(value: unknown, prefix = '', output: Record<string, string> = {}): Record<string, string> {
  const record = asRecord(value);
  if (!record) return output;
  for (const [name, typeValue] of Object.entries(record)) {
    if (!prefix && SCHEMA_WRAPPER_FIELDS.has(name)) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const type = normalizeType(typeValue);
    if (type) {
      output[path] = type;
      continue;
    }
    if (asRecord(typeValue)) flattenProperties(typeValue, path, output);
  }
  return output;
}

export function schemaProperties(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const candidates = [record.properties, record.schema, record.event_schema, record];
  for (const candidate of candidates) {
    const normalized = flattenProperties(candidate);
    if (Object.keys(normalized).length) return normalized;
  }
  return {};
}

export function parseCollectionList(value: unknown): StreamSchema[] {
  const rows: StreamSchema[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = collectionName(item);
      if (name) rows.push({ name, properties: schemaProperties(item), raw: item });
    }
  } else {
    const record = asRecord(value);
    const nested = record && (Array.isArray(record.collections) ? record.collections : Array.isArray(record.events) ? record.events : undefined);
    if (nested) return parseCollectionList(nested);
    if (record) {
      for (const [name, body] of Object.entries(record)) {
        if (['metadata', 'result'].includes(name)) continue;
        const explicitName = collectionName(body) ?? name;
        rows.push({ name: explicitName, properties: schemaProperties(body), raw: body });
      }
    }
  }
  const byName = new Map<string, StreamSchema>();
  for (const row of rows) {
    const existing = byName.get(row.name);
    byName.set(row.name, { name: row.name, properties: { ...(existing?.properties ?? {}), ...row.properties }, raw: row.raw ?? existing?.raw });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function parseCollectionDetail(value: unknown, fallbackName: string): StreamSchema {
  return { name: collectionName(value) ?? fallbackName, properties: schemaProperties(value), raw: value };
}

export function propertyNames(schema: StreamSchema): string[] {
  return Object.keys(schema.properties).sort((a, b) => a.localeCompare(b));
}

export function isNumericSchemaType(type: string | undefined): boolean {
  return Boolean(type && /(^|\b)(num|number|int|integer|float|double|decimal|long)(\b|$)/iu.test(type));
}

export function isStringSchemaType(type: string | undefined): boolean {
  return Boolean(type && /(^|\b)(string|str|text)(\b|$)/iu.test(type));
}

export function schemaFingerprint(schema: StreamSchema): string {
  const source = `${schema.name}|${Object.entries(schema.properties).sort(([a], [b]) => a.localeCompare(b)).map(([name, type]) => `${name}:${type}`).join('|')}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
