import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeBaseUrl, safeDisplayUrl, serializeDeleteEventsScope, validateApprovedTarget } from '../../src/shared/url';
import { canonicalJson } from '../../src/renderer/src/lib/maintenance/scope';
import { validateQuery } from '../../src/renderer/src/lib/query/validation';
import { buildPublicDashboardAccessPolicy } from '../../src/renderer/src/lib/dashboard/sharing';
import type { DashboardDocument } from '../../src/shared/types';

assert.equal(normalizeBaseUrl('https://api.keen.io', 'analytics'), 'https://api.keen.io/3.0');
assert.equal(safeDisplayUrl('https://api.keen.io/3.0', '/projects/p/queries/count'), 'https://api.keen.io/3.0/projects/p/queries/count');
assert.ok(!safeDisplayUrl('https://api.keen.io/3.0', '/projects/p/keys/secret/revoke').includes('secret'));
const approvedBases = new Set(['https://api.keen.io/3.0']);
assert.equal(validateApprovedTarget('https://api.keen.io/3.0', '/projects/p/queries/count', false, approvedBases).toString(), 'https://api.keen.io/3.0/projects/p/queries/count');
assert.throws(() => validateApprovedTarget('https://api.keen.io/3.0', '/../admin', false, approvedBases), /traversal outside the approved service base/);
assert.throws(() => validateApprovedTarget('https://api.keen.io', '/projects/p/queries/count', false, approvedBases), /base path have not been approved/);
assert.throws(() => serializeDeleteEventsScope({}), /separate operation/);
assert.equal(canonicalJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
assert.ok(validateQuery({ analysis_type: 'count', event_collection: 'events', timeframe: 'this_1_days' }).length === 0);
const malformedFilterErrors = validateQuery({ analysis_type: 'count', event_collection: 'events', timeframe: 'this_1_days', filters: [{ operator: 'or', operands: null }] } as unknown as Parameters<typeof validateQuery>[0]);
assert.match(malformedFilterErrors.join(' '), /OR requires at least two operands/);

const now = new Date(0).toISOString();
const dashboard: DashboardDocument = { schemaVersion: 1, id: 'd', workspaceId: 'w', title: 'D', tags: [], widgets: [{ id: 'c', type: 'chart', title: 'C', source: { kind: 'ad-hoc', query: { analysis_type: 'count', event_collection: 'events', timeframe: 'this_1_days' } }, chartType: 'metric' }], layout: [], settings: { gridGap: 12, background: '#fff', tileBackground: '#fff', tileRadius: 8 }, theme: { palette: [] }, metadata: {}, revision: 1, createdAt: now, updatedAt: now };
assert.throws(() => buildPublicDashboardAccessPolicy({ document: dashboard, name: 'public' }), /mandatory query filter/);

const mainSource = readFileSync(resolve('src/renderer/src/main.tsx'), 'utf8');
const storeSource = readFileSync(resolve('src/renderer/src/lib/db/workspaceStore.ts'), 'utf8');
const privateAppSource = readFileSync(resolve('src/renderer/src/app/App.tsx'), 'utf8');
const publicAppSource = readFileSync(resolve('src/renderer/src/app/PublicApp.tsx'), 'utf8');
const clientSource = readFileSync(resolve('src/renderer/src/lib/api/KeenClient.ts'), 'utf8');
const maintenanceSource = readFileSync(resolve('src/renderer/src/features/maintenance/MaintenancePage.tsx'), 'utf8');
const electronMainSource = readFileSync(resolve('src/main/index.ts'), 'utf8');
const schedulerSource = readFileSync(resolve('src/renderer/src/lib/api/requestScheduler.ts'), 'utf8');
const connectSource = readFileSync(resolve('src/renderer/src/features/connect/ConnectPage.tsx'), 'utf8');
const explorerSource = readFileSync(resolve('src/renderer/src/features/explorer/ExplorerPage.tsx'), 'utf8');
const streamDetailSource = readFileSync(resolve('src/renderer/src/features/streams/StreamDetailPage.tsx'), 'utf8');
const credentialVaultSource = readFileSync(resolve('src/renderer/src/lib/vault/credentialVault.ts'), 'utf8');
const dashboardClientSource = readFileSync(resolve('src/renderer/src/lib/api/DashboardServiceClient.ts'), 'utf8');
const electronViteConfigSource = readFileSync(resolve('electron.vite.config.ts'), 'utf8');
const bundleVerifierSource = readFileSync(resolve('scripts/verify-electron-bundle.mjs'), 'utf8');
const desktopBridgeDeclarationSource = readFileSync(resolve('src/preload/global.d.ts'), 'utf8');
const stylesSource = readFileSync(resolve('src/renderer/src/styles.css'), 'utf8');
assert.match(mainSource, /#\/connect/);
assert.match(mainSource, /import\('\.\/app\/PublicApp'\)/);
assert.doesNotMatch(privateAppSource, /PublicViewerPage/);
assert.doesNotMatch(publicAppSource, /from\s+['"][^'"]*(workspaceStore|credentialVault|lib\/db\/database)[^'"]*['"]/);
assert.match(storeSource, /'read-only' as const/);
assert.match(clientSource, /options\.mutation && this\.runtimeMode !== 'changes-enabled'/);
assert.match(maintenanceSource, /setSubmitted\(true\)[\s\S]{0,500}client\.(?:deleteFilteredEvents|deleteCollection|deleteProperty|updateEvents)/);
assert.match(electronMainSource, /ipcMain\.handle\('keen:approveHosts'/);
assert.match(electronMainSource, /approvedBaseIdentity/);
assert.match(electronMainSource, /validateApprovedTarget\(payload\.baseUrl, payload\.path, !app\.isPackaged, approvedBases\)/);
assert.match(electronMainSource, /retryable: !aborted && !limited && !validation/);
assert.match(electronMainSource, /response\.body\.getReader\(\)/);
assert.match(electronMainSource, /Array<Uint8Array<ArrayBuffer>>/);
assert.match(electronMainSource, /chunks\.push\(new Uint8Array\(value\)\)/);
assert.match(electronMainSource, /preload: join\(__dirname, '\.\.\/preload\/index\.cjs'\)/);
assert.match(schedulerSource, /activeBridgeRequests/);
assert.match(schedulerSource, /window\.keenDesktop\.cancel\(requestId\)/);
assert.match(connectSource, /Credential used for the safe test/);
assert.match(connectSource, /will not silently retry with a broader key/);
assert.match(connectSource, /<section className="connect-hero" aria-labelledby="connect-hero-title">/);
assert.match(connectSource, /<h1 id="connect-hero-title">/);
assert.match(explorerSource, /Shared funnel timeframe/);
assert.doesNotMatch(streamDetailSource, /decodeURIComponent\(params\.collection/);
assert.match(credentialVaultSource, /type CryptoBytes = Uint8Array<ArrayBuffer>/);
assert.match(credentialVaultSource, /function fromBase64\([\s\S]{0,240}new Uint8Array\(binary\.length\)/);
assert.match(dashboardClientSource, /const dashboardBaseUrl = this\.workspace\.dashboardBaseUrl/);
assert.match(dashboardClientSource, /baseUrl: dashboardBaseUrl/);
assert.match(electronViteConfigSource, /format:\s*'cjs'/);
assert.match(electronViteConfigSource, /entryFileNames:\s*'\[name\]\.cjs'/);
assert.match(bundleVerifierSource, /self-contained CommonJS bundle/);
assert.match(desktopBridgeDeclarationSource, /from '\.\.\/shared\/types'/);
assert.doesNotMatch(desktopBridgeDeclarationSource, /src\/shared/);

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}
const mutedInk = stylesSource.match(/--ink-500:\s*(#[0-9a-f]{6})/i)?.[1];
const primaryGreen = stylesSource.match(/--green-600:\s*(#[0-9a-f]{6})/i)?.[1];
assert.ok(mutedInk && contrastRatio(mutedInk, '#ffffff') >= 4.5);
assert.ok(primaryGreen && contrastRatio(primaryGreen, '#ffffff') >= 4.5);
for (const snippet of [
  '.connect-brand span { color: #fff;',
  '.connect-hero__copy p { font-size: 16px; line-height: 1.7; color: #fff;',
  '.connect-point { display: flex; gap: 10px; align-items: flex-start; color: #fff;',
  '.connect-hero__foot { color: #fff;'
]) assert.ok(stylesSource.includes(snippet));

const missing: string[] = [];
function walk(directory: string): void {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name); const info = statSync(file);
    if (info.isDirectory()) { walk(file); continue; }
    if (!/\.(?:ts|tsx)$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]/g)) {
      const specifier = match[1]; if (!specifier.startsWith('.')) continue;
      const base = resolve(file, '..', specifier);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.d.ts')];
      if (!candidates.some((candidate) => { try { return statSync(candidate).isFile(); } catch { return false; } })) missing.push(`${file} -> ${specifier}`);
    }
  }
}
walk('src'); walk('apps');
assert.deepEqual(missing, []);
console.log('Core self-test passed: boot/read-only lock, explicit safe-test credential selection, public bootstrap isolation, exact approved-base containment and approval wiring, URL redaction, TypeScript 5.9 Web Crypto and stream buffers, sandboxed CommonJS preload contract, accessible boot colors, active request cancellation, one-attempt maintenance arming, delete scope, query validation, funnel timeframe editing, sharing policy, declarations, and internal imports.');
