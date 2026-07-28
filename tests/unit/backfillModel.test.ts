import { describe, expect, it } from 'vitest';
import {
  batchEvents,
  buildServerPropertyUpdates,
  createBackup,
  parseBackup,
  transformEvents,
  validateBackfillPlan
} from '@/features/backfill/model';
import type { BackfillPlan, FieldTransformation } from '@/features/backfill/types';

const timeframe = {
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-02-01T00:00:00.000Z'
};

function change(overrides: Partial<FieldTransformation> = {}): FieldTransformation {
  return {
    id: 'change-1',
    operation: 'set',
    targetPath: 'project_id',
    source: 'project-id',
    value: '',
    onlyIfMissing: false,
    missingSource: 'error',
    ...overrides
  };
}

function plan(overrides: Partial<BackfillPlan> = {}): BackfillPlan {
  return {
    mode: 'rebuild',
    selection: {
      projectId: 'project-123',
      collection: 'purchases',
      timeframe,
      filters: [{ property_name: 'country', operator: 'eq', property_value: 'US' }]
    },
    transformations: [change()],
    timestamp: { strategy: 'preserve', value: '' },
    ...overrides
  };
}

describe('Backfill Studio transformation model', () => {
  it('supports project IDs, generated IDs, copies, templates, missing-only writes, and removals', () => {
    const input = [{
      customer: { id: 'customer-7', stale: true },
      existing: 'keep',
      keen: {
        id: 'server-managed',
        created_at: '2026-01-02T00:00:01.000Z',
        timestamp: '2026-01-02T00:00:00.000Z'
      }
    }];
    const transformations = [
      change({ id: 'project', targetPath: 'project_id', source: 'project-id' }),
      change({ id: 'event', targetPath: 'event_id', source: 'uuid' }),
      change({ id: 'copy', targetPath: 'customer_id', source: 'copy', value: 'customer.id' }),
      change({ id: 'template', targetPath: 'reference', source: 'template', value: '{{project.id}}/{{customer.id}}/{{uuid}}' }),
      change({ id: 'only-missing', targetPath: 'existing', source: 'literal', value: '"replace"', onlyIfMissing: true }),
      change({ id: 'remove', operation: 'remove', targetPath: 'customer.stale' })
    ];
    const result = transformEvents(input, plan({ transformations }), () => 'fixed-uuid');

    expect(result.events).toEqual([{
      customer: { id: 'customer-7' },
      existing: 'keep',
      project_id: 'project-123',
      event_id: 'fixed-uuid',
      customer_id: 'customer-7',
      reference: 'project-123/customer-7/fixed-uuid',
      keen: { timestamp: '2026-01-02T00:00:00.000Z' }
    }]);
    expect(result.stats).toEqual({
      changedEvents: 1,
      skippedAssignments: 1,
      removedFields: 1,
      writtenFields: 4
    });
  });

  it('preserves historical timestamps by default and validates timestamp rewrites', () => {
    const event = {
      imported_at: '2025-12-31T23:59:59Z',
      keen: { timestamp: '2026-01-03T05:06:07-05:00' }
    };
    expect(transformEvents([event], plan()).events[0]).toHaveProperty('keen.timestamp', '2026-01-03T10:06:07.000Z');
    expect(transformEvents([event], plan({ timestamp: { strategy: 'copy', value: 'imported_at' } })).events[0])
      .toHaveProperty('keen.timestamp', '2025-12-31T23:59:59.000Z');
    expect(() => transformEvents([{ keen: {} }], plan())).toThrow(/valid ISO-8601 timestamp/);
  });

  it('uses server upsert only for static values and maps them to Keen property updates', () => {
    const upsert = plan({
      mode: 'server-upsert',
      transformations: [
        change({ id: 'project', targetPath: 'project_id', source: 'project-id' }),
        change({ id: 'literal', targetPath: 'status', source: 'literal', value: '"backfilled"' })
      ]
    });
    expect(validateBackfillPlan(upsert)).toEqual([]);
    expect(buildServerPropertyUpdates(upsert)).toEqual([
      { property_name: 'project_id', property_value: 'project-123', upsert_property: true },
      { property_name: 'status', property_value: 'backfilled', upsert_property: true }
    ]);
    expect(validateBackfillPlan({
      ...upsert,
      transformations: [change({ source: 'copy', value: 'customer.id' })]
    }).join(' ')).toMatch(/requires rebuild mode/);
  });

  it('rejects unsafe, duplicate, and Keen-managed target paths', () => {
    const errors = validateBackfillPlan(plan({
      transformations: [
        change({ id: 'a', targetPath: 'keen.id' }),
        change({ id: 'b', targetPath: '__proto__.polluted' }),
        change({ id: 'c', targetPath: 'duplicate' }),
        change({ id: 'd', targetPath: 'duplicate' }),
        change({ id: 'e', operation: 'remove', targetPath: 'remove_me', onlyIfMissing: true })
      ]
    })).join(' ');
    expect(errors).toMatch(/Keen-managed/);
    expect(errors).toMatch(/Unsafe property path/);
    expect(errors).toMatch(/changed more than once/);
    expect(errors).toMatch(/cannot combine remove with only-if-missing/);
  });

  it('creates a complete backup and refuses malformed or count-mismatched files', () => {
    const backup = createBackup(plan(), [{ keen: { timestamp: '2026-01-02T00:00:00Z' }, value: 3 }], '2026-02-02T00:00:00.000Z');
    expect(parseBackup(structuredClone(backup))).toEqual(backup);
    expect(() => parseBackup({ ...backup, eventCount: 2 })).toThrow(/count does not match/);
    expect(() => parseBackup({ ...backup, events: [null] })).toThrow(/malformed/);
  });

  it('batches recreation payloads without losing event order', () => {
    const events = Array.from({ length: 1_005 }, (_, index) => ({
      index,
      keen: { timestamp: '2026-01-02T00:00:00.000Z' }
    }));
    const batches = batchEvents('purchases', events);
    expect(batches.map((batch) => batch.length)).toEqual([1_000, 5]);
    expect(batches.flat().map((event) => event.index)).toEqual(events.map((event) => event.index));
  });
});
