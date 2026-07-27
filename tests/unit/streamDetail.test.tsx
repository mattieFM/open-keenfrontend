import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamDetailPage } from '@/features/streams/StreamDetailPage';
import { STREAM_REFRESH_INTERVAL_MS } from '@/features/streams/streamEvents';

const mocks = vi.hoisted(() => {
  const credential = {
    id: 'read-key',
    workspaceId: 'workspace',
    label: 'Read key',
    type: 'read' as const,
    storageMode: 'memory' as const,
    hint: 'read-key',
    createdAt: new Date(0).toISOString()
  };
  const workspace = {
    id: 'workspace',
    localName: 'Test',
    projectId: 'project',
    analyticsBaseUrl: 'https://api.keen.io/3.0',
    dashboardServiceEnabled: false,
    credentials: [credential],
    capabilities: {},
    preferences: { defaultTimezone: 'UTC', queryConcurrency: 1, includeSchemaOnStreamList: false, dashboardPersistence: 'local' as const },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
  return {
    credential,
    workspace,
    client: {
      getCollection: vi.fn(),
      runQuery: vi.fn()
    }
  };
});

vi.mock('@/lib/api/useWorkspace', () => ({
  useWorkspaceContext: () => ({ workspace: mocks.workspace, client: mocks.client }),
  useOperationCredentials: () => ({
    candidates: [mocks.credential],
    select: () => mocks.credential
  })
}));

function eventResult() {
  return {
    data: {
      result: Array.from({ length: 14 }, (_, index) => ({
        keen: { timestamp: `2026-07-27T12:${String(index).padStart(2, '0')}:00.000Z` },
        event_number: index + 1
      }))
    },
    status: 200,
    headers: {},
    elapsedMs: 3,
    rawText: '',
    redactedRequest: { method: 'POST', url: 'https://api.keen.io', headers: {} }
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/w/workspace/streams/purchases']}>
        <Routes>
          <Route path="/w/:workspaceId/streams/:collection" element={<StreamDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('stream detail live event feed', () => {
  beforeEach(() => {
    mocks.client.getCollection.mockResolvedValue({
      data: { properties: { 'keen.timestamp': 'string', event_number: 'num' } },
      status: 200,
      headers: {},
      elapsedMs: 2,
      rawText: '',
      redactedRequest: { method: 'GET', url: 'https://api.keen.io', headers: {} }
    });
    mocks.client.runQuery.mockResolvedValue(eventResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.client.getCollection.mockReset();
    mocks.client.runQuery.mockReset();
  });

  it('renders the latest ten events as ten separate rows', async () => {
    renderPage();

    expect(await screen.findAllByTestId('recent-event-row')).toHaveLength(10);
    expect(mocks.client.runQuery).toHaveBeenCalledWith(
      mocks.credential,
      expect.objectContaining({ analysis_type: 'extraction', latest: 10 }),
      expect.any(AbortSignal)
    );
  });

  it('refreshes the event extraction automatically and can be paused', async () => {
    vi.useFakeTimers();
    renderPage();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.client.runQuery).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_REFRESH_INTERVAL_MS); });
    expect(mocks.client.runQuery).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('checkbox', { name: /auto-refresh/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_REFRESH_INTERVAL_MS * 2); });
    expect(mocks.client.runQuery).toHaveBeenCalledTimes(2);
  });
});
