import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

const port = readPositiveInt('PORT', 8787, 1, 65_535);
const maxRequestBytes = readPositiveInt('RELAY_MAX_REQUEST_BYTES', 10_500_000, 1, 20_000_000);
const maxResponseBytes = readPositiveInt('RELAY_MAX_RESPONSE_BYTES', 160_000_000, 1, 200_000_000);
const timeoutMs = readPositiveInt('RELAY_TIMEOUT_MS', 310_000, 1_000, 600_000);
const allowPrivateDns = process.env.RELAY_ALLOW_PRIVATE_DNS === 'true';
const allowedOrigins = new Set(splitCsv(process.env.RELAY_ALLOWED_ORIGINS));
const analyticsUpstream = normalizeUpstream(process.env.RELAY_ANALYTICS_UPSTREAM ?? 'https://api.keen.io/3.0');
const dashboardUpstream = normalizeUpstream(process.env.RELAY_DASHBOARD_UPSTREAM ?? 'https://dashboard-service.k-n.io');

const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
const requestHeaders = new Set(['authorization', 'accept', 'content-type', 'content-encoding', 'x-keen-blob-metadata']);
const responseHeaders = new Set(['content-type', 'content-disposition', 'content-encoding', 'etag', 'last-modified', 'retry-after', 'x-request-id', 'request-id']);

function splitCsv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function readPositiveInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function normalizeUpstream(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Relay upstreams must use HTTPS.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Relay upstreams cannot contain credentials, search parameters, or fragments.');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (normalized.startsWith('2001:db8:')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    return isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

function isDisallowedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function resolvePinnedAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const candidates = await lookup(hostname, { all: true, verbatim: true });
  if (candidates.length === 0) throw new Error('Upstream hostname did not resolve.');
  const allowed = candidates.filter((candidate) => allowPrivateDns || !isDisallowedAddress(candidate.address));
  if (allowed.length !== candidates.length && !allowPrivateDns) throw new Error('Upstream resolved to a private, local, reserved, or multicast address.');
  const chosen = allowed[0];
  if (!chosen) throw new Error('No approved upstream address is available.');
  return { address: chosen.address, family: chosen.family as 4 | 6 };
}

function setCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) {
    response.statusCode = 403;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ message: 'Origin is not allowed by this relay.' }));
    return false;
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Accept, Content-Type, Content-Encoding, X-Keen-Blob-Metadata');
  response.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Disposition, ETag, Last-Modified, Retry-After, X-Request-Id, Request-Id');
  response.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function targetFor(requestUrl: string): URL {
  const incoming = new URL(requestUrl, 'https://relay.invalid');
  let upstream: URL;
  let relativePath: string;
  if (incoming.pathname === '/3.0' || incoming.pathname.startsWith('/3.0/')) {
    upstream = analyticsUpstream;
    relativePath = incoming.pathname.slice('/3.0'.length) || '/';
  } else if (incoming.pathname === '/projects' || incoming.pathname.startsWith('/projects/')) {
    upstream = dashboardUpstream;
    relativePath = incoming.pathname;
  } else {
    throw new Error('Relay path must begin with /3.0 for Analytics or /projects for Dashboard service.');
  }
  const basePath = upstream.pathname.replace(/\/+$/, '');
  const target = new URL(upstream.toString());
  target.pathname = `${basePath}${relativePath.startsWith('/') ? relativePath : `/${relativePath}`}`.replace(/\/{2,}/g, '/');
  target.search = incoming.search;
  return target;
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maxRequestBytes) throw new Error('Request body exceeds the relay limit.');
    chunks.push(value);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  if (!allowedMethods.has(method)) {
    response.statusCode = 405;
    response.setHeader('Allow', Array.from(allowedMethods).join(', '));
    response.end();
    return;
  }
  if (!setCors(request, response)) return;
  setSecurityHeaders(response);
  if (method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  const started = performance.now();
  const target = targetFor(request.url ?? '/');
  const pinned = await resolvePinnedAddress(target.hostname);
  const body = await readBody(request);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (!requestHeaders.has(name.toLowerCase()) || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  headers.host = target.host;
  headers['user-agent'] = 'keen-key-console-relay/0.1';
  delete headers.cookie;

  await new Promise<void>((resolve, reject) => {
    const upstreamRequest = httpsRequest({
      protocol: 'https:',
      hostname: target.hostname,
      port: target.port ? Number(target.port) : 443,
      servername: target.hostname,
      method,
      path: `${target.pathname}${target.search}`,
      headers,
      timeout: timeoutMs,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family)
    }, (upstreamResponse) => {
      response.statusCode = upstreamResponse.statusCode ?? 502;
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (!responseHeaders.has(name.toLowerCase()) || value === undefined) continue;
        response.setHeader(name, value);
      }
      let bytes = 0;
      upstreamResponse.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maxResponseBytes) {
          upstreamResponse.destroy(new Error('Upstream response exceeds the relay limit.'));
          if (!response.headersSent) response.statusCode = 502;
          response.destroy();
          return;
        }
        if (!response.write(chunk)) upstreamResponse.pause();
      });
      response.on('drain', () => upstreamResponse.resume());
      upstreamResponse.on('end', () => {
        response.end();
        const elapsed = Math.round(performance.now() - started);
        // Status and latency only. Never log URL, host, headers, body, project ID, or key.
        console.info(JSON.stringify({ event: 'relay_request', method, status: response.statusCode, elapsedMs: elapsed }));
        resolve();
      });
      upstreamResponse.on('error', reject);
    });

    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('Upstream request timed out.')));
    upstreamRequest.on('error', reject);
    request.on('aborted', () => upstreamRequest.destroy(new Error('Client aborted request.')));
    if (body) upstreamRequest.write(body);
    upstreamRequest.end();
  });
}

const server = createServer((request, response) => {
  void proxy(request, response).catch((error) => {
    if (response.destroyed) return;
    setSecurityHeaders(response);
    if (!setCors(request, response)) return;
    response.statusCode = error instanceof Error && /body exceeds/.test(error.message) ? 413 : 502;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Relay request failed.' }));
  });
});

server.requestTimeout = timeoutMs + 5_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.listen(port, '127.0.0.1', () => {
  console.info(JSON.stringify({ event: 'relay_started', port }));
});
