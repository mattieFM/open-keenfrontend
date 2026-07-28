import type { KeenFilter, QueryDraft } from '@shared/types';
import { validateQuery } from '../../lib/query/validation';
import type {
  BackfillBackup,
  BackfillPlan,
  EventRecord,
  FieldTransformation,
  TransformationStats
} from './types';

export const MAX_BACKFILL_EVENTS = 100_000;
export const MAX_BULK_BODY_BYTES = 8_000_000;
export const MAX_BULK_BATCH_EVENTS = 1_000;
export const MAX_EVENT_BYTES = 900_000;

type Lookup = { found: boolean; value?: unknown };
type MissingResolution = { skip: true } | { skip: false; value: unknown };

function isRecord(value: unknown): value is EventRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pathSegments(path: string): string[] {
  const segments = path.split('.').map((segment) => segment.trim());
  if (!segments.length || segments.some((segment) => !segment)) throw new Error(`Invalid dotted property path "${path}".`);
  if (segments.some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment))) throw new Error(`Unsafe property path "${path}".`);
  return segments;
}

export function lookupPath(record: EventRecord, path: string): Lookup {
  let current: unknown = record;
  for (const segment of pathSegments(path)) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return { found: false };
    current = current[segment];
  }
  return { found: true, value: current };
}

export function setPath(record: EventRecord, path: string, value: unknown): void {
  const segments = pathSegments(path);
  let current = record;
  segments.slice(0, -1).forEach((segment) => {
    const existing = current[segment];
    if (existing === undefined) {
      current[segment] = {};
      current = current[segment] as EventRecord;
      return;
    }
    if (!isRecord(existing)) throw new Error(`Cannot write "${path}" because "${segment}" is not an object.`);
    current = existing;
  });
  current[segments.at(-1)!] = value;
}

export function deletePath(record: EventRecord, path: string): boolean {
  const segments = pathSegments(path);
  let current = record;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(current[segment])) return false;
    current = current[segment] as EventRecord;
  }
  return delete current[segments.at(-1)!];
}

export function parseLiteral(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try { return JSON.parse(trimmed); } catch { return text; }
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function missingValue(transformation: FieldTransformation, source: string): MissingResolution {
  if (transformation.missingSource === 'skip') return { skip: true };
  if (transformation.missingSource === 'null') return { skip: false, value: null };
  throw new Error(`Source "${source}" does not exist.`);
}

function templateValue(
  template: string,
  event: EventRecord,
  projectId: string,
  createId: () => string,
  transformation: FieldTransformation
): MissingResolution {
  let skipped = false;
  const value = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token: string) => {
    if (token === 'project.id') return projectId;
    if (token === 'uuid') return createId();
    const lookup = lookupPath(event, token);
    if (lookup.found) return stringifyTemplateValue(lookup.value);
    const missing = missingValue(transformation, token);
    if (missing.skip) { skipped = true; return ''; }
    return stringifyTemplateValue(missing.value);
  });
  return skipped ? { skip: true } : { skip: false, value };
}

function resolveValue(
  transformation: FieldTransformation,
  event: EventRecord,
  projectId: string,
  createId: () => string
): MissingResolution {
  if (transformation.source === 'literal') return { skip: false, value: parseLiteral(transformation.value) };
  if (transformation.source === 'project-id') return { skip: false, value: projectId };
  if (transformation.source === 'uuid') return { skip: false, value: createId() };
  if (transformation.source === 'template') return templateValue(transformation.value, event, projectId, createId, transformation);
  const lookup = lookupPath(event, transformation.value);
  return lookup.found ? { skip: false, value: structuredClone(lookup.value) } : missingValue(transformation, transformation.value);
}

function requireIsoTimestamp(value: unknown, context: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${context} must resolve to a valid ISO-8601 timestamp.`);
  return new Date(value).toISOString();
}

export function toRecreationEvent(event: EventRecord): EventRecord {
  const next = structuredClone(event);
  if (isRecord(next.keen)) {
    delete next.keen.id;
    delete next.keen.created_at;
  }
  return next;
}

export function transformEvents(
  events: EventRecord[],
  plan: BackfillPlan,
  createId: () => string = () => crypto.randomUUID()
): { events: EventRecord[]; stats: TransformationStats } {
  const stats: TransformationStats = { changedEvents: 0, skippedAssignments: 0, removedFields: 0, writtenFields: 0 };
  const transformed = events.map((original, eventIndex) => {
    const event = structuredClone(original);
    let changed = false;
    try {
      plan.transformations.forEach((transformation) => {
        const target = lookupPath(event, transformation.targetPath);
        if (transformation.onlyIfMissing && target.found) {
          stats.skippedAssignments += 1;
          return;
        }
        if (transformation.operation === 'remove') {
          if (deletePath(event, transformation.targetPath)) {
            stats.removedFields += 1;
            changed = true;
          } else {
            stats.skippedAssignments += 1;
          }
          return;
        }
        const resolved = resolveValue(transformation, event, plan.selection.projectId, createId);
        if (resolved.skip) {
          stats.skippedAssignments += 1;
          return;
        }
        setPath(event, transformation.targetPath, structuredClone(resolved.value));
        stats.writtenFields += 1;
        changed = true;
      });

      const originalTimestamp = lookupPath(original, 'keen.timestamp');
      if (plan.timestamp.strategy === 'preserve') {
        setPath(event, 'keen.timestamp', requireIsoTimestamp(originalTimestamp.value, `Event ${eventIndex + 1} keen.timestamp`));
      } else if (plan.timestamp.strategy === 'fixed') {
        setPath(event, 'keen.timestamp', requireIsoTimestamp(plan.timestamp.value, 'Fixed timestamp'));
        changed = true;
      } else {
        const copied = lookupPath(event, plan.timestamp.value);
        if (!copied.found) throw new Error(`Timestamp source "${plan.timestamp.value}" does not exist.`);
        setPath(event, 'keen.timestamp', requireIsoTimestamp(copied.value, `Event ${eventIndex + 1} timestamp source`));
        changed = true;
      }
    } catch (error) {
      throw new Error(`Event ${eventIndex + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (changed) stats.changedEvents += 1;
    return plan.mode === 'rebuild' ? toRecreationEvent(event) : event;
  });
  return { events: transformed, stats };
}

function duplicateTargets(transformations: FieldTransformation[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  transformations.forEach((transformation) => {
    const target = transformation.targetPath.trim();
    if (seen.has(target)) duplicates.add(target);
    seen.add(target);
  });
  return [...duplicates];
}

export function validateBackfillPlan(plan: BackfillPlan): string[] {
  const errors: string[] = [];
  const { selection } = plan;
  const query: QueryDraft = {
    analysis_type: 'count',
    event_collection: selection.collection,
    timeframe: selection.timeframe,
    filters: selection.filters
  };
  errors.push(...validateQuery(query));
  if (!selection.projectId.trim()) errors.push('Project ID is required.');
  if (plan.transformations.length === 0) errors.push('Add at least one field change.');
  plan.transformations.forEach((transformation, index) => {
    const label = `Change ${index + 1}`;
    if (!transformation.targetPath.trim()) errors.push(`${label} needs a target property.`);
    else {
      try { pathSegments(transformation.targetPath); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      if (transformation.targetPath === 'keen' || transformation.targetPath.startsWith('keen.')) errors.push(`${label} cannot target Keen-managed properties; use the timestamp controls.`);
    }
    if (transformation.operation === 'set' && ['copy', 'template'].includes(transformation.source) && !transformation.value.trim()) errors.push(`${label} needs a source property or template.`);
    if (transformation.operation === 'remove' && transformation.onlyIfMissing) errors.push(`${label} cannot combine remove with only-if-missing.`);
    if (transformation.operation === 'set' && transformation.source === 'literal') {
      try { parseLiteral(transformation.value); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
  });
  duplicateTargets(plan.transformations).forEach((target) => errors.push(`Target property "${target}" is changed more than once.`));
  if (plan.timestamp.strategy === 'fixed' && Number.isNaN(Date.parse(plan.timestamp.value))) errors.push('Fixed timestamp must be valid ISO-8601.');
  if (plan.timestamp.strategy === 'copy' && !plan.timestamp.value.trim()) errors.push('Timestamp copy mode needs a source property.');
  if (plan.mode === 'server-upsert') {
    if (plan.timestamp.strategy !== 'preserve') errors.push('Server upsert cannot rewrite timestamps.');
    plan.transformations.forEach((transformation, index) => {
      if (transformation.operation !== 'set' || !['literal', 'project-id'].includes(transformation.source)) errors.push(`Change ${index + 1} requires rebuild mode because server upsert accepts only constant values.`);
      if (transformation.onlyIfMissing) errors.push(`Change ${index + 1} requires rebuild mode for the only-if-missing guard. Add an exists=false selector instead to use server upsert.`);
    });
  }
  return [...new Set(errors)];
}

export function buildServerPropertyUpdates(plan: BackfillPlan): Array<Record<string, unknown>> {
  const errors = validateBackfillPlan(plan);
  if (errors.length) throw new Error(errors.join(' '));
  if (plan.mode !== 'server-upsert') throw new Error('Server property updates require server-upsert mode.');
  return plan.transformations.map((transformation) => ({
    property_name: transformation.targetPath,
    property_value: transformation.source === 'project-id' ? plan.selection.projectId : parseLiteral(transformation.value),
    upsert_property: true
  }));
}

export function countResult(data: unknown): number {
  if (!isRecord(data) || typeof data.result !== 'number' || !Number.isSafeInteger(data.result) || data.result < 0) throw new Error('Keen count response did not contain a non-negative integer result.');
  return data.result;
}

export function extractionEvents(data: unknown): EventRecord[] {
  const result = isRecord(data) && Array.isArray(data.result) ? data.result : Array.isArray(data) ? data : undefined;
  if (!result || !result.every(isRecord)) throw new Error('Keen extraction response did not contain an event array.');
  return result as EventRecord[];
}

export function createBackup(plan: BackfillPlan, events: EventRecord[], createdAt = new Date().toISOString()): BackfillBackup {
  return {
    kind: 'keen-backfill-backup',
    schemaVersion: 1,
    createdAt,
    projectId: plan.selection.projectId,
    collection: plan.selection.collection,
    selection: structuredClone(plan.selection),
    plan: structuredClone(plan),
    eventCount: events.length,
    events: structuredClone(events)
  };
}

export function parseBackup(value: unknown): BackfillBackup {
  if (!isRecord(value) || value.kind !== 'keen-backfill-backup' || value.schemaVersion !== 1) throw new Error('This is not a supported Keen Backfill Studio backup.');
  if (typeof value.projectId !== 'string' || typeof value.collection !== 'string') throw new Error('Backup project or collection metadata is missing.');
  if (!Array.isArray(value.events) || !value.events.every(isRecord)) throw new Error('Backup events are missing or malformed.');
  if (value.eventCount !== value.events.length) throw new Error('Backup event count does not match its payload.');
  return value as unknown as BackfillBackup;
}

export function batchEvents(collection: string, events: EventRecord[]): EventRecord[][] {
  const batches: EventRecord[][] = [];
  let current: EventRecord[] = [];
  events.forEach((event, index) => {
    const eventBytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (eventBytes > MAX_EVENT_BYTES) throw new Error(`Event ${index + 1} exceeds the ${MAX_EVENT_BYTES.toLocaleString()} byte safety limit.`);
    const candidate = [...current, event];
    const bodyBytes = new TextEncoder().encode(JSON.stringify({ [collection]: candidate })).byteLength;
    if (current.length && (candidate.length > MAX_BULK_BATCH_EVENTS || bodyBytes > MAX_BULK_BODY_BYTES)) {
      batches.push(current);
      current = [event];
    } else {
      current = candidate;
    }
  });
  if (current.length) batches.push(current);
  return batches;
}

export function failedBulkIndexes(data: unknown): number[] {
  if (!isRecord(data)) return [];
  const statuses = Object.values(data).find(Array.isArray);
  if (!Array.isArray(statuses)) return [];
  const failed: number[] = [];
  statuses.forEach((value, index) => {
    const status = isRecord(value) ? value : {};
    if (status.success === false || status.error) failed.push(index);
  });
  return failed;
}

export function filterCount(filters: KeenFilter[]): number {
  return filters.reduce((total, filter) => total + (filter.operator === 'or' && Array.isArray(filter.operands) ? filterCount(filter.operands) : 1), 0);
}
