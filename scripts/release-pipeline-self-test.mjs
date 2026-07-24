import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const sourceRef = 'refs/heads/release-pipeline-test';
const testEnvironment = {
  GITHUB_SHA: sourceCommit,
  GITHUB_REF: sourceRef,
  GITHUB_REF_NAME: 'release-pipeline-test',
  GITHUB_REPOSITORY: 'keen-test/keen-key-console',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_RUN_ID: '424242',
  GITHUB_RUN_NUMBER: '42',
  GITHUB_RUN_ATTEMPT: '1'
};

function runNodeIn(repositoryRoot, script, args = [], environment = {}) {
  return spawnSync(process.execPath, [join(repositoryRoot, script), ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    encoding: 'utf8'
  });
}

function runNode(script, args = [], environment = {}) {
  return runNodeIn(root, script, args, environment);
}

function runCommand(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8'
  });
}

function output(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function expectSuccess(result, label) {
  assert.equal(result.status, 0, `${label} failed:\n${output(result)}`);
}

function expectFailure(result, pattern, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded.`);
  assert.match(output(result), pattern, `${label} failed for an unexpected reason.`);
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function writeSyntheticTarget(assetsDirectory, definition) {
  const artifacts = [];
  for (const extension of definition.extensions) {
    const file = `Keen-Key-Console-${version}-${definition.artifactOs}-${definition.arch}.${extension}`;
    const bytes = Buffer.alloc(4096 + artifacts.length * 257, definition.fillByte);
    const path = join(assetsDirectory, file);
    await writeFile(path, bytes);
    artifacts.push({ file, bytes: bytes.length, sha256: await sha256(path) });
  }

  const manifest = {
    schemaVersion: 1,
    application: packageJson.build?.productName ?? packageJson.name,
    packageName: packageJson.name,
    packageVersion: version,
    platform: definition.platform,
    artifactOs: definition.artifactOs,
    arch: definition.arch,
    signingStatus: definition.signingStatus,
    sourceCommit,
    sourceRef,
    workflowRunId: testEnvironment.GITHUB_RUN_ID,
    workflowRunAttempt: testEnvironment.GITHUB_RUN_ATTEMPT,
    generatedAt: '2026-07-23T12:00:00.000Z',
    artifacts
  };
  await writeFile(
    join(assetsDirectory, `manifest-${definition.platform}-${definition.arch}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function copyDirectoryFiles(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    assert.equal(entry.isFile(), true, `Fixture directory contains a non-file entry: ${entry.name}`);
    await cp(join(source, entry.name), join(destination, entry.name));
  }
}

async function updateManifest(directory, fileName, update) {
  const path = join(directory, fileName);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  update(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}
`, 'utf8');
}

async function copyFixtureFiles(destination, relativePaths) {
  for (const relativePath of relativePaths) {
    const destinationPath = join(destination, relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(join(root, relativePath), destinationPath);
  }
}

const tempRoot = await mkdtemp(join(tmpdir(), 'keen-release-pipeline-'));
try {
  const validatorFixture = join(tempRoot, 'validator-fixture');
  await copyFixtureFiles(validatorFixture, [
    '.github/workflows/electron-build-release.yml',
    '.gitignore',
    'package.json',
    'build/entitlements.mac.plist',
    'build/entitlements.mac.inherit.plist',
    'scripts/ci-install.mjs',
    'scripts/package-ci.mjs',
    'scripts/validate-release-workflow.mjs',
    'scripts/verify-release-tag.mjs',
    'scripts/collect-release-artifacts.mjs',
    'scripts/prepare-ci-release.mjs',
    'scripts/release-pipeline-self-test.mjs'
  ]);
  expectSuccess(runCommand('git', ['init', '--quiet'], validatorFixture), 'validator fixture git initialization');
  expectSuccess(runCommand('git', ['add', '--all'], validatorFixture), 'validator fixture source tracking');
  const validatorWorkflowPath = join(validatorFixture, '.github/workflows/electron-build-release.yml');
  const validatorGitignorePath = join(validatorFixture, '.gitignore');
  const originalValidatorGitignore = await readFile(validatorGitignorePath, 'utf8');
  await writeFile(
    validatorGitignorePath,
    originalValidatorGitignore.replace('/release/', 'release/'),
    'utf8'
  );
  expectFailure(
    runNodeIn(validatorFixture, 'scripts/validate-release-workflow.mjs'),
    /unanchored release\/ ignore rule/u,
    'release subtree ignore regression rejection'
  );
  await writeFile(validatorGitignorePath, originalValidatorGitignore, 'utf8');

  const originalValidatorWorkflow = await readFile(validatorWorkflowPath, 'utf8');
  await writeFile(
    validatorWorkflowPath,
    originalValidatorWorkflow.replace(" &&\n       github.actor != 'dependabot[bot]'", ''),
    'utf8'
  );
  expectFailure(
    runNodeIn(validatorFixture, 'scripts/validate-release-workflow.mjs'),
    /Dependabot runs must build artifacts/u,
    'Dependabot release-write guard rejection'
  );
  await writeFile(validatorWorkflowPath, originalValidatorWorkflow, 'utf8');
  const checkoutPinPattern = /actions\/checkout@[0-9a-f]{40}/gu;
  const checkoutUses = originalValidatorWorkflow.match(checkoutPinPattern) ?? [];
  assert.ok(checkoutUses.length >= 2, 'Validator fixture must contain multiple checkout uses.');

  const syntheticDependabotPin = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await writeFile(
    validatorWorkflowPath,
    originalValidatorWorkflow.replace(checkoutPinPattern, `actions/checkout@${syntheticDependabotPin}`),
    'utf8'
  );
  expectSuccess(
    runNodeIn(validatorFixture, 'scripts/validate-release-workflow.mjs'),
    'consistent full-SHA Dependabot action update validation'
  );

  expectSuccess(
    runCommand('git', ['rm', '--cached', '--quiet', '--', 'scripts/release-pipeline-self-test.mjs'], validatorFixture),
    'release self-test untracking fixture setup'
  );
  expectFailure(
    runNodeIn(validatorFixture, 'scripts/validate-release-workflow.mjs'),
    /Required release helper is not tracked by Git: scripts\/release-pipeline-self-test\.mjs/u,
    'untracked release self-test rejection'
  );
  expectSuccess(
    runCommand('git', ['add', '--', 'scripts/release-pipeline-self-test.mjs'], validatorFixture),
    'release self-test tracking fixture restore'
  );

  await writeFile(
    validatorWorkflowPath,
    originalValidatorWorkflow.replace(checkoutUses[0], `actions/checkout@${syntheticDependabotPin}`),
    'utf8'
  );
  expectFailure(
    runNodeIn(validatorFixture, 'scripts/validate-release-workflow.mjs'),
    /one consistent commit SHA/u,
    'inconsistent action pin rejection'
  );

  await writeFile(
    validatorWorkflowPath,
    originalValidatorWorkflow.replace(checkoutPinPattern, 'actions/checkout@v7'),
    'utf8'
  );
  expectFailure(
    runNodeIn(validatorFixture, 'scripts/validate-release-workflow.mjs'),
    /full commit SHA/u,
    'floating action tag rejection'
  );

  await writeFile(validatorWorkflowPath, originalValidatorWorkflow, 'utf8');
  await rm(join(validatorFixture, 'scripts/release-pipeline-self-test.mjs'));
  expectFailure(
    runNodeIn(validatorFixture, 'scripts/validate-release-workflow.mjs'),
    /Required release helper is missing: scripts\/release-pipeline-self-test\.mjs/u,
    'missing committed release self-test rejection'
  );

  const correctTag = runNode('scripts/verify-release-tag.mjs', [`v${version}`]);
  expectSuccess(correctTag, 'exact release tag verification');

  const wrongTag = runNode('scripts/verify-release-tag.mjs', ['v999.999.999']);
  expectFailure(wrongTag, /does not match package version/u, 'mismatched release tag verification');

  // Exercise dependency-install planning in an isolated fixture. The real CI
  // checkout may already contain a lockfile generated by the preceding install
  // step, so using `root` here would make this test order-dependent.
  const installFixture = join(tempRoot, 'ci-install-fixture');
  await mkdir(join(installFixture, 'scripts'), { recursive: true });
  await cp(join(root, 'scripts/ci-install.mjs'), join(installFixture, 'scripts/ci-install.mjs'));
  await writeFile(
    join(installFixture, 'package.json'),
    `${JSON.stringify({ name: 'keen-ci-install-fixture', version: '0.0.0', private: true }, null, 2)}\n`,
    'utf8'
  );

  const bootstrapInstallPlan = runNodeIn(
    installFixture,
    'scripts/ci-install.mjs',
    ['--dry-run'],
    { KEEN_REQUIRE_COMMITTED_LOCK: 'false' }
  );
  expectSuccess(bootstrapInstallPlan, 'dependency installation bootstrap dry run');
  assert.match(output(bootstrapInstallPlan), /Bootstrapping npm lockfile/u);
  assert.match(output(bootstrapInstallPlan), /\binstall\b[\s\S]*--package-lock=true/u);
  assert.match(output(bootstrapInstallPlan), /Dry run:/u);

  const productionInstallWithoutLock = runNodeIn(
    installFixture,
    'scripts/ci-install.mjs',
    ['--dry-run'],
    { KEEN_REQUIRE_COMMITTED_LOCK: 'true' }
  );
  expectFailure(
    productionInstallWithoutLock,
    /Committed npm lockfile required/u,
    'production release without committed lock rejection'
  );

  await writeFile(
    join(installFixture, 'package-lock.json'),
    `${JSON.stringify({
      name: 'keen-ci-install-fixture',
      version: '0.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'keen-ci-install-fixture', version: '0.0.0' }
      }
    }, null, 2)}\n`,
    'utf8'
  );
  const lockedInstallPlan = runNodeIn(
    installFixture,
    'scripts/ci-install.mjs',
    ['--dry-run'],
    { KEEN_REQUIRE_COMMITTED_LOCK: 'true' }
  );
  expectSuccess(lockedInstallPlan, 'dependency installation locked dry run');
  assert.match(output(lockedInstallPlan), /Installing dependencies reproducibly with npm ci using package-lock\.json/u);
  assert.match(output(lockedInstallPlan), /\bci\b[\s\S]*--no-audit[\s\S]*--no-fund/u);
  assert.doesNotMatch(output(lockedInstallPlan), /--package-lock=true/u);

  const pristineAssets = join(tempRoot, 'pristine-assets');
  await mkdir(pristineAssets, { recursive: true });

  if (process.platform === 'linux' && process.arch === 'x64') {
    const sourceDirectory = join(tempRoot, 'collector-source');
    const collectorOutput = join(tempRoot, 'collector-output');
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      join(sourceDirectory, `Keen-Key-Console-${version}-linux-x64.AppImage`),
      Buffer.alloc(4096, 0x41)
    );
    await writeFile(
      join(sourceDirectory, `Keen-Key-Console-${version}-linux-x64.deb`),
      Buffer.alloc(4353, 0x42)
    );
    await writeFile(
      join(sourceDirectory, 'package-signing-status.json'),
      `${JSON.stringify({ schemaVersion: 1, platform: 'linux', arch: 'x64', signingStatus: 'unsigned' }, null, 2)}\n`,
      'utf8'
    );

    const collected = runNode(
      'scripts/collect-release-artifacts.mjs',
      ['--platform', 'linux', '--arch', 'x64', '--source', sourceDirectory, '--output', collectorOutput],
      testEnvironment
    );
    expectSuccess(collected, 'native Linux artifact collection');
    await copyDirectoryFiles(join(collectorOutput, 'linux-x64'), pristineAssets);

    const linuxManifest = JSON.parse(await readFile(join(pristineAssets, 'manifest-linux-x64.json'), 'utf8'));
    assert.equal(linuxManifest.signingStatus, 'unsigned');
    assert.equal(linuxManifest.artifacts.length, 2);
  } else {
    console.log(`Skipping native collector execution on ${process.platform}/${process.arch}; generating its Linux fixture instead.`);
    await writeSyntheticTarget(pristineAssets, {
      platform: 'linux', artifactOs: 'linux', arch: 'x64', extensions: ['AppImage', 'deb'], signingStatus: 'unsigned', fillByte: 0x41
    });
  }

  await writeSyntheticTarget(pristineAssets, {
    platform: 'windows', artifactOs: 'win', arch: 'x64', extensions: ['exe', 'zip'], signingStatus: 'unsigned', fillByte: 0x51
  });
  await writeSyntheticTarget(pristineAssets, {
    platform: 'macos', artifactOs: 'mac', arch: 'x64', extensions: ['dmg', 'zip'], signingStatus: 'unsigned', fillByte: 0x61
  });
  await writeSyntheticTarget(pristineAssets, {
    platform: 'macos', artifactOs: 'mac', arch: 'arm64', extensions: ['dmg', 'zip'], signingStatus: 'unsigned', fillByte: 0x71
  });

  const validAssets = join(tempRoot, 'valid-assets');
  await cp(pristineAssets, validAssets, { recursive: true });
  const notesPath = join(tempRoot, 'release-notes.md');
  const prepared = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', validAssets, '--notes', notesPath],
    { ...testEnvironment, RELEASE_TAG: 'build-42-0123456', RELEASE_CHANNEL: 'continuous' }
  );
  expectSuccess(prepared, 'aggregate release preparation');

  const aggregate = JSON.parse(await readFile(join(validAssets, 'release-manifest.json'), 'utf8'));
  assert.equal(aggregate.releaseTag, 'build-42-0123456');
  assert.equal(aggregate.releaseChannel, 'continuous');
  assert.equal(aggregate.sourceCommit, sourceCommit);
  assert.equal(aggregate.packages.length, 4);
  assert.equal(aggregate.packages.flatMap((manifest) => manifest.artifacts).length, 8);

  const checksumLines = (await readFile(join(validAssets, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n');
  assert.equal(checksumLines.length, 13, 'Checksums must cover eight packages, four native manifests, and the aggregate manifest.');
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  ([^/]+)$/u.exec(line);
    assert.ok(match, `Malformed checksum line: ${line}`);
    assert.equal(await sha256(join(validAssets, match[2])), match[1], `Checksum mismatch for ${match[2]}`);
  }
  const notes = await readFile(notesPath, 'utf8');
  assert.match(notes, /ENABLE CHANGES/u);
  assert.match(notes, /SHA256SUMS\.txt/u);

  const signedVersionAssets = join(tempRoot, 'signed-version-assets');
  await cp(pristineAssets, signedVersionAssets, { recursive: true });
  await updateManifest(signedVersionAssets, 'manifest-windows-x64.json', (manifest) => {
    manifest.signingStatus = 'signed';
  });
  await updateManifest(signedVersionAssets, 'manifest-macos-x64.json', (manifest) => {
    manifest.signingStatus = 'signed';
  });
  await updateManifest(signedVersionAssets, 'manifest-macos-arm64.json', (manifest) => {
    manifest.signingStatus = 'signed-and-notarized';
  });
  const signedVersion = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', signedVersionAssets, '--notes', join(tempRoot, 'signed-version-notes.md')],
    { ...testEnvironment, RELEASE_TAG: `v${version}`, RELEASE_CHANNEL: 'stable' }
  );
  expectSuccess(signedVersion, 'signed version release acceptance');

  const signedContinuousAssets = join(tempRoot, 'signed-continuous-assets');
  await cp(pristineAssets, signedContinuousAssets, { recursive: true });
  await updateManifest(signedContinuousAssets, 'manifest-macos-x64.json', (manifest) => {
    manifest.signingStatus = 'signed';
  });
  const signedContinuous = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', signedContinuousAssets, '--notes', join(tempRoot, 'signed-continuous-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'build-42-0123456', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(signedContinuous, /Continuous and non-version releases must be unsigned/u, 'signed continuous release rejection');

  const tamperedAssets = join(tempRoot, 'tampered-assets');
  await cp(pristineAssets, tamperedAssets, { recursive: true });
  const tamperedName = `Keen-Key-Console-${version}-win-x64.exe`;
  const tamperedPath = join(tamperedAssets, tamperedName);
  const tamperedBytes = await readFile(tamperedPath);
  tamperedBytes[0] ^= 0xff;
  await writeFile(tamperedPath, tamperedBytes);
  const tampered = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', tamperedAssets, '--notes', join(tempRoot, 'tampered-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'build-42-0123456', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(tampered, /SHA-256 mismatch/u, 'tampered package detection');

  const unexpectedAssets = join(tempRoot, 'unexpected-assets');
  await cp(pristineAssets, unexpectedAssets, { recursive: true });
  await writeFile(join(unexpectedAssets, 'unexpected-secret.txt'), 'must not publish\n', 'utf8');
  const unexpected = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', unexpectedAssets, '--notes', join(tempRoot, 'unexpected-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'build-42-0123456', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(unexpected, /Unexpected release input file/u, 'unexpected asset rejection');

  const wrongCommitAssets = join(tempRoot, 'wrong-commit-assets');
  await cp(pristineAssets, wrongCommitAssets, { recursive: true });
  const wrongCommit = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', wrongCommitAssets, '--notes', join(tempRoot, 'wrong-commit-notes.md')],
    { ...testEnvironment, GITHUB_SHA: 'f'.repeat(40), RELEASE_TAG: 'build-42-fffffff', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(wrongCommit, /source commit does not match/u, 'source commit mismatch rejection');

  const wrongVersionAssets = join(tempRoot, 'wrong-version-assets');
  await cp(pristineAssets, wrongVersionAssets, { recursive: true });
  const wrongVersion = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', wrongVersionAssets, '--notes', join(tempRoot, 'wrong-version-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'v999.999.999', RELEASE_CHANNEL: 'stable' }
  );
  expectFailure(wrongVersion, /does not match package version/u, 'release tag/package version mismatch rejection');

  const wrongContinuousTagAssets = join(tempRoot, 'wrong-continuous-tag-assets');
  await cp(pristineAssets, wrongContinuousTagAssets, { recursive: true });
  const wrongContinuousTag = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', wrongContinuousTagAssets, '--notes', join(tempRoot, 'wrong-continuous-tag-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'build-999-deadbee', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(wrongContinuousTag, /does not match expected/u, 'continuous tag provenance rejection');

  const swappedManifestAssets = join(tempRoot, 'swapped-manifest-assets');
  await cp(pristineAssets, swappedManifestAssets, { recursive: true });
  const linuxManifestPath = join(swappedManifestAssets, 'manifest-linux-x64.json');
  const windowsManifestPath = join(swappedManifestAssets, 'manifest-windows-x64.json');
  const linuxManifestText = await readFile(linuxManifestPath, 'utf8');
  const windowsManifestText = await readFile(windowsManifestPath, 'utf8');
  await writeFile(linuxManifestPath, windowsManifestText, 'utf8');
  await writeFile(windowsManifestPath, linuxManifestText, 'utf8');
  const swappedManifest = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', swappedManifestAssets, '--notes', join(tempRoot, 'swapped-manifest-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'build-42-0123456', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(swappedManifest, /filename .* does not match its contents/u, 'swapped manifest rejection');

  const missingCommitAssets = join(tempRoot, 'missing-commit-assets');
  await cp(pristineAssets, missingCommitAssets, { recursive: true });
  await updateManifest(missingCommitAssets, 'manifest-macos-arm64.json', (manifest) => {
    manifest.sourceCommit = null;
  });
  const missingCommit = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', missingCommitAssets, '--notes', join(tempRoot, 'missing-commit-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'build-42-0123456', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(missingCommit, /source commit does not match/u, 'missing source commit rejection');

  const impossibleSigningAssets = join(tempRoot, 'impossible-signing-assets');
  await cp(pristineAssets, impossibleSigningAssets, { recursive: true });
  await updateManifest(impossibleSigningAssets, 'manifest-linux-x64.json', (manifest) => {
    manifest.signingStatus = 'signed';
  });
  const impossibleSigning = runNode(
    'scripts/prepare-ci-release.mjs',
    ['--assets', impossibleSigningAssets, '--notes', join(tempRoot, 'impossible-signing-notes.md')],
    { ...testEnvironment, RELEASE_TAG: 'build-42-0123456', RELEASE_CHANNEL: 'continuous' }
  );
  expectFailure(impossibleSigning, /Invalid signing status for linux/u, 'impossible platform signing rejection');

  console.log('Release pipeline self-test PASSED (minimal source-tree fixture, isolated lock/no-lock install plans, Dependabot-safe full-SHA validation, tag/channel and signing guards, collector, 8 packages, 4 manifests, checksums, provenance, manifest identity, tamper and unexpected-input rejection).');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
