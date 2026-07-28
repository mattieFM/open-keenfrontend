import type { CredentialMeta, KeenResponse, QueryDraft } from '@shared/types';
import { sha256 } from '../../lib/maintenance/scope';
import {
  batchEvents,
  buildServerPropertyUpdates,
  countResult,
  createBackup,
  extractionEvents,
  failedBulkIndexes,
  lookupPath,
  MAX_BACKFILL_EVENTS,
  toRecreationEvent,
  transformEvents,
  validateBackfillPlan
} from './model';
import type {
  BackfillBackup,
  BackfillExecutionResult,
  BackfillPlan,
  BackfillProgress,
  EventRecord,
  PreparedBackfill
} from './types';

export type BackfillClient = {
  runQuery(credential: CredentialMeta, query: QueryDraft, signal?: AbortSignal): Promise<KeenResponse<Record<string, unknown>>>;
  runExtraction(credential: CredentialMeta, query: QueryDraft, binary?: boolean, signal?: AbortSignal): Promise<KeenResponse<Record<string, unknown>>>;
  updateEvents(credential: CredentialMeta, collection: string, body: Record<string, unknown>): Promise<KeenResponse<unknown>>;
  deleteFilteredEvents(credential: CredentialMeta, collection: string, scope: { filters?: BackfillPlan['selection']['filters']; timeframe?: BackfillPlan['selection']['timeframe'] }): Promise<KeenResponse<unknown>>;
  recordEvents(credential: CredentialMeta, events: Record<string, EventRecord[]>): Promise<KeenResponse<unknown>>;
};

export type SaveBackup = (input: { suggestedName: string; content: string }) => Promise<{ saved: boolean; path?: string }>;

export class BackfillExecutionError extends Error {
  constructor(
    message: string,
    readonly stage: 'delete' | 'update' | 'recreate' | 'restore',
    readonly nextEventIndex?: number
  ) {
    super(message);
    this.name = 'BackfillExecutionError';
  }
}

export async function verifyBackupIntegrity(backup: BackfillBackup): Promise<void> {
  const { backupHash, ...payload } = backup;
  if (!backupHash || !/^[a-f0-9]{64}$/.test(backupHash)) {
    throw new Error('Backup integrity hash is missing or malformed.');
  }
  if (await sha256(payload) !== backupHash) {
    throw new Error('Backup integrity check failed. The file changed after it was saved.');
  }
}

function backupFileName(plan: BackfillPlan, createdAt: string): string {
  const collection = plan.selection.collection.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'events';
  const timestamp = createdAt.replace(/[:.]/g, '-');
  return `${collection}-${plan.mode}-backup-${timestamp}.json`;
}

export async function prepareBackfill(input: {
  client: BackfillClient;
  credential: CredentialMeta;
  plan: BackfillPlan;
  saveBackup: SaveBackup;
  createId?: () => string;
  signal?: AbortSignal;
}): Promise<PreparedBackfill> {
  const { client, credential, plan, saveBackup, createId, signal } = input;
  const errors = validateBackfillPlan(plan);
  if (errors.length) throw new Error(errors.join(' '));
  const queryBase: QueryDraft = {
    analysis_type: 'count',
    event_collection: plan.selection.collection,
    timeframe: plan.selection.timeframe,
    filters: plan.selection.filters,
    include_metadata: true
  };
  const countResponse = await client.runQuery(credential, queryBase, signal);
  const count = countResult(countResponse.data);
  if (count === 0) throw new Error('The exact selector matched zero events. Nothing was backed up or armed.');
  if (count > MAX_BACKFILL_EVENTS) throw new Error(`The selector matched ${count.toLocaleString()} events. Keen limits filtered maintenance to ${MAX_BACKFILL_EVENTS.toLocaleString()}; split the absolute timeframe and run separate reviewed migrations.`);

  const extractionQuery: QueryDraft = {
    ...queryBase,
    analysis_type: 'extraction',
    include_metadata: false
  };
  const extractionResponse = await client.runExtraction(credential, extractionQuery, false, signal);
  const originalEvents = extractionEvents(extractionResponse.data);
  if (originalEvents.length !== count) {
    throw new Error(`Full-backup gate failed: count returned ${count.toLocaleString()} but extraction returned ${originalEvents.length.toLocaleString()} events. No mutation was armed.`);
  }

  const transformed = transformEvents(originalEvents, plan, createId);
  const createdAt = new Date().toISOString();
  const backup = createBackup(plan, originalEvents, createdAt);
  const backupHash = await sha256(backup);
  const content = JSON.stringify({ ...backup, backupHash }, null, 2);
  const saved = await saveBackup({ suggestedName: backupFileName(plan, createdAt), content });
  if (!saved.saved || !saved.path) throw new Error('Backup save was cancelled. No mutation was armed.');

  return {
    plan: structuredClone(plan),
    scopeHash: await sha256(plan),
    backupHash,
    backupPath: saved.path,
    count,
    originalEvents,
    replacementEvents: transformed.events,
    stats: transformed.stats,
    preparedAt: createdAt
  };
}

export async function executePreparedBackfill(input: {
  client: BackfillClient;
  credential: CredentialMeta;
  prepared: PreparedBackfill;
  currentPlan: BackfillPlan;
  onProgress?: (progress: BackfillProgress) => void;
}): Promise<BackfillExecutionResult> {
  const { client, credential, prepared, currentPlan, onProgress } = input;
  if (await sha256(currentPlan) !== prepared.scopeHash) throw new Error('The selector or field changes changed after backup. Save a new full backup and preview again.');
  if (prepared.plan.mode === 'server-upsert') {
    onProgress?.({ stage: 'updating', completed: 0, total: prepared.count, message: 'Submitting one non-retried Master-key update.' });
    try {
      const response = await client.updateEvents(credential, prepared.plan.selection.collection, {
        timeframe: prepared.plan.selection.timeframe,
        filters: prepared.plan.selection.filters,
        property_updates: buildServerPropertyUpdates(prepared.plan)
      });
      const record = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {};
      const affectedEvents = typeof record.updated_events === 'number' ? record.updated_events : prepared.count;
      onProgress?.({ stage: 'complete', completed: affectedEvents, total: prepared.count, message: 'Server upsert completed.' });
      return { mode: 'server-upsert', affectedEvents, response: response.data };
    } catch (error) {
      throw new BackfillExecutionError(error instanceof Error ? error.message : String(error), 'update');
    }
  }

  onProgress?.({ stage: 'deleting', completed: 0, total: prepared.count, message: 'Deleting the exact backed-up selection.' });
  try {
    await client.deleteFilteredEvents(credential, prepared.plan.selection.collection, {
      timeframe: prepared.plan.selection.timeframe,
      filters: prepared.plan.selection.filters
    });
  } catch (error) {
    throw new BackfillExecutionError(error instanceof Error ? error.message : String(error), 'delete', 0);
  }

  const batches = batchEvents(prepared.plan.selection.collection, prepared.replacementEvents);
  let completed = 0;
  for (const [batchIndex, batch] of batches.entries()) {
    onProgress?.({
      stage: 'recreating',
      completed,
      total: prepared.count,
      message: `Recreating batch ${batchIndex + 1} of ${batches.length}.`
    });
    try {
      const response = await client.recordEvents(credential, { [prepared.plan.selection.collection]: batch });
      const failed = failedBulkIndexes(response.data);
      if (failed.length) throw new Error(`Keen rejected ${failed.length} event${failed.length === 1 ? '' : 's'} in batch ${batchIndex + 1}.`);
      completed += batch.length;
    } catch (error) {
      throw new BackfillExecutionError(
        `${error instanceof Error ? error.message : String(error)} Use the saved backup at ${prepared.backupPath} for recovery. No automatic retry was attempted.`,
        'recreate',
        completed
      );
    }
  }
  onProgress?.({ stage: 'complete', completed, total: prepared.count, message: 'All backed-up events were recreated.' });
  return { mode: 'rebuild', affectedEvents: completed, batches: batches.length };
}

function validBackupTimestamp(event: EventRecord, index: number): void {
  const timestamp = lookupPath(event, 'keen.timestamp');
  if (!timestamp.found || typeof timestamp.value !== 'string' || Number.isNaN(Date.parse(timestamp.value))) {
    throw new Error(`Backup event ${index + 1} does not have a valid keen.timestamp.`);
  }
}

export async function restoreBackup(input: {
  client: BackfillClient;
  credential: CredentialMeta;
  backup: BackfillBackup;
  expectedProjectId: string;
  startIndex?: number;
  onProgress?: (progress: BackfillProgress) => void;
}): Promise<BackfillExecutionResult> {
  const { client, credential, backup, expectedProjectId, onProgress } = input;
  await verifyBackupIntegrity(backup);
  if (backup.projectId !== expectedProjectId) throw new Error(`Backup belongs to project ${backup.projectId}, not ${expectedProjectId}.`);
  const startIndex = input.startIndex ?? 0;
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > backup.events.length) throw new Error('Restore start index is outside the backup event range.');
  const events = backup.events.slice(startIndex).map((event, index) => {
    validBackupTimestamp(event, startIndex + index);
    return toRecreationEvent(event);
  });
  const batches = batchEvents(backup.collection, events);
  let completed = 0;
  for (const [batchIndex, batch] of batches.entries()) {
    onProgress?.({
      stage: 'restoring',
      completed,
      total: events.length,
      message: `Restoring batch ${batchIndex + 1} of ${batches.length}.`
    });
    try {
      const response = await client.recordEvents(credential, { [backup.collection]: batch });
      const failed = failedBulkIndexes(response.data);
      if (failed.length) throw new Error(`Keen rejected ${failed.length} restored event${failed.length === 1 ? '' : 's'} in batch ${batchIndex + 1}.`);
      completed += batch.length;
    } catch (error) {
      throw new BackfillExecutionError(error instanceof Error ? error.message : String(error), 'restore', startIndex + completed);
    }
  }
  onProgress?.({ stage: 'complete', completed, total: events.length, message: 'Backup restore completed.' });
  return { mode: 'restore', affectedEvents: completed, batches: batches.length };
}
