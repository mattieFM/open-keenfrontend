import { describe, expect, it } from 'vitest';
import { countBatchEvents, failedItemsFromResponse } from '@/features/eventWriter/EventWriterPage';

describe('bulk event partial-success handling', () => {
  it('maps only explicitly failed result entries back to original events', () => {
    const payload = {
      purchases: [{ id: 1 }, { id: 2 }, { id: 3 }],
      signups: [{ id: 'a' }]
    };
    const result = {
      purchases: [{ success: true }, { success: false, error: 'invalid' }, { success: true }],
      signups: [{ error: { code: 'bad' } }]
    };
    const failed = failedItemsFromResponse(payload, result);
    expect(failed).toEqual({ purchases: [{ id: 2 }], signups: [{ id: 'a' }] });
    expect(countBatchEvents(failed)).toBe(2);
  });

  it('does not guess when the server response cannot be mapped', () => {
    expect(failedItemsFromResponse({ purchases: [{ id: 1 }] }, { other: [{ success: false }] })).toEqual({});
  });
});
