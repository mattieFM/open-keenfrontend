import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const mainPath = join(root, 'out/main/index.js');
const preloadPath = join(root, 'out/preload/index.cjs');
const rendererPath = join(root, 'out/renderer/index.html');

async function requireFile(path, label) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new Error(`Electron bundle is missing ${label}: ${relative(root, path)}`);
  }
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Electron bundle has an empty or invalid ${label}: ${relative(root, path)}`);
  }
  return readFile(path, 'utf8');
}

const [main, preload, renderer] = await Promise.all([
  requireFile(mainPath, 'main entry'),
  requireFile(preloadPath, 'sandboxed preload entry'),
  requireFile(rendererPath, 'renderer entry')
]);

if (!/preload[\\/]index\.cjs/u.test(main)) {
  throw new Error('Main bundle does not point BrowserWindow at preload/index.cjs.');
}
if (/^\s*(?:import(?:\s|[{*])|export(?:\s|[{*]))/mu.test(preload) || /\bimport\s*\(/u.test(preload)) {
  throw new Error('Sandboxed preload must be a self-contained CommonJS bundle without ESM imports or exports.');
}
if (!/require\(["']electron["']\)/u.test(preload)) {
  throw new Error('Sandboxed preload must load Electron through CommonJS require().');
}
if (!/contextBridge/u.test(preload) || !/exposeInMainWorld/u.test(preload)) {
  throw new Error('Sandboxed preload does not expose the expected contextBridge API.');
}
if (/\/src\/main\.tsx/u.test(renderer) || !/<script\b[^>]*\btype=["']module["']/iu.test(renderer)) {
  throw new Error('Renderer output is not a production module bundle.');
}

const preloadFiles = (await readdir(join(root, 'out/preload')))
  .filter((name) => !name.endsWith('.map'))
  .sort();
if (preloadFiles.length !== 1 || preloadFiles[0] !== 'index.cjs') {
  throw new Error(`Expected exactly one executable preload bundle (index.cjs); found: ${preloadFiles.join(', ') || '<none>'}.`);
}

console.log('Electron bundle contract PASSED (main, sandboxed CommonJS preload, and production renderer entry).');
