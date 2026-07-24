import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  throw new Error('Provide the pushed tag, for example: npm run release:verify-tag -- v0.1.0');
}

const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const version = packageJson.version;
if (typeof version !== 'string' || version.trim() === '') {
  throw new Error('package.json must contain a non-empty version string.');
}

const expectedTag = `v${version}`;
if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${version}; expected ${expectedTag}.`);
}

console.log(`Release tag ${tag} matches package version ${version}.`);
