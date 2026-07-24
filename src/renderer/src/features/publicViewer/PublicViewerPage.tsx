import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { ApiBridgeResult, ApiRequestPayload, ChartWidget, CredentialMeta, DashboardDocument, KeenResponse, QueryDraft, RedactedRequest } from '@shared/types';
import { projectPath, safeDisplayUrl, validateApprovedTarget } from '@shared/url';
import { Badge, Button, Callout, Card, EmptyState, Field, Input } from '../../components/ui';
import { migrateDashboard } from '../../lib/dashboard/model';
import { queryBody } from '../../lib/query/validation';
import { DashboardCanvas, type DashboardChartExecutor } from '../dashboards/DashboardCanvas';

const ANALYTICS_HOST = 'https://api.keen.io/3.0';
const DASHBOARD_HOST = 'https://dashboard-service.k-n.io';
let publicBearerKey: string | undefined;
const PUBLIC_APPROVED_BASES = new Set([ANALYTICS_HOST, DASHBOARD_HOST]);
const PUBLIC_MAX_RESPONSE_BYTES = 150_000_000;
class PublicResponseLimitError extends Error {}

async function readBoundedPublicText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > PUBLIC_MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new PublicResponseLimitError('Response exceeds the 150 MB public-viewer safety limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PUBLIC_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PublicResponseLimitError('Response exceeds the 150 MB public-viewer safety limit.');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return chunks.join('');
}

async function publicRequest(payload: ApiRequestPayload): Promise<ApiBridgeResult> {
  if (typeof window.keenDesktop !== 'undefined') return window.keenDesktop.request(payload);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), payload.timeoutMs ?? 310_000);
  const started = performance.now();
  try {
    const target = validateApprovedTarget(payload.baseUrl, payload.path, false, PUBLIC_APPROVED_BASES);
    const headers = new Headers(payload.headers ?? {});
    headers.delete('authorization');
    headers.delete('proxy-authorization');
    headers.delete('cookie');
    headers.delete('set-cookie');
    if (payload.authorization) headers.set('Authorization', payload.authorization);
    if (payload.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const response = await fetch(target, {
      method: payload.method,
      headers,
      body: payload.method === 'GET' || payload.method === 'HEAD' ? undefined : payload.body,
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store'
    });
    const rawText = await readBoundedPublicText(response);
    const responseHeaders = Object.fromEntries([...response.headers.entries()].filter(([name]) => name.toLowerCase() !== 'set-cookie'));
    return { ok: true, response: { status: response.status, ok: response.ok, headers: responseHeaders, rawText, elapsedMs: Math.round(performance.now() - started) } };
  } catch (caught) {
    const aborted = caught instanceof DOMException && caught.name === 'AbortError';
    const limited = caught instanceof PublicResponseLimitError;
    return { ok: false, error: { kind: aborted ? 'abort' : limited ? 'validation' : 'network', message: aborted ? 'The public viewer request was cancelled or timed out.' : caught instanceof Error ? caught.message : 'The public viewer request failed.', retryable: !aborted && !limited } };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function PublicViewerPage(): JSX.Element {
  const { projectId = '', dashboardId = '' } = useParams();
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(Boolean(publicBearerKey));
  const [document, setDocument] = useState<DashboardDocument>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const loadVersion = useRef(0);

  useEffect(() => {
    const fullHash = window.location.hash;
    const marker = fullHash.lastIndexOf('#key=');
    if (marker >= 0) {
      const token = fullHash.slice(marker + 5);
      try { publicBearerKey = decodeURIComponent(token); } catch { publicBearerKey = token; }
      setHasKey(Boolean(publicBearerKey));
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${fullHash.slice(0, marker)}`);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!publicBearerKey || !projectId || !dashboardId) return;
    const version = ++loadVersion.current; setLoading(true); setError('');
    try {
      if (typeof window.keenDesktop !== 'undefined') await window.keenDesktop.approveHosts([DASHBOARD_HOST, ANALYTICS_HOST]);
      const path = `/projects/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(dashboardId)}`;
      const result = await publicRequest({ requestId: crypto.randomUUID(), baseUrl: DASHBOARD_HOST, path, method: 'GET', authorization: publicBearerKey, timeoutMs: 60_000 });
      if (!result.ok) throw new Error(result.error.message);
      if (!result.response.ok) throw new Error(`Dashboard service returned HTTP ${result.response.status}.`);
      const parsed = JSON.parse(result.response.rawText ?? '{}') as unknown;
      if (version === loadVersion.current) setDocument(migrateDashboard(parsed, 'public-viewer'));
    } catch (caught) { if (version === loadVersion.current) setError(caught instanceof Error ? caught.message : 'Dashboard could not be loaded.'); } finally { if (version === loadVersion.current) setLoading(false); }
  }, [projectId, dashboardId]);
  useEffect(() => { if (hasKey) void loadDashboard(); }, [hasKey, loadDashboard]);

  const submitKey = () => { publicBearerKey = keyInput.trim(); setKeyInput(''); setHasKey(Boolean(publicBearerKey)); };
  const credential = useMemo<CredentialMeta>(() => ({ id: 'public-memory-key', workspaceId: 'public-viewer', label: 'Restricted public key', type: 'access', storageMode: 'memory', hint: 'restricted••••key', createdAt: new Date(0).toISOString() }), []);
  const executeChart = useCallback<DashboardChartExecutor>(async (widget, runtime) => {
    if (!publicBearerKey) throw new Error('Restricted public key is not available in memory.');
    const isSaved = widget.source.kind === 'saved';
    const path = isSaved ? projectPath(projectId, 'queries', 'saved', widget.source.name, 'result') : projectPath(projectId, 'queries', (runtime ?? (widget.source as { query: QueryDraft }).query).analysis_type);
    const method = isSaved ? 'GET' : 'POST';
    const body = isSaved ? undefined : JSON.stringify(queryBody(runtime ?? (widget.source as { query: QueryDraft }).query));
    const result = await publicRequest({ requestId: crypto.randomUUID(), baseUrl: ANALYTICS_HOST, path, method, authorization: publicBearerKey, body, timeoutMs: 310_000 });
    const redactedRequest: RedactedRequest = { method, url: safeDisplayUrl(ANALYTICS_HOST, path), headers: { Authorization: '<redacted>' }, body: body ? JSON.parse(body) : undefined, credentialLabel: 'Restricted public key' };
    if (!result.ok) throw new Error(result.error.message);
    if (!result.response.ok) { let message = `Keen returned HTTP ${result.response.status}.`; try { message = (JSON.parse(result.response.rawText ?? '{}') as { message?: string }).message ?? message; } catch { /* keep */ } throw new Error(message); }
    let data: Record<string, unknown>; try { data = JSON.parse(result.response.rawText ?? '{}') as Record<string, unknown>; } catch { throw new Error('Keen returned a non-JSON chart response.'); }
    return { data, status: result.response.status, headers: result.response.headers, elapsedMs: result.response.elapsedMs, rawText: result.response.rawText ?? '', redactedRequest } satisfies KeenResponse<Record<string, unknown>>;
  }, [projectId]);

  if (!hasKey) return <div className="public-shell"><div className="public-brand"><div className="brand-mark brand-mark--small">K</div><strong>Keen dashboard</strong></div><Card className="public-key-card"><div className="card__body stack"><div className="public-lock"><LockKeyhole size={30} /></div><h1>Restricted dashboard access</h1><p>This viewer needs the dedicated restricted Access Key supplied with the dashboard. It is kept in memory only and is not used as a Keen account login.</p><Field label="Restricted Access Key"><Input type="password" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitKey(); }} autoComplete="off" autoFocus /></Field><Button onClick={submitKey} disabled={!keyInput.trim()}><KeyRound size={15} /> Open dashboard</Button><Callout tone="info" title="Connection destinations">This viewer sends the key only to <code>api.keen.io</code> and <code>dashboard-service.k-n.io</code>. Custom-host public viewers require a separately configured deployment.</Callout><Callout tone="warning">Do not paste a Master, default Read, Write, or Organization Key. Public links are safe only when their bearer key is narrowly scoped.</Callout></div></Card></div>;
  if (loading) return <div className="public-shell"><EmptyState title="Loading dashboard…" description="Fetching layout from the configured Keen-compatible dashboard service." /></div>;
  if (error || !document) return <div className="public-shell"><Card className="public-key-card"><div className="card__body stack"><EmptyState title="Dashboard unavailable" description={error || 'No dashboard document was returned.'} /><Button variant="secondary" onClick={() => void loadDashboard()}>Retry</Button><Button variant="ghost" onClick={() => { publicBearerKey = undefined; setHasKey(false); }}>Use another key</Button></div></Card></div>;
  return <div className="public-dashboard"><header className="public-dashboard__header"><div className="public-brand"><div className="brand-mark brand-mark--small">K</div><div><strong>{document.title}</strong><span>Restricted public viewer</span></div></div><Badge tone="success"><ShieldCheck size={12} /> Key held in memory</Badge></header><main><DashboardCanvas document={document} credential={credential} executeChart={executeChart} /></main></div>;
}
