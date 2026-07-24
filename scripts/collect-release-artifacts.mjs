import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function sha256(filePath) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveDigest(hash.digest('hex')));
  });
}

const args = parseArgs(process.argv.slice(2));
const platform = args.platform;
const arch = args.arch;
const sourceDirectory = resolve(args.source ?? 'release');
const outputRoot = resolve(args.output ?? 'ci-artifacts');

const platformDefinition = {
  linux: { artifactOs: 'linux', builderPlatform: 'linux', nativePlatform: 'linux', extensions: ['AppImage', 'deb'] },
  windows: { artifactOs: 'win', builderPlatform: 'win', nativePlatform: 'win32', extensions: ['exe', 'zip'] },
  macos: { artifactOs: 'mac', builderPlatform: 'mac', nativePlatform: 'darwin', extensions: ['dmg', 'zip'] }
};

if (!platform || !(platform in platformDefinition)) throw new Error('Use --platform linux, windows, or macos.');
if (!arch || !/^(x64|arm64)$/u.test(arch)) throw new Error('Use --arch x64 or arm64.');
if (platform !== 'macos' && arch !== 'x64') throw new Error(`${platform} is currently packaged only for x64.`);
if (process.platform !== platformDefinition[platform].nativePlatform) {
  throw new Error(`Expected ${platform} artifacts on ${platformDefinition[platform].nativePlatform}, not ${process.platform}.`);
}
if (process.arch !== arch) throw new Error(`Expected a native ${arch} process, not ${process.arch}.`);

const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const version = packageJson.version;
const definition = platformDefinition[platform];
const outputDirectory = join(outputRoot, `${platform}-${arch}`);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const signingPath = join(sourceDirectory, 'package-signing-status.json');
const signing = JSON.parse(await readFile(signingPath, 'utf8'));
const allowedSigningStates = {
  linux: new Set(['unsigned']),
  windows: new Set(['unsigned', 'signed']),
  macos: new Set(['unsigned', 'signed', 'signed-and-notarized'])
};
if (signing.schemaVersion !== 1) throw new Error('Unsupported package-signing-status schema version.');
if (signing.platform !== definition.builderPlatform || signing.arch !== arch) {
  throw new Error(`Signing-status metadata does not match ${platform}/${arch}.`);
}
if (!allowedSigningStates[platform].has(signing.signingStatus)) {
  throw new Error(`Invalid signing status for ${platform}: ${signing.signingStatus}`);
}

const artifacts = [];
for (const extension of definition.extensions) {
  const fileName = `Keen-Key-Console-${version}-${definition.artifactOs}-${arch}.${extension}`;
  const sourcePath = join(sourceDirectory, fileName);
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error(`Expected package artifact was not created: ${sourcePath}`);
  if (sourceStat.size < 1024) throw new Error(`Package artifact is unexpectedly small (${sourceStat.size} bytes): ${sourcePath}`);

  const destinationPath = join(outputDirectory, basename(fileName));
  await copyFile(sourcePath, destinationPath);
  artifacts.push({
    file: basename(fileName),
    bytes: sourceStat.size,
    sha256: await sha256(destinationPath)
  });
}

const manifest = {
  schemaVersion: 1,
  application: packageJson.build?.productName ?? packageJson.productName ?? packageJson.name,
  packageName: packageJson.name,
  packageVersion: version,
  platform,
  artifactOs: definition.artifactOs,
  arch,
  signingStatus: signing.signingStatus,
  sourceCommit: process.env.GITHUB_SHA ?? null,
  sourceRef: process.env.GITHUB_REF ?? null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  generatedAt: new Date().toISOString(),
  artifacts
};

const manifestPath = join(outputDirectory, `manifest-${platform}-${arch}.json`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Collected ${artifacts.length} release artifact(s) in ${outputDirectory}`);
for (const artifact of artifacts) {
  console.log(`- ${artifact.file} (${artifact.bytes} bytes, sha256 ${artifact.sha256})`);
}
console.log(`- signing status: ${signing.signingStatus}`);
