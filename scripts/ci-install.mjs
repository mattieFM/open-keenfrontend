import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const lockfiles = ['npm-shrinkwrap.json', 'package-lock.json'];
const initialLockfile = lockfiles.find((name) => existsSync(resolve(root, name)));
const installMode = initialLockfile ? 'ci' : 'install';
const dryRun = process.argv.includes('--dry-run');

if (initialLockfile) {
  console.log(`Installing dependencies reproducibly with npm ci using ${initialLockfile}.`);
} else {
  console.warn(
    '::warning title=No committed npm lockfile::Falling back to npm install. This run will generate a package-lock.json and share it with every native packaging job. Commit and review that lockfile before a production release.'
  );
}

const npmArgs = [installMode, '--no-audit', '--no-fund'];
if (!initialLockfile) npmArgs.push('--package-lock=true');

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = npmCli ? [npmCli, ...npmArgs] : npmArgs;

if (dryRun) {
  console.log(`Dry run: ${command} ${args.join(' ')}`);
  process.exit(0);
}

const result = spawnSync(command, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const finalLockfile = lockfiles.find((name) => existsSync(resolve(root, name)));
if (!finalLockfile) {
  throw new Error('Dependency installation completed without producing package-lock.json or npm-shrinkwrap.json.');
}
console.log(`Dependency graph is locked by ${finalLockfile}.`);
