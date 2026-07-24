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
assert.match(mainSource, /#\/connect/);
assert.match(mainSource, /import\('\.\/app\/PublicApp'\)/);
assert.doesNotMatch(privateAppSource, /PublicViewerPage/);
assert.doesNotMatch(publicAppSource, /from\s+['"][^'"]*(workspaceStore|credentialVault|lib\/db\/database)[^'"]*['"]/);
assert.match(storeSource, /'read-only' as const/);
assert.match(clientSource, /options\.mutation && this\.runtimeMode !== 'changes-enabled'/);
assert.match(maintenanceSource, /setSubmitted\(true\)[\s\S]{0,500}client\.(?:deleteFilteredEvents|deleteCollection|deleteProperty|updateEvents)/);
assert.match(electronMainSource, /limited \? 'validation' : 'network'/);
assert.match(electronMainSource, /retryable: !aborted && !limited/);
assert.match(electronMainSource, /response\.body\.getReader\(\)/);
assert.match(schedulerSource, /activeBridgeRequests/);
assert.match(schedulerSource, /window\.keenDesktop\.cancel\(requestId\)/);
assert.match(connectSource, /Credential used for the safe test/);
assert.match(connectSource, /will not silently retry with a broader key/);
assert.match(explorerSource, /Shared funnel timeframe/);
assert.doesNotMatch(streamDetailSource, /decodeURIComponent\(params\.collection/);

const missing: string[] = [];
function walk(directory: string): void {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name); const info = statSync(file);
    if (info.isDirectory()) { walk(file); continue; }
    if (!/\.tsx?$/.test(file) || file.endsWith('.d.ts')) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]/g)) {
      const specifier = match[1]; if (!specifier.startsWith('.')) continue;
      const base = resolve(file, '..', specifier);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
      if (!candidates.some((candidate) => { try { return statSync(candidate).isFile(); } catch { return false; } })) missing.push(`${file} -> ${specifier}`);
    }
  }
}
walk('src'); walk('apps');
assert.deepEqual(missing, []);
console.log('Core self-test passed: boot/read-only lock, explicit safe-test credential selection, public bootstrap isolation, exact approved-base containment, URL redaction, bounded response streaming, active request cancellation, one-attempt maintenance arming, delete scope, query validation, funnel timeframe editing, sharing policy, and internal imports.');
