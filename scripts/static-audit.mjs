import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  if (!process.env.TYPESCRIPT_PATH) {
    throw new Error('Install dependencies or set TYPESCRIPT_PATH to the TypeScript package directory.');
  }
  ts = require(process.env.TYPESCRIPT_PATH);
}

const root = resolve(new URL('..', import.meta.url).pathname);
const codeRoots = ['src', 'apps', 'tests', 'scripts'];
const sourceFiles = [];
const textFiles = [];

function walk(relative) {
  const absolute = join(root, relative);
  for (const name of readdirSync(absolute)) {
    const childRelative = join(relative, name);
    const child = join(root, childRelative);
    const info = statSync(child);
    if (info.isDirectory()) walk(childRelative);
    else {
      if (/\.(ts|tsx|mts|cts)$/.test(name) && !name.endsWith('.d.ts')) sourceFiles.push(childRelative);
      if (/\.(ts|tsx|mts|cts|js|mjs|cjs|json|html|css|md)$/.test(name)) textFiles.push(childRelative);
    }
  }
}
for (const directory of codeRoots) if (existsSync(join(root, directory))) walk(directory);

const diagnostics = [];
for (const relative of sourceFiles) {
  const source = readFileSync(join(root, relative), 'utf8');
  const result = ts.transpileModule(source, {
    fileName: relative,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
      useDefineForClassFields: true
    }
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      diagnostics.push(`${relative}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    }
  }
}

const missingImports = [];
const forbiddenRendererImports = [];
const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
const builtins = new Set(['fs', 'path', 'child_process', 'net', 'tls', 'http', 'https', 'os', 'process', 'buffer', 'worker_threads']);
function resolveInternal(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@shared/')) base = join(root, 'src/shared', specifier.slice('@shared/'.length));
  else if (specifier.startsWith('@/')) base = join(root, 'src/renderer/src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(root, dirname(fromFile), specifier);
  else return true;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}.js`, `${base}.mjs`, `${base}.css`, join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.js')];
  return candidates.some(existsSync);
}
for (const relative of sourceFiles) {
  const source = readFileSync(join(root, relative), 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!resolveInternal(relative, specifier)) missingImports.push(`${relative} -> ${specifier}`);
    if (relative.startsWith('src/renderer/') && (specifier.startsWith('node:') || builtins.has(specifier))) forbiddenRendererImports.push(`${relative} -> ${specifier}`);
  }
}

const secretFindings = [];
const secretLiteral = /(['"`])([A-Za-z0-9_\-]{36,})\1/g;
for (const relative of sourceFiles) {
  const source = readFileSync(join(root, relative), 'utf8');
  for (const match of source.matchAll(secretLiteral)) {
    const value = match[2];
    if (/^(?:RESTRICTED_ACCESS_KEY|KNOWN_QUERY_NAME|TENANT_ID|customer_123|synthetic)/i.test(value)) continue;
    if (/^[A-Z0-9_]+$/.test(value)) continue;
    secretFindings.push(`${relative}:${source.slice(0, match.index).split('\n').length}`);
  }
}

const rendererText = sourceFiles.filter((file) => file.startsWith('src/renderer/')).map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
const privateApp = readFileSync(join(root, 'src/renderer/src/app/App.tsx'), 'utf8');
const publicApp = readFileSync(join(root, 'src/renderer/src/app/PublicApp.tsx'), 'utf8');
const mainBootstrap = readFileSync(join(root, 'src/renderer/src/main.tsx'), 'utf8');
const workspaceStore = readFileSync(join(root, 'src/renderer/src/lib/db/workspaceStore.ts'), 'utf8');
const client = readFileSync(join(root, 'src/renderer/src/lib/api/KeenClient.ts'), 'utf8');
const maintenance = readFileSync(join(root, 'src/renderer/src/features/maintenance/MaintenancePage.tsx'), 'utf8');
const scheduler = readFileSync(join(root, 'src/renderer/src/lib/api/requestScheduler.ts'), 'utf8');
const electronMain = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
const connect = readFileSync(join(root, 'src/renderer/src/features/connect/ConnectPage.tsx'), 'utf8');
const desktopBridgeDeclarationPath = join(root, 'src/preload/global.d.ts');
const desktopBridgeDeclaration = existsSync(desktopBridgeDeclarationPath) ? readFileSync(desktopBridgeDeclarationPath, 'utf8') : '';

const invariants = {
  privateBootConnect: /#\/connect/.test(mainBootstrap),
  publicLazyBootstrap: /import\('\.\/app\/PublicApp'\)/.test(mainBootstrap),
  publicDoesNotImportVault: !/(workspaceStore|credentialVault|lib\/db\/database)/.test(publicApp),
  privateDoesNotRoutePublicViewer: !/PublicViewerPage/.test(privateApp),
  readOnlyReset: /'read-only' as const/.test(workspaceStore),
  clientMutationGuard: /options\.mutation && this\.runtimeMode !== 'changes-enabled'/.test(client),
  maintenanceOneAttemptPerPreview: /setSubmitted\(true\)[\s\S]{0,500}client\.(?:deleteFilteredEvents|deleteCollection|deleteProperty|updateEvents)/.test(maintenance),
  activeWorkspaceRequestCancellation: /activeBridgeRequests/.test(scheduler) && /window\.keenDesktop\.cancel\(requestId\)/.test(scheduler),
  boundedResponseStreaming: /response\.body\.getReader\(\)/.test(electronMain) && /ResponseLimitError/.test(electronMain),
  explicitSafeTestCredential: /Credential used for the safe test/.test(connect) && /will not silently retry with a broader key/.test(connect),
  desktopBridgeGlobalDeclaration: /interface Window[\s\S]*keenDesktop:\s*DesktopBridge/.test(desktopBridgeDeclaration) && !existsSync(join(root, 'src/preload/index.d.ts')),
  noPlaintextWebStorage: !/\b(?:localStorage|sessionStorage)\b/.test(rendererText),
  noRendererNodeImports: forbiddenRendererImports.length === 0
};

const failures = [];
if (diagnostics.length) failures.push(`${diagnostics.length} TypeScript syntax diagnostic(s)`);
if (missingImports.length) failures.push(`${missingImports.length} unresolved internal import(s)`);
if (secretFindings.length) failures.push(`${secretFindings.length} likely long secret literal(s)`);
for (const [name, passed] of Object.entries(invariants)) if (!passed) failures.push(`invariant failed: ${name}`);

const report = {
  executableTypeScriptFiles: sourceFiles.length,
  scannedTextFiles: textFiles.length,
  syntaxDiagnostics: diagnostics,
  unresolvedInternalImports: missingImports,
  forbiddenRendererImports,
  likelySecretLiterals: secretFindings,
  invariants,
  passed: failures.length === 0,
  failures
};

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Static audit ${report.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`- ${report.executableTypeScriptFiles} executable TypeScript/TSX files`);
  console.log(`- ${report.scannedTextFiles} text/code files scanned`);
  console.log(`- ${report.syntaxDiagnostics.length} syntax diagnostics`);
  console.log(`- ${report.unresolvedInternalImports.length} unresolved internal imports`);
  console.log(`- ${report.forbiddenRendererImports.length} forbidden renderer Node imports`);
  console.log(`- ${report.likelySecretLiterals.length} likely long secret literals`);
  for (const [name, passed] of Object.entries(report.invariants)) console.log(`- ${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (failures.length) failures.forEach((failure) => console.error(`ERROR: ${failure}`));
}
process.exitCode = report.passed ? 0 : 1;
