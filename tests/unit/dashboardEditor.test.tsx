import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardDocument } from '@shared/types';
import { DashboardEditorPage } from '@/features/dashboards/DashboardEditorPage';
import { createDashboard } from '@/lib/dashboard/model';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  publish: vi.fn(),
  navigate: vi.fn(),
  workspace: {
    id: 'workspace',
    projectId: 'test-project',
    analyticsBaseUrl: 'https://api.keen.io/3.0',
    dashboardServiceEnabled: false,
    preferences: { defaultTimezone: 'UTC' }
  },
  credential: {
    id: 'master',
    label: 'Test key',
    type: 'master' as const,
    workspaceId: 'workspace',
    storageMode: 'memory' as const,
    hint: 'test',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useParams: () => ({ dashboardId: 'dashboard' }),
  useNavigate: () => mocks.navigate
}));
vi.mock('@/lib/db/database', () => ({ db: { dashboards: { get: mocks.get, put: mocks.put } } }));
vi.mock('@/lib/api/useWorkspace', () => ({
  useWorkspaceContext: () => ({
    workspace: mocks.workspace,
    workspaceId: 'workspace',
    dashboardClient: { put: mocks.publish },
    runtimeMode: 'changes-enabled'
  }),
  useOperationCredentials: () => ({ candidates: [mocks.credential] })
}));
vi.mock('@/features/dashboards/DashboardCanvas', () => ({
  DashboardCanvas: ({ document, onChange }: { document: DashboardDocument; onChange(document: DashboardDocument): void }) => (
    <button onClick={() => onChange({ ...document, layout: document.layout.map((item) => ({ ...item, x: 6 })) })}>Move test widget</button>
  )
}));

let stored: DashboardDocument;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function delayNextSave() {
  const saving = deferred();
  mocks.put.mockImplementationOnce(async (document: DashboardDocument) => {
    await saving.promise;
    stored = structuredClone(document);
    return document.id;
  });
  return saving;
}

async function renderEditor() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<MemoryRouter><DashboardEditorPage /></MemoryRouter>); });
  expect(screen.getByText('Saved locally')).toBeInTheDocument();
  return view;
}

function rename(title: string) {
  fireEvent.change(screen.getByLabelText('Dashboard title'), { target: { value: title } });
}

describe('dashboard editor local saving', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stored = {
      ...createDashboard('workspace', 'Original dashboard'),
      id: 'dashboard',
      widgets: [{ id: 'text', type: 'text', markdown: 'Test dashboard' }],
      layout: [{ i: 'text', x: 0, y: 0, w: 6, h: 4 }]
    };
    mocks.workspace.dashboardServiceEnabled = false;
    mocks.get.mockReset().mockImplementation(async () => structuredClone(stored));
    mocks.put.mockReset().mockImplementation(async (document: DashboardDocument) => {
      stored = structuredClone(document);
      return document.id;
    });
    mocks.publish.mockReset().mockResolvedValue(undefined);
    mocks.navigate.mockReset();
  });

  afterEach(async () => {
    await act(async () => { cleanup(); });
    vi.useRealTimers();
  });

  it.each([
    ['Preview', '/w/workspace/dashboards/dashboard/view'],
    ['Dashboards', '/w/workspace/dashboards']
  ])('saves a pending edit before navigating with %s', async (button, path) => {
    await renderEditor();
    const saving = delayNextSave();
    rename('Latest edit');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: button, exact: true })); });

    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'Latest edit' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await act(async () => { saving.resolve(); });
    expect(stored.title).toBe('Latest edit');
    expect(mocks.navigate).toHaveBeenCalledWith(path);
  });

  it('flushes a pending layout change when the editor unmounts', async () => {
    const view = await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Move test widget' }));
    expect(mocks.put).not.toHaveBeenCalled();

    await act(async () => { view.unmount(); });
    expect(stored.layout[0].x).toBe(6);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });

  it('cancels the debounced edit when Undo restores the previous document', async () => {
    await renderEditor();
    rename('Undone edit');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    await act(async () => { vi.advanceTimersByTime(1000); });

    expect(screen.getByLabelText('Dashboard title')).toHaveValue('Original dashboard');
    expect(stored.title).toBe('Original dashboard');
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saved locally')).toBeInTheDocument();
  });

  it('writes Undo after an older in-flight save finishes', async () => {
    await renderEditor();
    const saving = delayNextSave();
    rename('In-flight edit');
    await act(async () => { vi.advanceTimersByTime(900); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await act(async () => { saving.resolve(); });

    expect(mocks.put.mock.calls.map(([document]: [DashboardDocument]) => document.title)).toEqual(['In-flight edit', 'Original dashboard']);
    expect(stored.title).toBe('Original dashboard');
    expect(screen.getByText('Saved locally')).toBeInTheDocument();
  });

  it('does not report Saved locally while a newer edit is still pending', async () => {
    await renderEditor();
    const saving = delayNextSave();
    rename('First edit');
    await act(async () => { vi.advanceTimersByTime(900); });
    rename('Second edit');
    await act(async () => { saving.resolve(); });

    expect(stored.title).toBe('First edit');
    expect(screen.queryByText('Saved locally')).not.toBeInTheDocument();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(900); });
    expect(stored.title).toBe('Second edit');
    expect(screen.getByText('Saved locally')).toBeInTheDocument();
  });

  it('keeps a failed save available for retry and does not navigate away', async () => {
    await renderEditor();
    mocks.put.mockRejectedValueOnce(new Error('Local storage is unavailable.'));
    rename('Recoverable edit');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true })); });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Local storage is unavailable.');
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(stored.title).toBe('Original dashboard');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true })); });
    expect(stored.title).toBe('Recoverable edit');
    expect(mocks.navigate).toHaveBeenCalledWith('/w/workspace/dashboards/dashboard/view');
  });

  it('preserves edits made while an older document is publishing remotely', async () => {
    mocks.workspace.dashboardServiceEnabled = true;
    await renderEditor();
    const publishing = deferred();
    mocks.publish.mockReturnValueOnce(publishing.promise);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publish remote' })); });
    rename('Newer local edit');
    await act(async () => { publishing.resolve(); });
    await act(async () => { vi.advanceTimersByTime(900); });

    expect(screen.getByLabelText('Dashboard title')).toHaveValue('Newer local edit');
    expect(stored.title).toBe('Newer local edit');
    expect(stored.metadata.remoteSyncedAt).toBeUndefined();
    expect(screen.getByText('Saved locally')).toBeInTheDocument();
  });

  it('keeps the local saved status truthful when remote publishing fails', async () => {
    mocks.workspace.dashboardServiceEnabled = true;
    await renderEditor();
    mocks.publish.mockRejectedValueOnce(new Error('Remote service is unavailable.'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publish remote' })); });

    expect(screen.getByRole('alert')).toHaveTextContent('Remote service is unavailable.');
    expect(screen.getByText('Saved locally')).toBeInTheDocument();
    expect(stored.title).toBe('Original dashboard');
  });
});
