import type { HttpMethod, KeenFilter, KeenTimeframe } from './types';

const DEFAULT_ANALYTICS_PATH = '/3.0';

export function normalizeBaseUrl(value: string, kind: 'analytics' | 'dashboard' = 'analytics'): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('A service host is required.');
  const url = new URL(trimmed);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP(S) service hosts are supported.');
  if (url.username || url.password) throw new Error('Credentials are not allowed inside service URLs.');
  url.hash = '';
  url.search = '';
  let path = url.pathname.replace(/\/+$/, '');
  if (kind === 'analytics') {
    if (path === '' || path === '/') path = DEFAULT_ANALYTICS_PATH;
    if (path.endsWith('/3.0/3.0')) path = path.slice(0, -4);
  }
  if (kind === 'dashboard' && path === '/') path = '';
  url.pathname = path;
  return url.toString().replace(/\/$/, '');
}

export function encodeSegment(value: string): string {
  if (!value) throw new Error('Path segment cannot be empty.');
  return encodeURIComponent(value);
}

export function projectPath(projectId: string, ...segments: string[]): string {
  return `/projects/${encodeSegment(projectId)}${segments.length ? `/${segments.map(encodeSegment).join('/')}` : ''}`;
}

export function organizationPath(organizationId: string, ...segments: string[]): string {
  return `/organizations/${encodeSegment(organizationId)}${segments.length ? `/${segments.map(encodeSegment).join('/')}` : ''}`;
}

export function approvedBaseIdentity(baseUrl: string): string {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.hash || base.search) throw new Error('Invalid base URL.');
  const path = base.pathname.replace(/\/+$/, '');
  return `${base.origin}${path}`;
}

export function validateApprovedTarget(baseUrl: string, relativePath: string, allowHttp: boolean, approvedBases?: Set<string>): URL {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.hash || base.search) throw new Error('Invalid base URL.');
  if (base.protocol !== 'https:' && !(allowHttp && base.protocol === 'http:')) throw new Error('HTTPS is required for Keen service hosts.');
  const baseIdentity = approvedBaseIdentity(baseUrl);
  if (approvedBases && !approvedBases.has(baseIdentity)) throw new Error('The service host and base path have not been approved by the user.');
  if (!relativePath.startsWith('/') || relativePath.startsWith('//')) throw new Error('API paths must be origin-relative.');
  const basePath = base.pathname.replace(/\/+$/, '');
  const target = new URL(`${basePath}${relativePath}`, base.origin);
  if (target.origin !== base.origin) throw new Error('Cross-origin path resolution is not permitted.');
  if (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) {
    throw new Error('API path traversal outside the approved service base is not permitted.');
  }
  if (target.username || target.password) throw new Error('Credentials are not permitted in request URLs.');
  return target;
}

export type DeleteEventsScope = {
  filters?: KeenFilter[];
  timeframe?: KeenTimeframe;
  timezone?: string | number;
};

export function serializeDeleteEventsScope(scope: DeleteEventsScope): string {
  const hasFilters = Array.isArray(scope.filters) && scope.filters.length > 0;
  const hasTimeframe = typeof scope.timeframe === 'string'
    ? scope.timeframe.trim().length > 0
    : Boolean(scope.timeframe?.start && scope.timeframe?.end);
  if (!hasFilters && !hasTimeframe) {
    throw new Error('Filtered deletion requires at least one filter or timeframe. Whole-collection deletion uses a separate operation.');
  }
  const params = new URLSearchParams();
  if (hasFilters) params.set('filters', JSON.stringify(scope.filters));
  if (hasTimeframe) params.set('timeframe', typeof scope.timeframe === 'string' ? scope.timeframe : JSON.stringify(scope.timeframe));
  if (scope.timezone !== undefined && scope.timezone !== '') params.set('timezone', String(scope.timezone));
  return params.toString();
}

export function safeDisplayUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const url = new URL(`${base.pathname.replace(/\/$/, '')}${path}`, base.origin);
  url.username = '';
  url.password = '';
  url.hash = '';
  url.searchParams.delete('api_key');
  // Access Key administration addresses the bearer key itself as a path segment.
  // Preserve the operation suffix while ensuring diagnostics and copied requests never reveal it.
  url.pathname = url.pathname.replace(/(\/keys\/)[^/]+(?=\/|$)/g, '$1%3Credacted-key%3E');
  return url.toString();
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildSafeCurl(request: {
  method: HttpMethod;
  url: string;
  body?: unknown;
}): string {
  const parts = [
    'curl',
    '-X',
    request.method,
    shellQuote(request.url),
    '-H',
    shellQuote('Authorization: ${KEEN_KEY}')
  ];
  if (request.body !== undefined) {
    parts.push('-H', shellQuote('Content-Type: application/json'), '--data-raw', shellQuote(JSON.stringify(request.body)));
  }
  return parts.join(' ');
}
