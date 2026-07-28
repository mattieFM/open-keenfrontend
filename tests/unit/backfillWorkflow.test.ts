import { describe, expect, it, vi } from 'vitest';
import type { CredentialMeta, KeenResponse } from '@shared/types';
import type { BackfillPlan, EventRecord, PreparedBackfill } from '@/features/backfill/types';
import {
  BackfillExecutionError,
  executePreparedBackfill,
  prepareBackfill,
  restoreBackup,
  type BackfillClient
} from '@/features/backfill/workflow';
import { createBackup } from '@/features/backfill/model';
import { sha256 } from '@/lib/maintenance/scope';

const credential: CredentialMeta = {
  id: 'master',
  workspaceId: 'workspace',
  label: 'Master',
  type: 'master',
  storageMode: 'memory',
  hint: 'master-key',
  createdAt: '2026-01-01T00:00:00.000Z'
};

function response<T>(data: T): KeenResponse<T> {
  return {
    data,
    status: 200,
    headers: {},
    elapsedMs: 1,
    rawText: JSON.stringify(data),
    redactedRequest: { method: 'POST', url: 'https://api.keen.io/redacted', headers: {} }
  };
}

function plan(mode: BackfillPlan['mode'] = 'rebuild'): BackfillPlan {
  return {
    mode,
    selection: {
      projectId: 'project-123',
      collection: 'orders',
      timeframe: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z'
      },
      filters: [{ property_name: 'status', operator: 'eq', property_value: 'legacy' }]
    },
    transformations: [{
      id: 'change',
      operation: 'set',
      targetPath: 'project_id',
      source: 'project-id',
      value: '',
      onlyIfMissing: false,
      missingSource: 'error'
    }],
    timestamp: { strategy: 'preserve', value: '' }
  };
}

function event(index: number): EventRecord {
  return {
    index,
    status: 'legacy',
    keen: {
      id: `keen-${index}`,
      created_at: '2026-01-02T00:00:01.000Z',
      timestamp: `2026-01-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`
    }
  };
}

async function restorableBackup(events: EventRecord[]) {
  const backup = createBackup(plan(), events);
  backup.backupHash = await sha256(backup);
  return backup;
}

function client(overrides: Partial<BackfillClient> = {}): BackfillClient {
  return {
    runQuery: vi.fn().mockResolvedValue(response({ result: 2 })),
    runExtraction: vi.fn().mockResolvedValue(response({ result: [event(0), event(1)] })),
    updateEvents: vi.fn().mockResolvedValue(response({ updated_events: 2 })),
    deleteFilteredEvents: vi.fn().mockResolvedValue(response({ deleted_events: 2 })),
    recordEvents: vi.fn().mockResolvedValue(response({ orders: [{ success: true }, { success: true }] })),
    ...overrides
  };
}

async function prepared(mode: BackfillPlan['mode'] = 'rebuild'): Promise<PreparedBackfill> {
  const migration = plan(mode);
  const originalEvents = [event(0), event(1)];
  return {
    plan: migration,
    scopeHash: await sha256(migration),
    backupHash: 'backup-hash',
    backupPath: 'C:\\backups\\orders.json',
    count: 2,
    originalEvents,
    replacementEvents: originalEvents.map((item) => ({
      index: item.index,
      status: 'legacy',
      project_id: 'project-123',
      keen: { timestamp: (item.keen as EventRecord).timestamp }
    })),
    stats: { changedEvents: 2, skippedAssignments: 0, removedFields: 0, writtenFields: 2 },
    preparedAt: '2026-02-02T00:00:00.000Z'
  };
}

describe('Backfill Studio guarded workflow', () => {
  it('counts, fully extracts, transforms, and saves the absolute backup before arming', async () => {
    const api = client();
    const saveBackup = vi.fn().mockResolvedValue({ saved: true, path: 'C:\\backups\\orders.json' });
    const result = await prepareBackfill({
      client: api,
      credential,
      plan: plan(),
      saveBackup
    });

    expect(api.runQuery).toHaveBeenCalledTimes(1);
    expect(api.runExtraction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.runExtraction).mock.calls[0]?.[1]).toMatchObject({
      analysis_type: 'extraction',
      event_collection: 'orders',
      timeframe: plan().selection.timeframe,
      filters: plan().selection.filters,
      include_metadata: false
    });
    expect(saveBackup).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(saveBackup.mock.calls[0][0].content) as Record<string, unknown>;
    expect(saved).toMatchObject({ kind: 'keen-backfill-backup', eventCount: 2 });
    expect(saved.events).toHaveLength(2);
    expect(saved.backupHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.backupPath).toBe('C:\\backups\\orders.json');
    expect(api.updateEvents).not.toHaveBeenCalled();
    expect(api.deleteFilteredEvents).not.toHaveBeenCalled();
    expect(api.recordEvents).not.toHaveBeenCalled();
  });

  it('does not arm on backup cancellation or an incomplete extraction', async () => {
    await expect(prepareBackfill({
      client: client(),
      credential,
      plan: plan(),
      saveBackup: vi.fn().mockResolvedValue({ saved: false })
    })).rejects.toThrow(/cancelled/);

    const incomplete = client({
      runExtraction: vi.fn().mockResolvedValue(response({ result: [event(0)] }))
    });
    const saveBackup = vi.fn();
    await expect(prepareBackfill({
      client: incomplete,
      credential,
      plan: plan(),
      saveBackup
    })).rejects.toThrow(/Full-backup gate failed/);
    expect(saveBackup).not.toHaveBeenCalled();
  });

  it('submits static upserts as one locked Master update without deleting', async () => {
    const api = client();
    const ready = await prepared('server-upsert');
    const result = await executePreparedBackfill({
      client: api,
      credential,
      prepared: ready,
      currentPlan: structuredClone(ready.plan)
    });

    expect(result).toMatchObject({ mode: 'server-upsert', affectedEvents: 2 });
    expect(api.updateEvents).toHaveBeenCalledWith(credential, 'orders', {
      timeframe: ready.plan.selection.timeframe,
      filters: ready.plan.selection.filters,
      property_updates: [{
        property_name: 'project_id',
        property_value: 'project-123',
        upsert_property: true
      }]
    });
    expect(api.deleteFilteredEvents).not.toHaveBeenCalled();
    expect(api.recordEvents).not.toHaveBeenCalled();
  });

  it('deletes only the backed-up selector, then recreates original timestamps without server IDs', async () => {
    const calls: string[] = [];
    const api = client({
      deleteFilteredEvents: vi.fn(async () => {
        calls.push('delete');
        return response({ deleted_events: 2 });
      }),
      recordEvents: vi.fn(async (_credential, payload) => {
        calls.push('recreate');
        expect(payload.orders[0]).not.toHaveProperty('keen.id');
        expect(payload.orders[0]).not.toHaveProperty('keen.created_at');
        expect(payload.orders[0]).toHaveProperty('keen.timestamp');
        return response({ orders: payload.orders.map(() => ({ success: true })) });
      })
    });
    const ready = await prepared();
    const result = await executePreparedBackfill({
      client: api,
      credential,
      prepared: ready,
      currentPlan: structuredClone(ready.plan)
    });

    expect(calls).toEqual(['delete', 'recreate']);
    expect(api.deleteFilteredEvents).toHaveBeenCalledWith(credential, 'orders', {
      timeframe: ready.plan.selection.timeframe,
      filters: ready.plan.selection.filters
    });
    expect(result).toMatchObject({ mode: 'rebuild', affectedEvents: 2, batches: 1 });
  });

  it('stops after a recreation failure and exposes the exact saved recovery path', async () => {
    const api = client({
      recordEvents: vi.fn().mockRejectedValue(new Error('offline'))
    });
    const ready = await prepared();
    await expect(executePreparedBackfill({
      client: api,
      credential,
      prepared: ready,
      currentPlan: structuredClone(ready.plan)
    })).rejects.toMatchObject({
      name: 'BackfillExecutionError',
      stage: 'recreate',
      nextEventIndex: 0
    });
    await expect(executePreparedBackfill({
      client: api,
      credential,
      prepared: ready,
      currentPlan: structuredClone(ready.plan)
    })).rejects.toThrow(/C:\\backups\\orders\.json/);
    expect(api.recordEvents).toHaveBeenCalledTimes(2);
  });

  it('locks execution to the backed-up plan and rejects cross-project restores', async () => {
    const api = client();
    const ready = await prepared();
    const changed = structuredClone(ready.plan);
    changed.selection.filters = [];
    await expect(executePreparedBackfill({
      client: api,
      credential,
      prepared: ready,
      currentPlan: changed
    })).rejects.toThrow(/changed after backup/);
    expect(api.deleteFilteredEvents).not.toHaveBeenCalled();

    const backup = await restorableBackup([event(0)]);
    await expect(restoreBackup({
      client: api,
      credential,
      backup,
      expectedProjectId: 'some-other-project'
    })).rejects.toThrow(/belongs to project/);
    expect(api.recordEvents).not.toHaveBeenCalled();
  });

  it('restores from a resumable index and preserves every original timestamp', async () => {
    const api = client({
      recordEvents: vi.fn(async (_credential, payload) => {
        expect(payload.orders).toHaveLength(2);
        expect(payload.orders[0]).toHaveProperty('index', 1);
        expect(payload.orders[0]).toHaveProperty('keen.timestamp', '2026-01-03T00:00:00.000Z');
        expect(payload.orders[0]).not.toHaveProperty('keen.id');
        return response({ orders: payload.orders.map(() => ({ success: true })) });
      })
    });
    const backup = await restorableBackup([event(0), event(1), event(2)]);
    const result = await restoreBackup({
      client: api,
      credential,
      backup,
      expectedProjectId: 'project-123',
      startIndex: 1
    });
    expect(result).toMatchObject({ mode: 'restore', affectedEvents: 2, batches: 1 });
    expect(api.recordEvents).toHaveBeenCalledTimes(1);
  });

  it('reports the next restore index without retrying a failed batch', async () => {
    const api = client({
      recordEvents: vi.fn().mockResolvedValue(response({ orders: [{ success: false, error: 'invalid' }] }))
    });
    const backup = await restorableBackup([event(0)]);
    let caught: unknown;
    try {
      await restoreBackup({ client: api, credential, backup, expectedProjectId: 'project-123' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BackfillExecutionError);
    expect(caught).toMatchObject({ stage: 'restore', nextEventIndex: 0 });
    expect(api.recordEvents).toHaveBeenCalledTimes(1);
  });
  it('refuses a backup whose event payload changed after saving', async () => {
    const api = client();
    const backup = await restorableBackup([event(0)]);
    backup.events[0].status = 'tampered';
    await expect(restoreBackup({
      client: api,
      credential,
      backup,
      expectedProjectId: 'project-123'
    })).rejects.toThrow(/integrity check failed/);
    expect(api.recordEvents).not.toHaveBeenCalled();
  });
});
