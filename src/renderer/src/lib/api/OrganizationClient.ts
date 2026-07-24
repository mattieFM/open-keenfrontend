import type { CredentialMeta, HttpMethod, KeenApiError, KeenResponse, RedactedRequest, RuntimeMode, WorkspaceRecord } from '@shared/types';
import { organizationPath, safeDisplayUrl } from '@shared/url';
import { getCredential } from '../vault/credentialVault';
import { trackWorkspaceBridgeRequest } from './requestScheduler';

export class OrganizationClient {
  constructor(private workspace: WorkspaceRecord, private runtimeMode: RuntimeMode) {}

  private redacted(path: string, method: HttpMethod, credential: CredentialMeta, body?: unknown): RedactedRequest {
    return { method, url: safeDisplayUrl(this.workspace.analyticsBaseUrl, path), headers: { Authorization: '<redacted>' }, body, credentialLabel: credential.label };
  }

  private async request<T>(path: string, credential: CredentialMeta, method: HttpMethod = 'GET', body?: unknown): Promise<KeenResponse<T>> {
    const mutation = method !== 'GET' && method !== 'HEAD';
    const redactedRequest = this.redacted(path, method, credential, body);
    if (!this.workspace.organizationId) throw <KeenApiError>{ kind: 'validation', message: 'Configure an Organization ID first.', retryable: false, redactedRequest };
    if (credential.type !== 'organization') throw <KeenApiError>{ kind: 'validation', message: 'Organization API operations require a separately supplied Organization Key.', retryable: false, redactedRequest };
    if (mutation && this.runtimeMode !== 'changes-enabled') throw <KeenApiError>{ kind: 'validation', message: 'Remote changes are disabled. Enable changes for this workspace first.', retryable: false, redactedRequest };
    if (this.workspace.demo) {
      const demo = method === 'GET' ? [{ id: this.workspace.projectId, name: 'Synthetic demo project', users: [], preferences: {} }] : { id: this.workspace.projectId, updated: true };
      return { data: demo as T, status: 200, headers: {}, elapsedMs: 1, rawText: JSON.stringify(demo), redactedRequest };
    }
    const secret = getCredential(credential.id);
    if (!secret) throw <KeenApiError>{ kind: 'validation', message: `Credential “${credential.label}” is locked or missing from memory.`, retryable: false, redactedRequest };
    const requestId = crypto.randomUUID();
    const releaseRequest = trackWorkspaceBridgeRequest(this.workspace.id, requestId);
    const bridge = await (async () => {
      try {
        return await window.keenDesktop.request({ requestId, baseUrl: this.workspace.analyticsBaseUrl, path, method, authorization: secret, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 60_000 });
      } finally {
        releaseRequest();
      }
    })();
    if (!bridge.ok) throw <KeenApiError>{ kind: bridge.error.kind, message: bridge.error.message, retryable: bridge.error.retryable, redactedRequest };
    let data: unknown = null;
    if (bridge.response.rawText?.trim()) {
      try { data = JSON.parse(bridge.response.rawText); }
      catch { data = bridge.response.rawText; }
    }
    if (!bridge.response.ok) {
      const detail = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
      throw <KeenApiError>{ kind: 'http', status: bridge.response.status, errorCode: typeof detail?.error_code === 'string' ? detail.error_code : undefined, message: typeof detail?.message === 'string' ? detail.message : `Keen returned HTTP ${bridge.response.status}.`, retryable: false, details: detail, redactedRequest };
    }
    return { data: data as T, status: bridge.response.status, headers: bridge.response.headers, requestId: bridge.response.headers['x-request-id'], elapsedMs: bridge.response.elapsedMs, rawText: bridge.response.rawText ?? '', redactedRequest };
  }

  listProjects(credential: CredentialMeta) {
    return this.request<Array<Record<string, unknown>>>(organizationPath(this.workspace.organizationId!, 'projects'), credential);
  }
  getProject(credential: CredentialMeta, projectId = this.workspace.projectId) {
    return this.request<Record<string, unknown>>(organizationPath(this.workspace.organizationId!, 'projects', projectId), credential);
  }
  createProject(credential: CredentialMeta, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(organizationPath(this.workspace.organizationId!, 'projects'), credential, 'POST', body);
  }
  updateProject(credential: CredentialMeta, projectId: string, body: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(organizationPath(this.workspace.organizationId!, 'projects', projectId), credential, 'POST', body);
  }
  deleteProject(credential: CredentialMeta, projectId: string) {
    return this.request<unknown>(organizationPath(this.workspace.organizationId!, 'projects', projectId), credential, 'DELETE');
  }
}
