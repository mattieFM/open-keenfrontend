import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackfillPage } from '@/features/backfill/BackfillPage';

const mocks = vi.hoisted(() => {
  const credential = {
    id: 'master-key',
    workspaceId: 'workspace',
    label: 'Project Master',
    type: 'master' as const,
    storageMode: 'memory' as const,
    hint: 'mast-key',
    createdAt: '2026-01-01T00:00:00.000Z'
  };
  const workspace = {
    id: 'workspace',
    localName: 'Test project',
    projectId: 'project-123',
    analyticsBaseUrl: 'https://api.keen.io/3.0',
    dashboardServiceEnabled: false,
    credentials: [credential],
    capabilities: {},
    preferences: {
      defaultTimezone: 'UTC',
      queryConcurrency: 1,
      includeSchemaOnStreamList: false,
      dashboardPersistence: 'local' as const
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  return {
    credential,
    workspace,
    client: {
      listCollections: vi.fn(),
      getCollection: vi.fn()
    }
  };
});

vi.mock('@/lib/api/useWorkspace', () => ({
  useWorkspaceContext: () => ({
    workspace: mocks.workspace,
    client: mocks.client,
    runtimeMode: 'read-only'
  }),
  useOperationCredentials: () => ({
    candidates: [mocks.credential],
    select: () => mocks.credential
  })
}));

function apiResponse<T>(data: T) {
  return {
    data,
    status: 200,
    headers: {},
    elapsedMs: 1,
    rawText: '',
    redactedRequest: { method: 'GET' as const, url: 'https://api.keen.io/redacted', headers: {} }
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BackfillPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function fieldControl<T extends HTMLElement>(label: string, selector: string): T {
  const control = screen.getByText(label, { selector: '.field__label' }).closest('label')?.querySelector(selector);
  if (!control) throw new Error(`Control for "${label}" was not rendered.`);
  return control as T;
}

describe('Backfill Studio UI', () => {
  beforeEach(() => {
    mocks.client.listCollections.mockResolvedValue(apiResponse([{ name: 'orders' }, { name: 'purchases' }]));
    mocks.client.getCollection.mockResolvedValue(apiResponse({
      properties: {
        'customer.id': 'string',
        'keen.timestamp': 'datetime',
        status: 'string'
      }
    }));
  });

  it('exposes the guarded selection, transformation, backup, and restore surfaces', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Backfill Studio' })).toBeVisible();
    expect(fieldControl<HTMLSelectElement>('Master Key', 'select')).toHaveValue('master-key');
    expect(fieldControl<HTMLSelectElement>('Execution method', 'select')).toHaveValue('server-upsert');
    expect(screen.getByRole('button', { name: /Count, extract, and save full backup/i })).toBeEnabled();
    expect(screen.getByText(/Full backup required/i)).toBeVisible();
    expect(screen.getByText(/Remote changes are disabled/i)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Raw JSON' }));
    expect(fieldControl<HTMLTextAreaElement>('Filters JSON', 'textarea')).toHaveValue('[]');
    fireEvent.change(fieldControl<HTMLTextAreaElement>('Filters JSON', 'textarea'), { target: { value: '{}' } });
    expect(screen.getAllByText('Filters must be a JSON array.')).toHaveLength(2);

    fireEvent.change(fieldControl<HTMLSelectElement>('Execution method', 'select'), { target: { value: 'rebuild' } });
    expect(screen.getByText('Rebuild mode deletes first')).toBeVisible();
    expect(screen.getByText('Timestamp handling')).toBeVisible();
    expect(fieldControl<HTMLSelectElement>('Strategy', 'select')).toHaveValue('preserve');

    fireEvent.click(screen.getByRole('button', { name: /Add field change/i }));
    expect(screen.getAllByLabelText(/target property/i)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    expect(screen.getByRole('heading', { name: 'Open a Backfill Studio backup' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Choose backup JSON/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /Restore once/i })).toBeDisabled();
  });
});
