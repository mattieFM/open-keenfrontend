import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialMeta, WorkspaceRecord } from '@shared/types';
import { KeenClient } from '@/lib/api/KeenClient';
import { clearAllCredentials, putMemoryCredential } from '@/lib/vault/credentialVault';

const credential: CredentialMeta = { id: 'master', workspaceId: 'workspace', label: 'Master', type: 'master', storageMode: 'memory', hint: 'mast••••key', createdAt: new Date(0).toISOString() };
const workspace: WorkspaceRecord = { id: 'workspace', localName: 'Test', projectId: 'project', analyticsBaseUrl: 'https://api.keen.io/3.0', dashboardServiceEnabled: false, credentials: [credential], capabilities: {}, preferences: { defaultTimezone: 'UTC', queryConcurrency: 1, includeSchemaOnStreamList: false, dashboardPersistence: 'local' }, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };

describe('Keen client mutation and request invariants', () => {
  beforeEach(() => { clearAllCredentials(); putMemoryCredential(credential.id, 'actual-secret'); vi.mocked(window.keenDesktop.request).mockReset(); });

  it('blocks mutations in read-only mode before IPC', async () => {
    const client = new KeenClient(workspace, 'read-only');
    await expect(client.recordEvent(credential, 'events', { ok: true })).rejects.toMatchObject({ kind: 'validation' });
    expect(window.keenDesktop.request).not.toHaveBeenCalled();
  });

  it('never sends a body for filtered DELETE and redacts the credential', async () => {
    vi.mocked(window.keenDesktop.request).mockResolvedValue({ ok: true, response: { status: 204, ok: true, headers: {}, rawText: '', elapsedMs: 1 } });
    const client = new KeenClient(workspace, 'changes-enabled');
    const response = await client.deleteFilteredEvents(credential, 'orders', { filters: [{ property_name: 'customer.id', operator: 'eq', property_value: 'a' }], timeframe: 'this_1_days' });
    const payload = vi.mocked(window.keenDesktop.request).mock.calls[0]?.[0];
    expect(payload?.method).toBe('DELETE');
    expect(payload?.body).toBeUndefined();
    expect(payload?.path).toContain('filters=');
    expect(JSON.stringify(response.redactedRequest)).not.toContain('actual-secret');
  });

  it('submits a failed write once with no automatic retry', async () => {
    vi.mocked(window.keenDesktop.request).mockResolvedValue({ ok: false, error: { kind: 'network', message: 'offline', retryable: true } });
    const client = new KeenClient(workspace, 'changes-enabled');
    await expect(client.recordEvent(credential, 'orders', { id: 1 })).rejects.toMatchObject({ message: 'offline' });
    expect(window.keenDesktop.request).toHaveBeenCalledTimes(1);
  });
});
