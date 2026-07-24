import type { CredentialMeta, DashboardDocument, KeenApiError, KeenResponse, RuntimeMode, WorkspaceRecord } from '@shared/types';
import { safeDisplayUrl } from '@shared/url';
import { getCredential } from '../vault/credentialVault';
import { trackWorkspaceBridgeRequest } from './requestScheduler';

export type KeenDashboardMetadata = {
  id: string;
  title: string | null;
  widgets: number;
  queries: number;
  tags: string[];
  lastModificationDate: number | null;
  isPublic: boolean;
  publicAccessKey: string | null;
  [key: string]: unknown;
};

export class DashboardServiceClient {
  constructor(private workspace: WorkspaceRecord, private runtimeMode: RuntimeMode) {}

  private async request<T>(path: string, credential: CredentialMeta, init: { method?: 'GET' | 'PUT' | 'DELETE'; body?: unknown; metadata?: KeenDashboardMetadata; mutation?: boolean } = {}): Promise<KeenResponse<T>> {
    if (!this.workspace.dashboardBaseUrl) throw new Error('Dashboard service host is not configured.');
    if (init.mutation && this.runtimeMode !== 'changes-enabled') throw new Error('Remote changes are disabled for this workspace.');
    const secret = getCredential(credential.id);
    if (!secret) throw new Error(`Credential “${credential.label}” is locked.`);
    const requestPath = `/projects/${encodeURIComponent(this.workspace.projectId)}${path}`;
    const requestId = crypto.randomUUID();
    const releaseRequest = trackWorkspaceBridgeRequest(this.workspace.id, requestId);
    const result = await (async () => {
      try {
        return await window.keenDesktop.request({
          requestId,
          baseUrl: this.workspace.dashboardBaseUrl,
          path: requestPath,
          method: init.method ?? 'GET',
          authorization: secret,
          headers: init.metadata ? { 'X-Keen-Blob-Metadata': JSON.stringify(init.metadata) } : undefined,
          body: init.body === undefined ? undefined : JSON.stringify(init.body)
        });
      } finally {
        releaseRequest();
      }
    })();
    const redactedRequest = { method: init.method ?? 'GET', url: safeDisplayUrl(this.workspace.dashboardBaseUrl, requestPath), headers: { Authorization: '<redacted>' }, body: init.body, credentialLabel: credential.label } as const;
    if (!result.ok) throw <KeenApiError>{ kind: result.error.kind, message: result.error.message, retryable: result.error.retryable, redactedRequest };
    let data: unknown = null;
    if (result.response.rawText?.trim()) {
      try { data = JSON.parse(result.response.rawText); } catch { data = result.response.rawText; }
    }
    if (!result.response.ok) {
      throw <KeenApiError>{ kind: 'http', status: result.response.status, message: (data as { message?: string })?.message ?? `Dashboard service returned HTTP ${result.response.status}.`, retryable: [429, 503].includes(result.response.status), details: data, redactedRequest };
    }
    return { data: data as T, status: result.response.status, headers: result.response.headers, elapsedMs: result.response.elapsedMs, rawText: result.response.rawText ?? '', redactedRequest };
  }

  list(credential: CredentialMeta) { return this.request<KeenDashboardMetadata[]>('/dashboards/metadata', credential); }
  get(id: string, credential: CredentialMeta) { return this.request<DashboardDocument>(`/dashboards/${encodeURIComponent(id)}`, credential); }
  getMetadata(id: string, credential: CredentialMeta) { return this.request<KeenDashboardMetadata>(`/dashboards/${encodeURIComponent(id)}/metadata`, credential); }
  put(document: DashboardDocument, metadata: KeenDashboardMetadata, credential: CredentialMeta) {
    return this.request(`/dashboards/${encodeURIComponent(document.id)}`, credential, { method: 'PUT', body: document, metadata, mutation: true });
  }
  putMetadata(id: string, metadata: KeenDashboardMetadata, credential: CredentialMeta) {
    return this.request(`/dashboards/${encodeURIComponent(id)}/metadata`, credential, { method: 'PUT', body: metadata, mutation: true });
  }
  delete(id: string, credential: CredentialMeta) {
    return this.request(`/dashboards/${encodeURIComponent(id)}`, credential, { method: 'DELETE', mutation: true });
  }
}
