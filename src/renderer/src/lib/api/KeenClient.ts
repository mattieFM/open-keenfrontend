import type {
  CredentialMeta,
  HttpMethod,
  KeenApiError,
  KeenResponse,
  Operation,
  QueryDraft,
  RedactedRequest,
  RuntimeMode,
  WorkspaceRecord
} from '@shared/types';
import { projectPath, safeDisplayUrl, serializeDeleteEventsScope, type DeleteEventsScope } from '@shared/url';
import { demoBridgeResponse, demoCollections, demoQuery } from '../demo/fixtures';
import { getCredential } from '../vault/credentialVault';
import { queryBody } from '../query/validation';
import { pauseWorkspaceScheduler, scheduleWorkspaceRead, trackWorkspaceBridgeRequest, type RequestLane } from './requestScheduler';

const inflightReads = new Map<string, Promise<KeenResponse<unknown>>>();

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? 'null' : stable(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  operation: Operation;
  credential: CredentialMeta;
  mutation?: boolean;
  safeRead?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  responseType?: 'text' | 'arrayBuffer';
};

export class KeenClient {
  constructor(private workspace: WorkspaceRecord, private runtimeMode: RuntimeMode) {}

  private async demoRequest<T>(path: string, options: RequestOptions): Promise<KeenResponse<T>> {
    let data: unknown = {};
    if (path.endsWith('/events') || path.includes('/events?')) data = demoCollections;
    else if (/\/events\/[^/?]+$/.test(path) && (options.method ?? 'GET') === 'GET') {
      const collection = decodeURIComponent(path.split('/').pop() ?? '');
      data = demoCollections.find((item) => item.name === collection) ?? { name: collection, properties: {} };
    } else if (path.endsWith('/queries/saved')) data = [];
    else if (path.includes('/queries/saved/') && path.endsWith('/result')) data = demoQuery({ analysis_type: 'count', event_collection: 'purchases', timeframe: 'this_14_days' });
    else if (path.includes('/queries/')) data = demoQuery(({ analysis_type: decodeURIComponent(path.split('/').pop() ?? 'count'), ...(options.body as Record<string, unknown> ?? {}) }) as QueryDraft);
    else if (path.endsWith('/keys')) data = [];
    else if (path.endsWith('/datasets')) data = [];
    else if (options.mutation) data = { created: true, updated: true };
    const response = demoBridgeResponse(data);
    const redactedRequest = this.redacted(path, options);
    return { data: data as T, status: 200, headers: response.headers, elapsedMs: response.elapsedMs, rawText: response.rawText ?? '', redactedRequest };
  }

  private redacted(path: string, options: RequestOptions): RedactedRequest {
    return {
      method: options.method ?? 'GET',
      url: safeDisplayUrl(this.workspace.analyticsBaseUrl, path),
      headers: { ...(options.headers ?? {}), Authorization: '<redacted>' },
      body: options.body,
      credentialLabel: options.credential.label
    };
  }

  async request<T = unknown>(path: string, options: RequestOptions): Promise<KeenResponse<T>> {
    if (options.mutation && this.runtimeMode !== 'changes-enabled') {
      throw <KeenApiError>{
        kind: 'validation',
        message: 'Remote changes are disabled. Enable changes for this workspace before submitting a mutation.',
        retryable: false,
        redactedRequest: this.redacted(path, options)
      };
    }
    if (this.workspace.demo) return this.demoRequest<T>(path, options);
    const secret = getCredential(options.credential.id);
    if (!secret) {
      throw <KeenApiError>{
        kind: 'validation',
        message: `Credential “${options.credential.label}” is locked or was memory-only in a previous app session. Re-enter or unlock it.`,
        retryable: false,
        redactedRequest: this.redacted(path, options)
      };
    }

    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
    const dedupeKey = stable({ base: this.workspace.analyticsBaseUrl, path, method: options.method ?? 'GET', body: options.body, credentialId: options.credential.id });
    if (options.safeRead && inflightReads.has(dedupeKey)) return inflightReads.get(dedupeKey) as Promise<KeenResponse<T>>;

    const execute = async (): Promise<KeenResponse<T>> => {
      const attempts = options.safeRead ? 3 : 1;
      let lastError: KeenApiError | undefined;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (options.signal?.aborted) {
          throw <KeenApiError>{ kind: 'abort', message: 'The request was cancelled before execution.', retryable: false, redactedRequest: this.redacted(path, options) };
        }
        const requestId = crypto.randomUUID();
        const releaseRequest = trackWorkspaceBridgeRequest(this.workspace.id, requestId);
        const onAbort = () => window.keenDesktop.cancel(requestId);
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          const bridgeResult = await window.keenDesktop.request({
            requestId,
            baseUrl: this.workspace.analyticsBaseUrl,
            path,
            method: options.method ?? 'GET',
            authorization: secret,
            headers: options.headers,
            body: bodyText,
            timeoutMs: options.timeoutMs,
            responseType: options.responseType
          });
          if (!bridgeResult.ok) {
            const error: KeenApiError = {
              kind: bridgeResult.error.kind,
              message: bridgeResult.error.message,
              retryable: bridgeResult.error.retryable,
              redactedRequest: this.redacted(path, options)
            };
            if (attempt + 1 < attempts && error.retryable) {
              await sleep(350 * 2 ** attempt + Math.random() * 150);
              lastError = error;
              continue;
            }
            throw error;
          }

          const response = bridgeResult.response;
          let parsed: unknown = null;
          if (options.responseType === 'arrayBuffer' && response.binaryBase64) parsed = { binary: true };
          if (response.rawText?.trim()) {
            try {
              parsed = JSON.parse(response.rawText);
            } catch {
              if (response.ok) {
                throw <KeenApiError>{
                  kind: 'parse',
                  status: response.status,
                  message: 'Keen returned a non-JSON response where JSON was expected.',
                  retryable: false,
                  details: response.rawText.slice(0, 2000),
                  redactedRequest: this.redacted(path, options)
                };
              }
              parsed = { message: response.rawText.slice(0, 2000) };
            }
          }

          if (!response.ok) {
            const details = parsed as Record<string, unknown> | null;
            const error: KeenApiError = {
              kind: 'http',
              status: response.status,
              errorCode: typeof details?.error_code === 'string' ? details.error_code : undefined,
              message: typeof details?.message === 'string' ? details.message : `Keen returned HTTP ${response.status}.`,
              retryable: [429, 503].includes(response.status),
              requestId: response.headers['x-request-id'] ?? response.headers['request-id'],
              details,
              redactedRequest: this.redacted(path, options)
            };
            if (attempt + 1 < attempts && error.retryable) {
              await sleep(500 * 2 ** attempt + Math.random() * 200);
              lastError = error;
              continue;
            }
            if (response.status === 429) pauseWorkspaceScheduler(this.workspace.id, error.message);
            throw error;
          }

          return {
            data: parsed as T,
            status: response.status,
            headers: response.headers,
            requestId: response.headers['x-request-id'] ?? response.headers['request-id'],
            elapsedMs: response.elapsedMs,
            rawText: response.rawText ?? '',
            binaryBase64: response.binaryBase64,
            redactedRequest: this.redacted(path, options)
          };
        } finally {
          options.signal?.removeEventListener('abort', onAbort);
          releaseRequest();
        }
      }
      throw lastError ?? new Error('Request failed.');
    };

    const lane: RequestLane = options.operation === 'query.run'
      ? (path.includes('/queries/extraction') ? 'extraction' : 'query')
      : 'read';
    const promise = options.safeRead
      ? scheduleWorkspaceRead(this.workspace.id, lane, this.workspace.preferences.queryConcurrency, execute, options.signal)
      : execute();
    if (options.safeRead) inflightReads.set(dedupeKey, promise as Promise<KeenResponse<unknown>>);
    try {
      return await promise;
    } finally {
      if (options.safeRead) inflightReads.delete(dedupeKey);
    }
  }

  listCollections(credential: CredentialMeta, includeSchema = false, signal?: AbortSignal) {
    return this.request<unknown[]>(`${projectPath(this.workspace.projectId, 'events')}?include_schema=${includeSchema}`, { operation: 'schema.read', credential, safeRead: true, signal });
  }

  getCollection(credential: CredentialMeta, collection: string, signal?: AbortSignal) {
    return this.request<Record<string, unknown>>(projectPath(this.workspace.projectId, 'events', collection), { operation: 'schema.read', credential, safeRead: true, signal });
  }

  runQuery(credential: CredentialMeta, query: QueryDraft, signal?: AbortSignal) {
    return this.request<Record<string, unknown>>(projectPath(this.workspace.projectId, 'queries', query.analysis_type), {
      method: 'POST', operation: 'query.run', credential, body: queryBody(query), safeRead: true, signal
    });
  }

  runExtraction(credential: CredentialMeta, query: QueryDraft, binary = false, signal?: AbortSignal) {
    return this.request<Record<string, unknown>>(projectPath(this.workspace.projectId, 'queries', 'extraction'), {
      method: 'POST', operation: 'query.run', credential, body: queryBody({ ...query, analysis_type: 'extraction' }), safeRead: !query.email, signal, responseType: binary ? 'arrayBuffer' : 'text'
    });
  }

  listSavedQueries(credential: CredentialMeta) {
    return this.request<unknown[]>(projectPath(this.workspace.projectId, 'queries', 'saved'), { operation: 'saved.definition.read', credential, safeRead: true });
  }

  getSavedQuery(credential: CredentialMeta, name: string) {
    return this.request<Record<string, unknown>>(projectPath(this.workspace.projectId, 'queries', 'saved', name), { operation: 'saved.definition.read', credential, safeRead: true });
  }

  getSavedQueryResult(credential: CredentialMeta, name: string) {
    return this.request<Record<string, unknown>>(projectPath(this.workspace.projectId, 'queries', 'saved', name, 'result'), { operation: 'saved.result.read', credential, safeRead: true });
  }

  putSavedQuery(credential: CredentialMeta, name: string, body: Record<string, unknown>) {
    return this.request(projectPath(this.workspace.projectId, 'queries', 'saved', name), { method: 'PUT', operation: 'saved.manage', credential, body, mutation: true });
  }

  deleteSavedQuery(credential: CredentialMeta, name: string) {
    return this.request(projectPath(this.workspace.projectId, 'queries', 'saved', name), { method: 'DELETE', operation: 'saved.manage', credential, mutation: true });
  }

  listAccessKeys(credential: CredentialMeta, search = '', page = 1) {
    const params = new URLSearchParams({ page: String(page), per_page: '200' });
    if (search) params.set('name', search);
    return this.request<unknown[]>(`${projectPath(this.workspace.projectId, 'keys')}?${params}`, { operation: 'accessKey.manage', credential, safeRead: true });
  }

  createAccessKey(credential: CredentialMeta, body: Record<string, unknown>) {
    return this.request(projectPath(this.workspace.projectId, 'keys'), { method: 'POST', operation: 'accessKey.manage', credential, body, mutation: true });
  }

  updateAccessKey(credential: CredentialMeta, key: string, body: Record<string, unknown>) {
    return this.request(projectPath(this.workspace.projectId, 'keys', key), { method: 'POST', operation: 'accessKey.manage', credential, body, mutation: true });
  }

  accessKeyAction(credential: CredentialMeta, key: string, action: 'revoke' | 'unrevoke') {
    return this.request(projectPath(this.workspace.projectId, 'keys', key, action), { method: 'POST', operation: 'accessKey.manage', credential, mutation: true });
  }

  deleteAccessKey(credential: CredentialMeta, key: string) {
    return this.request(projectPath(this.workspace.projectId, 'keys', key), { method: 'DELETE', operation: 'accessKey.manage', credential, mutation: true });
  }

  recordEvent(credential: CredentialMeta, collection: string, event: Record<string, unknown>) {
    return this.request(projectPath(this.workspace.projectId, 'events', collection), { method: 'POST', operation: 'event.write', credential, body: event, mutation: true });
  }

  recordEvents(credential: CredentialMeta, events: Record<string, Array<Record<string, unknown>>>) {
    return this.request(projectPath(this.workspace.projectId, 'events'), { method: 'POST', operation: 'event.write', credential, body: events, mutation: true });
  }

  deleteFilteredEvents(credential: CredentialMeta, collection: string, scope: DeleteEventsScope) {
    const query = serializeDeleteEventsScope(scope);
    return this.request(`${projectPath(this.workspace.projectId, 'events', collection)}?${query}`, { method: 'DELETE', operation: 'maintenance', credential, mutation: true });
  }

  deleteCollection(credential: CredentialMeta, collection: string) {
    return this.request(projectPath(this.workspace.projectId, 'events', collection), { method: 'DELETE', operation: 'maintenance', credential, mutation: true });
  }

  deleteProperty(credential: CredentialMeta, collection: string, property: string) {
    return this.request(projectPath(this.workspace.projectId, 'events', collection, 'properties', property), { method: 'DELETE', operation: 'maintenance', credential, mutation: true });
  }

  updateEvents(credential: CredentialMeta, collection: string, body: Record<string, unknown>) {
    return this.request(projectPath(this.workspace.projectId, 'events', collection), { method: 'PUT', operation: 'maintenance', credential, body, mutation: true });
  }

  listDatasets(credential: CredentialMeta, limit = 100, afterName?: string) {
    const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, limit))) });
    if (afterName) params.set('after_name', afterName);
    return this.request<unknown>(`${projectPath(this.workspace.projectId, 'datasets')}?${params}`, { operation: 'dataset.read', credential, safeRead: true });
  }

  getDataset(credential: CredentialMeta, name: string) {
    return this.request(projectPath(this.workspace.projectId, 'datasets', name), { operation: 'dataset.read', credential, safeRead: true });
  }

  getDatasetResults(credential: CredentialMeta, name: string, params: Record<string, unknown>) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      search.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    const query = search.toString();
    return this.request(`${projectPath(this.workspace.projectId, 'datasets', name, 'results')}${query ? `?${query}` : ''}`, { operation: 'dataset.read', credential, safeRead: true });
  }

  createDataset(credential: CredentialMeta, name: string, body: Record<string, unknown>) {
    return this.request(projectPath(this.workspace.projectId, 'datasets', name), { method: 'PUT', operation: 'dataset.manage', credential, body, mutation: true });
  }

  deleteDataset(credential: CredentialMeta, name: string) {
    return this.request(projectPath(this.workspace.projectId, 'datasets', name), { method: 'DELETE', operation: 'dataset.manage', credential, mutation: true });
  }
}
