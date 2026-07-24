import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
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

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

const args = parseArgs(process.argv.slice(2));
const assetsDirectory = resolve(args.assets ?? 'release-assets');
const notesPath = resolve(args.notes ?? 'release-notes.md');
const checksumPath = join(assetsDirectory, 'SHA256SUMS.txt');
const aggregateManifestPath = join(assetsDirectory, 'release-manifest.json');
const releaseChannel = process.env.RELEASE_CHANNEL ?? 'continuous';
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const expectedPackageName = packageJson.name;
const expectedPackageVersion = packageJson.version;
const expectedApplication = packageJson.build?.productName ?? packageJson.productName ?? packageJson.name;

if (typeof expectedPackageName !== 'string' || expectedPackageName.length === 0) {
  throw new Error('package.json must contain a non-empty package name.');
}
if (typeof expectedPackageVersion !== 'string' || expectedPackageVersion.length === 0) {
  throw new Error('package.json must contain a non-empty package version.');
}
if (!['stable', 'prerelease', 'continuous'].includes(releaseChannel)) {
  throw new Error(`Unsupported RELEASE_CHANNEL: ${releaseChannel}`);
}

const directoryEntries = await readdir(assetsDirectory, { withFileTypes: true });
if (directoryEntries.some((entry) => !entry.isFile())) {
  throw new Error('release-assets must contain only top-level files.');
}
const inputFileNames = directoryEntries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
const manifestFileNames = inputFileNames.filter((name) => /^manifest-(linux|windows|macos)-(x64|arm64)\.json$/u.test(name));

const matrixDefinitions = new Map([
  ['linux:x64', { platform: 'linux', artifactOs: 'linux', arch: 'x64', extensions: ['AppImage', 'deb'] }],
  ['windows:x64', { platform: 'windows', artifactOs: 'win', arch: 'x64', extensions: ['exe', 'zip'] }],
  ['macos:x64', { platform: 'macos', artifactOs: 'mac', arch: 'x64', extensions: ['dmg', 'zip'] }],
  ['macos:arm64', { platform: 'macos', artifactOs: 'mac', arch: 'arm64', extensions: ['dmg', 'zip'] }]
]);
if (manifestFileNames.length !== matrixDefinitions.size) {
  throw new Error(`Expected ${matrixDefinitions.size} per-platform manifests, found ${manifestFileNames.length}.`);
}

const platformManifests = [];
const seenMatrix = new Set();
const seenArtifacts = new Set();
const allowedSigningStates = new Map([
  ['linux', new Set(['unsigned'])],
  ['windows', new Set(['unsigned', 'signed'])],
  ['macos', new Set(['unsigned', 'signed', 'signed-and-notarized'])]
]);

for (const manifestFileName of manifestFileNames) {
  const manifestPath = join(assetsDirectory, manifestFileName);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const matrixKey = `${manifest.platform}:${manifest.arch}`;
  const definition = matrixDefinitions.get(matrixKey);
  if (!definition) throw new Error(`Unexpected platform manifest: ${matrixKey}`);
  if (seenMatrix.has(matrixKey)) throw new Error(`Duplicate platform manifest: ${matrixKey}`);
  seenMatrix.add(matrixKey);

  const expectedManifestFileName = `manifest-${definition.platform}-${definition.arch}.json`;
  if (manifestFileName !== expectedManifestFileName) {
    throw new Error(`Platform manifest filename ${manifestFileName} does not match its contents (${expectedManifestFileName}).`);
  }
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported schema version in ${manifestFileName}.`);
  if (manifest.application !== expectedApplication) throw new Error(`Application name mismatch in ${manifestFileName}.`);
  if (manifest.packageName !== expectedPackageName) throw new Error(`Package name mismatch in ${manifestFileName}.`);
  if (manifest.packageVersion !== expectedPackageVersion) throw new Error(`Package version mismatch in ${manifestFileName}.`);
  if (manifest.artifactOs !== definition.artifactOs) throw new Error(`Wrong artifact OS in ${manifestFileName}.`);
  if (!allowedSigningStates.get(definition.platform)?.has(manifest.signingStatus)) {
    throw new Error(`Invalid signing status for ${definition.platform} in ${manifestFileName}.`);
  }

  if (process.env.GITHUB_SHA && manifest.sourceCommit !== process.env.GITHUB_SHA) {
    throw new Error(`Platform package source commit does not match the release job commit in ${manifestFileName}.`);
  }
  if (manifest.sourceCommit !== null && manifest.sourceCommit !== undefined && !/^[0-9a-f]{40}$/iu.test(manifest.sourceCommit)) {
    throw new Error(`Invalid source commit in ${manifestFileName}.`);
  }
  if (process.env.GITHUB_REF && manifest.sourceRef !== process.env.GITHUB_REF) {
    throw new Error(`Platform package source ref does not match the release job ref in ${manifestFileName}.`);
  }
  if (process.env.GITHUB_RUN_ID && manifest.workflowRunId !== process.env.GITHUB_RUN_ID) {
    throw new Error(`Platform package workflow run ID does not match in ${manifestFileName}.`);
  }
  if (process.env.GITHUB_RUN_ATTEMPT && manifest.workflowRunAttempt !== process.env.GITHUB_RUN_ATTEMPT) {
    throw new Error(`Platform package workflow run attempt does not match in ${manifestFileName}.`);
  }

  const expectedArtifactNames = definition.extensions.map(
    (extension) => `Keen-Key-Console-${expectedPackageVersion}-${definition.artifactOs}-${definition.arch}.${extension}`
  );
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== expectedArtifactNames.length) {
    throw new Error(`Manifest ${manifestFileName} must describe exactly ${expectedArtifactNames.length} package artifacts.`);
  }
  const manifestArtifactNames = manifest.artifacts.map((artifact) => artifact.file).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(manifestArtifactNames) !== JSON.stringify([...expectedArtifactNames].sort((left, right) => left.localeCompare(right)))) {
    throw new Error(`Manifest ${manifestFileName} does not contain the exact expected package filenames.`);
  }

  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object') throw new Error(`Invalid artifact entry in ${manifestFileName}.`);
    if (typeof artifact.file !== 'string' || artifact.file !== basename(artifact.file)) {
      throw new Error(`Unsafe artifact path in ${manifestFileName}: ${String(artifact.file)}`);
    }
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1024) {
      throw new Error(`Invalid artifact byte count for ${artifact.file} in ${manifestFileName}.`);
    }
    if (typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(artifact.sha256)) {
      throw new Error(`Invalid artifact SHA-256 for ${artifact.file} in ${manifestFileName}.`);
    }
    if (seenArtifacts.has(artifact.file)) throw new Error(`Duplicate release artifact: ${artifact.file}`);
    seenArtifacts.add(artifact.file);

    const artifactPath = join(assetsDirectory, artifact.file);
    const artifactStat = await stat(artifactPath).catch(() => null);
    if (!artifactStat?.isFile()) throw new Error(`Manifest references a missing artifact: ${artifact.file}`);
    if (artifactStat.size < 1024 || artifactStat.size !== artifact.bytes) {
      throw new Error(`Size mismatch for ${artifact.file}: manifest ${artifact.bytes}, actual ${artifactStat?.size ?? 'missing'}.`);
    }
    const digest = await sha256(artifactPath);
    if (digest !== artifact.sha256) {
      throw new Error(`SHA-256 mismatch for ${artifact.file}: manifest ${artifact.sha256}, actual ${digest}.`);
    }
  }

  platformManifests.push(manifest);
}

for (const matrixKey of matrixDefinitions.keys()) {
  if (!seenMatrix.has(matrixKey)) throw new Error(`Release is missing the ${matrixKey} package set.`);
}

const expectedInputNames = new Set([...manifestFileNames, ...seenArtifacts]);
const unexpectedInputs = inputFileNames.filter((name) => !expectedInputNames.has(name));
if (unexpectedInputs.length > 0) throw new Error(`Unexpected release input file(s): ${unexpectedInputs.join(', ')}`);

const sourceCommits = new Set(platformManifests.map((manifest) => manifest.sourceCommit ?? null));
if (sourceCommits.size > 1) throw new Error('Platform packages were built from different source commits.');
const sourceRefs = new Set(platformManifests.map((manifest) => manifest.sourceRef ?? null));
if (sourceRefs.size > 1) throw new Error('Platform packages were built from different source refs.');

const packageVersion = expectedPackageVersion;
const releaseTag = process.env.RELEASE_TAG ?? null;
if (!releaseTag) throw new Error('RELEASE_TAG is required for release assembly.');
if (releaseTag.startsWith('v') && releaseTag !== `v${packageVersion}`) {
  throw new Error(`Release tag ${releaseTag} does not match package version ${packageVersion}.`);
}
if (releaseChannel === 'stable') {
  if (releaseTag !== `v${packageVersion}` || packageVersion.includes('-')) {
    throw new Error(`Stable release channel requires the exact non-prerelease version tag v${packageVersion}.`);
  }
}
if (releaseChannel === 'prerelease' && releaseTag === `v${packageVersion}` && !packageVersion.includes('-')) {
  throw new Error(`Non-prerelease version tag ${releaseTag} cannot use the prerelease channel.`);
}
if (releaseChannel === 'continuous') {
  const expectedContinuousTag = process.env.GITHUB_RUN_NUMBER && process.env.GITHUB_SHA
    ? `build-${process.env.GITHUB_RUN_NUMBER}-${process.env.GITHUB_SHA.slice(0, 7)}`
    : null;
  if (!releaseTag.startsWith('build-')) throw new Error('Continuous release tags must use the reserved build-* namespace.');
  if (expectedContinuousTag && releaseTag !== expectedContinuousTag) {
    throw new Error(`Continuous release tag ${releaseTag} does not match expected ${expectedContinuousTag}.`);
  }
}

const releaseMustBeUnsigned = releaseChannel === 'continuous' || !releaseTag.startsWith('v');
const unexpectedlySignedPackages = platformManifests.filter((manifest) => manifest.signingStatus !== 'unsigned');
if (releaseMustBeUnsigned && unexpectedlySignedPackages.length > 0) {
  const signedTargets = unexpectedlySignedPackages.map((manifest) => `${manifest.platform}/${manifest.arch}`).join(', ');
  throw new Error(`Continuous and non-version releases must be unsigned; signed package metadata found for: ${signedTargets}.`);
}

platformManifests.sort((left, right) => `${left.platform}:${left.arch}`.localeCompare(`${right.platform}:${right.arch}`));
const releaseManifest = {
  schemaVersion: 1,
  application: platformManifests[0].application,
  packageName: platformManifests[0].packageName,
  packageVersion,
  releaseTag,
  releaseChannel,
  repository: process.env.GITHUB_REPOSITORY ?? null,
  sourceCommit: process.env.GITHUB_SHA ?? [...sourceCommits][0] ?? null,
  sourceRef: process.env.GITHUB_REF ?? null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  workflowRunNumber: process.env.GITHUB_RUN_NUMBER ?? null,
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  generatedAt: new Date().toISOString(),
  packages: platformManifests
};
await writeFile(aggregateManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8');

const filesToChecksum = [...expectedInputNames, basename(aggregateManifestPath)].sort((left, right) => left.localeCompare(right));
const checksums = [];
for (const fileName of filesToChecksum) checksums.push(`${await sha256(join(assetsDirectory, fileName))}  ${fileName}`);
await writeFile(checksumPath, `${checksums.join('\n')}\n`, 'utf8');

const repository = process.env.GITHUB_REPOSITORY ?? 'unknown repository';
const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const commit = process.env.GITHUB_SHA ?? [...sourceCommits][0] ?? 'unknown';
const shortCommit = commit.slice(0, 7);
const refName = process.env.GITHUB_REF_NAME ?? 'unknown';
const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
const runNumber = process.env.GITHUB_RUN_NUMBER ?? 'unknown';
const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? 'unknown';
const channelCopy = {
  stable: 'This is the latest stable version release.',
  prerelease: 'This tag is published as a prerelease.',
  continuous: 'This is an automated per-push build and is intentionally published as a prerelease rather than Latest.'
}[releaseChannel];

const rows = platformManifests.flatMap((manifest) =>
  manifest.artifacts.map(
    (artifact) =>
      `| ${markdownEscape(manifest.platform)} | ${markdownEscape(manifest.arch)} | ${markdownEscape(manifest.signingStatus)} | \`${markdownEscape(artifact.file)}\` | ${artifact.bytes.toLocaleString('en-US')} | \`${artifact.sha256}\` |`
  )
);

const notes = `# Keen Key Console ${markdownEscape(releaseTag ?? packageVersion)}

This release was generated from [\`${shortCommit}\`](${serverUrl}/${repository}/commit/${commit}) on ref \`${markdownEscape(refName)}\` by workflow run [#${runNumber}.${runAttempt}](${serverUrl}/${repository}/actions/runs/${runId}).

${channelCopy}

- Application version: \`${packageVersion}\`
- Source commit: \`${commit}\`
- Runtime safety: the application boots in read-only mode and requires the in-session **ENABLE CHANGES** gate before remote mutations.
- Signing: inspect the table below; version-tag packages are signed/notarized only when the corresponding repository secrets are configured.
- Integrity: verify downloads against \`SHA256SUMS.txt\` before installation.

## Attached packages

| Platform | Architecture | Signing | File | Bytes | SHA-256 |
|---|---|---|---|---:|---|
${rows.join('\n')}

The release also includes \`release-manifest.json\`, one manifest per native build, and \`SHA256SUMS.txt\`.

## Verify a download

Linux or macOS:

\`\`\`bash
sha256sum -c SHA256SUMS.txt
\`\`\`

Windows PowerShell:

\`\`\`powershell
Get-FileHash .\\Keen-Key-Console-* -Algorithm SHA256
\`\`\`
`;

await writeFile(notesPath, notes, 'utf8');
console.log(`Prepared ${filesToChecksum.length + 1} release asset(s), checksums, aggregate manifest, and release notes.`);
