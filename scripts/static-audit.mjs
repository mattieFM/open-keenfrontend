import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const root = fileURLToPath(new URL('..', import.meta.url));
const tsconfigPath = join(root, 'tsconfig.json');
const tsconfigReadResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const parsedTsconfig = ts.parseJsonConfigFileContent(
  tsconfigReadResult.config ?? {},
  ts.sys,
  root,
  undefined,
  tsconfigPath
);
const tsconfigDiagnostics = [
  ...(tsconfigReadResult.error ? [tsconfigReadResult.error] : []),
  ...parsedTsconfig.errors
].map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
const compilerRootFiles = new Set(parsedTsconfig.fileNames.map((file) => resolve(file)));
const codeRoots = ['src', 'apps', 'tests', 'scripts'];
const sourceFiles = [];
const declarationFiles = [];
const textFiles = [];

function walk(relative) {
  const absolute = join(root, relative);
  for (const name of readdirSync(absolute)) {
    const childRelative = join(relative, name);
    const child = join(root, childRelative);
    const info = statSync(child);
    if (info.isDirectory()) {
      walk(childRelative);
      continue;
    }
    if (name.endsWith('.d.ts')) declarationFiles.push(childRelative);
    else if (/\.(ts|tsx|mts|cts)$/u.test(name)) sourceFiles.push(childRelative);
    if (/\.(ts|tsx|mts|cts|js|mjs|cjs|json|html|css|md)$/u.test(name)) textFiles.push(childRelative);
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
const importPattern = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/gu;
const builtins = new Set(['fs', 'path', 'child_process', 'net', 'tls', 'http', 'https', 'os', 'process', 'buffer', 'worker_threads']);
function resolveInternal(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@shared/')) base = join(root, 'src/shared', specifier.slice('@shared/'.length));
  else if (specifier.startsWith('@/')) base = join(root, 'src/renderer/src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(root, dirname(fromFile), specifier);
  else return true;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.css`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.d.ts'),
    join(base, 'index.js')
  ];
  return candidates.some(existsSync);
}
for (const relative of [...sourceFiles, ...declarationFiles]) {
  const source = readFileSync(join(root, relative), 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!resolveInternal(relative, specifier)) missingImports.push(`${relative} -> ${specifier}`);
    if (relative.startsWith('src/renderer/') && (specifier.startsWith('node:') || builtins.has(specifier))) {
      forbiddenRendererImports.push(`${relative} -> ${specifier}`);
    }
  }
}

const secretFindings = [];
const secretLiteral = /(['"`])([A-Za-z0-9_\-]{36,})\1/gu;
for (const relative of sourceFiles) {
  const source = readFileSync(join(root, relative), 'utf8');
  for (const match of source.matchAll(secretLiteral)) {
    const value = match[2];
    if (/^(?:RESTRICTED_ACCESS_KEY|KNOWN_QUERY_NAME|TENANT_ID|customer_123|synthetic)/iu.test(value)) continue;
    if (/^[A-Z0-9_]+$/u.test(value)) continue;
    secretFindings.push(`${relative}:${source.slice(0, match.index).split('\n').length}`);
  }
}

const rendererText = sourceFiles
  .filter((file) => file.startsWith('src/renderer/'))
  .map((file) => readFileSync(join(root, file), 'utf8'))
  .join('\n');
const privateApp = readFileSync(join(root, 'src/renderer/src/app/App.tsx'), 'utf8');
const publicApp = readFileSync(join(root, 'src/renderer/src/app/PublicApp.tsx'), 'utf8');
const mainBootstrap = readFileSync(join(root, 'src/renderer/src/main.tsx'), 'utf8');
const workspaceStore = readFileSync(join(root, 'src/renderer/src/lib/db/workspaceStore.ts'), 'utf8');
const client = readFileSync(join(root, 'src/renderer/src/lib/api/KeenClient.ts'), 'utf8');
const maintenance = readFileSync(join(root, 'src/renderer/src/features/maintenance/MaintenancePage.tsx'), 'utf8');
const scheduler = readFileSync(join(root, 'src/renderer/src/lib/api/requestScheduler.ts'), 'utf8');
const electronMain = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
const connect = readFileSync(join(root, 'src/renderer/src/features/connect/ConnectPage.tsx'), 'utf8');
const credentialVault = readFileSync(join(root, 'src/renderer/src/lib/vault/credentialVault.ts'), 'utf8');
const electronViteConfig = readFileSync(join(root, 'electron.vite.config.ts'), 'utf8');
const vitestConfig = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
const bundleVerifier = readFileSync(join(root, 'scripts/verify-electron-bundle.mjs'), 'utf8');
const rendererStyles = readFileSync(join(root, 'src/renderer/src/styles.css'), 'utf8');
const desktopBridgeDeclarationPath = join(root, 'src/preload/global.d.ts');
const legacyDesktopBridgeDeclarationPath = join(root, 'src/preload/index.d.ts');
const desktopBridgeDeclaration = existsSync(desktopBridgeDeclarationPath)
  ? readFileSync(desktopBridgeDeclarationPath, 'utf8')
  : '';
const legacyDesktopBridgeDeclarationPresent = existsSync(legacyDesktopBridgeDeclarationPath);
const desktopBridgeDeclarationIsCompilerRoot = compilerRootFiles.has(resolve(desktopBridgeDeclarationPath));
const legacyDesktopBridgeDeclarationIsCompilerRoot = compilerRootFiles.has(resolve(legacyDesktopBridgeDeclarationPath));

function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function cssHexVariable(name) {
  const match = rendererStyles.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'iu'));
  return match?.[1];
}

const mutedInk = cssHexVariable('ink-500');
const primaryGreen = cssHexVariable('green-600');

const invariants = {
  privateBootConnect: /#\/connect/u.test(mainBootstrap),
  publicLazyBootstrap: /import\('\.\/app\/PublicApp'\)/u.test(mainBootstrap),
  publicDoesNotImportVault: !/(workspaceStore|credentialVault|lib\/db\/database)/u.test(publicApp),
  privateDoesNotRoutePublicViewer: !/PublicViewerPage/u.test(privateApp),
  readOnlyReset: /'read-only' as const/u.test(workspaceStore),
  clientMutationGuard: /options\.mutation && this\.runtimeMode !== 'changes-enabled'/u.test(client),
  maintenanceOneAttemptPerPreview: /setSubmitted\(true\)[\s\S]{0,500}client\.(?:deleteFilteredEvents|deleteCollection|deleteProperty|updateEvents)/u.test(maintenance),
  activeWorkspaceRequestCancellation: /activeBridgeRequests/u.test(scheduler) && /window\.keenDesktop\.cancel\(requestId\)/u.test(scheduler),
  boundedResponseStreaming: /response\.body\.getReader\(\)/u.test(electronMain) && /ResponseLimitError/u.test(electronMain),
  explicitSafeTestCredential: /Credential used for the safe test/u.test(connect) && /will not silently retry with a broader key/u.test(connect),
  accessibleConnectLandmark: /<section className="connect-hero" aria-labelledby="connect-hero-title">/u.test(connect) && /<h1 id="connect-hero-title">/u.test(connect),
  desktopBridgeGlobalDeclaration: desktopBridgeDeclarationIsCompilerRoot && /import type \{ DesktopBridge \} from '\.\.\/shared\/types'/u.test(desktopBridgeDeclaration) && /interface Window[\s\S]*keenDesktop:\s*DesktopBridge/u.test(desktopBridgeDeclaration),
  legacyDesktopBridgeDeclarationShadowed: !legacyDesktopBridgeDeclarationPresent || !legacyDesktopBridgeDeclarationIsCompilerRoot,
  webCryptoArrayBufferViews: /type CryptoBytes = Uint8Array<ArrayBuffer>/u.test(credentialVault) && /function fromBase64\([\s\S]{0,240}new Uint8Array\(binary\.length\)/u.test(credentialVault),
  streamedResponseArrayBufferViews: /Array<Uint8Array<ArrayBuffer>>/u.test(electronMain) && /chunks\.push\(new Uint8Array\(value\)\)/u.test(electronMain),
  mainProcessHostApproval: /ipcMain\.handle\('keen:approveHosts'/u.test(electronMain) && /approvedBaseIdentity/u.test(electronMain) && /validateApprovedTarget\(payload\.baseUrl, payload\.path, !app\.isPackaged, approvedBases\)/u.test(electronMain),
  sandboxedCommonJsPreload: /format:\s*'cjs'/u.test(electronViteConfig) && /entryFileNames:\s*'\[name\]\.cjs'/u.test(electronViteConfig) && /preload\/index\.cjs/u.test(electronMain) && /Sandboxed preload must be a self-contained CommonJS bundle/u.test(bundleVerifier),
  vitestUsesIndependentTsxTransform: !/@vitejs\/plugin-react/u.test(vitestConfig) && !/plugins:\s*\[\s*react\(\)/u.test(vitestConfig),
  bootColorContrast: Boolean(mutedInk && primaryGreen) && contrastRatio(mutedInk, '#ffffff') >= 4.5 && contrastRatio(primaryGreen, '#ffffff') >= 4.5,
  connectHeroTextContrast: [
    '.connect-brand span { color: #fff;',
    '.connect-hero__copy p { font-size: 16px; line-height: 1.7; color: #fff;',
    '.connect-point { display: flex; gap: 10px; align-items: flex-start; color: #fff;',
    '.connect-hero__foot { color: #fff;'
  ].every((snippet) => rendererStyles.includes(snippet)),
  noPlaintextWebStorage: !/\b(?:localStorage|sessionStorage)\b/u.test(rendererText),
  noRendererNodeImports: forbiddenRendererImports.length === 0
};

const advisories = [];
if (legacyDesktopBridgeDeclarationPresent) {
  advisories.push(
    'src/preload/index.d.ts is a shadowed legacy declaration beside src/preload/index.ts; ' +
    'TypeScript ignores it while src/preload/global.d.ts supplies the active Window bridge type. Remove the legacy file when convenient.'
  );
}

const failures = [];
if (tsconfigDiagnostics.length) failures.push(`${tsconfigDiagnostics.length} TypeScript configuration diagnostic(s)`);
if (diagnostics.length) failures.push(`${diagnostics.length} TypeScript syntax diagnostic(s)`);
if (missingImports.length) failures.push(`${missingImports.length} unresolved internal import(s)`);
if (secretFindings.length) failures.push(`${secretFindings.length} likely long secret literal(s)`);
for (const [name, passed] of Object.entries(invariants)) if (!passed) failures.push(`invariant failed: ${name}`);

const report = {
  executableTypeScriptFiles: sourceFiles.length,
  declarationFiles: declarationFiles.length,
  scannedTextFiles: textFiles.length,
  tsconfigDiagnostics,
  syntaxDiagnostics: diagnostics,
  unresolvedInternalImports: missingImports,
  forbiddenRendererImports,
  likelySecretLiterals: secretFindings,
  invariants,
  advisories,
  passed: failures.length === 0,
  failures
};

if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Static audit ${report.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`- ${report.executableTypeScriptFiles} executable TypeScript/TSX files`);
  console.log(`- ${report.declarationFiles} TypeScript declaration files`);
  console.log(`- ${report.scannedTextFiles} text/code files scanned`);
  console.log(`- ${report.tsconfigDiagnostics.length} TypeScript configuration diagnostics`);
  console.log(`- ${report.syntaxDiagnostics.length} syntax diagnostics`);
  console.log(`- ${report.unresolvedInternalImports.length} unresolved internal imports`);
  console.log(`- ${report.forbiddenRendererImports.length} forbidden renderer Node imports`);
  console.log(`- ${report.likelySecretLiterals.length} likely long secret literals`);
  console.log(`- ${report.advisories.length} advisory notice(s)`);
  for (const [name, passed] of Object.entries(report.invariants)) console.log(`- ${passed ? 'PASS' : 'FAIL'} ${name}`);
  for (const advisory of report.advisories) console.warn(`NOTICE: ${advisory}`);
  if (failures.length) failures.forEach((failure) => console.error(`ERROR: ${failure}`));
}
process.exitCode = report.passed ? 0 : 1;
