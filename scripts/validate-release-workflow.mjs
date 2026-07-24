import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve('.github/workflows/electron-build-release.yml'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const prepareScript = readFileSync(resolve('scripts/prepare-ci-release.mjs'), 'utf8');
const macEntitlements = readFileSync(resolve('build/entitlements.mac.plist'), 'utf8');
const macInheritedEntitlements = readFileSync(resolve('build/entitlements.mac.inherit.plist'), 'utf8');
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

requireCondition(/^on:\s*\n[\s\S]*?^  push:\s*$/mu.test(workflow), 'Workflow must run on push.');
requireCondition(/branches:\s*\n\s+- ['"]\*\*['"]/u.test(workflow), 'Push trigger must include every branch.');
requireCondition(/tags:\s*\n\s+- ['"]\*\*['"]\s*\n\s+- ['"]!build-\*['"]/u.test(workflow), 'Push trigger must include all user tags while reserving build-* for generated continuous releases.');
requireCondition(/^  pull_request:\s*$/mu.test(workflow), 'Workflow must validate pull requests.');
requireCondition(/^  workflow_dispatch:\s*$/mu.test(workflow), 'Workflow must support manual dispatch.');
requireCondition(!/cancel-in-progress:\s*true/u.test(workflow), 'Runs must not be cancelled because every push must remain releasable.');

requireCondition(/^permissions:\s*\n  contents: read/mu.test(workflow), 'Default workflow permissions must be read-only.');
requireCondition((workflow.match(/contents:\s*write/gu) ?? []).length === 1, 'Exactly one job must request contents: write.');
requireCondition(/release:[\s\S]*?permissions:\s*\n      contents: write/u.test(workflow), 'Only the release job should request contents: write.');
requireCondition(/release:[\s\S]*?github\.event_name == 'push'[\s\S]*?workflow_dispatch/u.test(workflow), 'Release job must publish every non-deletion push and manual run.');
requireCondition(/package:[\s\S]*?needs: verify/u.test(workflow), 'Native packaging must wait for verification.');
requireCondition(/release:[\s\S]*?needs:\s*\n      - verify\s*\n      - package/u.test(workflow), 'Release publication must wait for verification and every native package.');
requireCondition(/args=\([\s\S]{0,160}release create/u.test(workflow), 'Workflow must create GitHub releases.');
requireCondition(/gh release upload[\s\S]{0,120}--clobber/u.test(workflow), 'Existing releases must be handled explicitly and rerun uploads must use --clobber.');
requireCondition(/--prerelease --latest=false/u.test(workflow), 'Continuous and non-stable releases must be prereleases, not Latest.');
requireCondition(/build-\$\{GITHUB_RUN_NUMBER\}-\$\{short_sha\}/u.test(workflow), 'Continuous releases need a stable run/commit tag so reruns update one release.');
requireCondition(/--target "\$\{GITHUB_SHA\}"/u.test(workflow), 'Continuous release tags must target the exact source commit.');
requireCondition(/--verify-tag/u.test(workflow), 'Pushed tag releases must verify that the tag already exists.');
requireCondition(/gh release download "\$\{RELEASE_TAG\}"[\s\S]{0,180}--pattern release-manifest\.json/u.test(workflow), 'Existing releases must be checked against their attached provenance manifest before replacement.');
requireCondition(/existing_tag_commit[\s\S]{0,500}GITHUB_SHA[\s\S]{0,220}refusing to clobber/u.test(workflow), 'Existing release replacement must refuse a tag-to-commit mismatch.');
requireCondition(/existing_commit[\s\S]{0,500}GITHUB_SHA[\s\S]{0,220}refusing to clobber/u.test(workflow), 'Existing release replacement must refuse a provenance-manifest source-commit mismatch.');
requireCondition(/resolved-npm-lock/u.test(workflow), 'Native jobs must share the dependency graph resolved by verification.');
requireCondition(/digest-mismatch: error/u.test(workflow), 'Downloaded workflow artifacts must fail on digest mismatch.');
requireCondition(/SHA256SUMS\.txt/u.test(prepareScript), 'Release preparation must generate SHA256SUMS.txt.');
requireCondition(/release-manifest\.json/u.test(prepareScript), 'Release preparation must generate release-manifest.json.');
requireCondition(/signingStatus/u.test(prepareScript), 'Release metadata must preserve package signing status.');
requireCondition(/releaseChannel === 'continuous' \|\| !releaseTag\.startsWith\('v'\)/u.test(prepareScript), 'Continuous and non-version release assembly must enforce unsigned packages.');
requireCondition(/Continuous and non-version releases must be unsigned/u.test(prepareScript), 'Unsigned release-channel violations must fail with an explicit error.');

const expectedActionPins = new Map([
  ['actions/checkout', '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  ['actions/download-artifact', '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c']
]);
const actionUses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gmu)].map((match) => match[1]);
requireCondition(actionUses.length > 0, 'Workflow contains no external actions.');
for (const actionUse of actionUses) {
  const separator = actionUse.lastIndexOf('@');
  const name = actionUse.slice(0, separator);
  const reference = actionUse.slice(separator + 1);
  requireCondition(Boolean(name && reference), `Malformed action reference: ${actionUse}`);
  requireCondition(/^[0-9a-f]{40}$/u.test(reference), `Action must be pinned to a full commit SHA: ${actionUse}`);
  requireCondition(expectedActionPins.has(name), `Unapproved external action: ${name}`);
  if (expectedActionPins.has(name)) requireCondition(reference === expectedActionPins.get(name), `Unexpected pin for ${name}: ${reference}`);
}
for (const [name, reference] of expectedActionPins) {
  requireCondition(actionUses.includes(`${name}@${reference}`), `Workflow is missing pinned action ${name}@${reference}.`);
}

const expectedMatrixRows = [
  ['ubuntu-24.04', 'linux', 'linux', 'x64'],
  ['windows-2025', 'win', 'windows', 'x64'],
  ['macos-15', 'mac', 'macos', 'arm64'],
  ['macos-15-intel', 'mac', 'macos', 'x64']
];
for (const [runner, builderPlatform, artifactPlatform, arch] of expectedMatrixRows) {
  const rowPattern = new RegExp(
    `runner: ${escapeRegExp(runner)}[\\s\\S]{0,180}builder_platform: ${escapeRegExp(builderPlatform)}[\\s\\S]{0,120}artifact_platform: ${escapeRegExp(artifactPlatform)}[\\s\\S]{0,120}arch: ${escapeRegExp(arch)}`,
    'u'
  );
  requireCondition(rowPattern.test(workflow), `Workflow matrix is missing ${artifactPlatform}/${arch} on ${runner}.`);
}
requireCondition(/npm run ci:package/u.test(workflow), 'Native jobs must use the guarded native packaging helper.');
requireCondition(/WIN_CSC_LINK: \$\{\{ secrets\.WIN_CSC_LINK \}\}/u.test(workflow), 'Windows signing secret must be scoped to its version-tag step.');
requireCondition(/MAC_CSC_LINK: \$\{\{ secrets\.MAC_CSC_LINK \}\}/u.test(workflow), 'macOS signing secret must be scoped to its version-tag step.');
requireCondition(/APPLE_API_KEY_BASE64: \$\{\{ secrets\.APPLE_API_KEY_BASE64 \}\}/u.test(workflow), 'The base64 Apple API key secret must be scoped to the macOS version-tag step.');
requireCondition((workflow.match(/if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/gu) ?? []).length === 4, 'Tag verification and all production-signing package steps must require an actual pushed v* tag.');
requireCondition(/if: \$\{\{ github\.event_name != 'push' \|\| !startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/u.test(workflow), 'Manual, branch, non-v-tag, and pull-request packages must use the unsigned path.');
requireCondition((workflow.match(/if \[\[ "\$\{GITHUB_EVENT_NAME\}" == 'push' && "\$\{GITHUB_REF_TYPE\}" == 'tag' \]\]; then/gu) ?? []).length === 2, 'Only actual tag-push events may publish from or verify an existing tag.');
requireCondition((workflow.match(/--latest=false/gu) ?? []).length >= 2, 'Continuous and prerelease creation/update paths must explicitly clear Latest status.');

const packageHelper = readFileSync(resolve('scripts/package-ci.mjs'), 'utf8');
requireCondition(/--config\.mac\.hardenedRuntime=true/u.test(packageHelper), 'Signed macOS packages must enable hardened runtime.');
requireCondition(/--config\.mac\.hardenedRuntime=false/u.test(packageHelper), 'Unsigned macOS packages must explicitly disable hardened runtime.');
requireCondition(/explicitVersionTagBuild === 'false'[\s\S]{0,120}\? false/u.test(packageHelper), 'An explicit false version-tag flag must override tag-shaped environment metadata.');
requireCondition(/GITHUB_EVENT_NAME === 'push'[\s\S]{0,220}GITHUB_REF_TYPE === 'tag'/u.test(packageHelper), 'Implicit production signing must be limited to an actual pushed tag.');
requireCondition(/mkdtemp\(join\(temporaryRoot, 'keen-notarize-'\)\)/u.test(packageHelper), 'The base64 Apple API key must be materialized only in a dedicated temporary directory.');
requireCondition(/env\.RUNNER_TEMP\?\.trim\(\) \|\| tmpdir\(\)/u.test(packageHelper), 'Apple API key material must use the runner temporary directory with an OS temporary fallback.');
requireCondition(/isInside\(workspaceRoot, temporaryRoot\)/u.test(packageHelper), 'The packaging helper must reject Apple key material inside the source checkout.');
requireCondition(/writeFile\(apiKeyPath, decodedApiKey, \{ encoding: 'utf8', mode: 0o600 \}\)/u.test(packageHelper), 'The temporary Apple API key file must be written with mode 0600.');
requireCondition(/env\.APPLE_API_KEY = apiKeyPath/u.test(packageHelper), 'electron-builder must receive an absolute temporary .p8 path through APPLE_API_KEY.');
requireCondition(/finally \{[\s\S]{0,180}rm\(temporarySecretDirectory, \{ recursive: true, force: true \}\)/u.test(packageHelper), 'Temporary Apple API key material must be removed in a finally block.');
requireCondition(/BEGIN PRIVATE KEY/u.test(packageHelper), 'Base64 Apple API key material must be validated as a private key before use.');
requireCondition(/hasAll\(env, \['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_TEAM_ID'\]\)/u.test(packageHelper), 'App Store Connect notarization must require the complete electron-builder credential set.');

const expectedScripts = {
  'ci:install': 'node scripts/ci-install.mjs',
  'ci:package': 'node scripts/package-ci.mjs',
  'validate:release-workflow': 'node scripts/validate-release-workflow.mjs',
  'release:verify-tag': 'node scripts/verify-release-tag.mjs',
  'release:collect': 'node scripts/collect-release-artifacts.mjs',
  'release:prepare': 'node scripts/prepare-ci-release.mjs',
  'test:release': 'node tests/release/release-pipeline.test.mjs'
};
for (const [name, command] of Object.entries(expectedScripts)) {
  requireCondition(packageJson.scripts?.[name] === command, `${name} script is missing or changed unexpectedly.`);
}
for (const path of [
  'scripts/ci-install.mjs',
  'scripts/package-ci.mjs',
  'scripts/verify-release-tag.mjs',
  'scripts/collect-release-artifacts.mjs',
  'scripts/prepare-ci-release.mjs',
  'tests/release/release-pipeline.test.mjs'
]) {
  requireCondition(existsSync(resolve(path)), `Required release helper is missing: ${path}`);
}
requireCondition(packageJson.scripts?.['test:core'] === 'tsx tests/core/self-test.ts', 'Dependency-light core test script is missing.');
requireCondition(packageJson.scripts?.lint === 'eslint .', 'ESLint must use flat-config-compatible invocation.');
requireCondition(packageJson.scripts?.['ci:verify']?.includes('validate:release-workflow'), 'ci:verify must validate the release workflow.');
requireCondition(packageJson.scripts?.['ci:verify']?.includes('test:release'), 'ci:verify must run the dependency-free release pipeline self-test.');
requireCondition(packageJson.scripts?.dist?.includes('--publish never'), 'electron-builder publishing must remain disabled in package scripts.');
requireCondition(packageJson.engines?.node === '>=22', 'package.json must declare Node.js 22 or newer.');
requireCondition(packageJson.engines?.npm === '>=10', 'package.json must declare npm 10 or newer.');

for (const dependency of ['eslint', 'typescript-eslint', '@axe-core/playwright']) {
  requireCondition(Boolean(packageJson.devDependencies?.[dependency]), `Missing CI development dependency: ${dependency}`);
}

requireCondition(packageJson.build?.directories?.output === 'release', 'electron-builder output must be release/.');
requireCondition(
  packageJson.build?.artifactName === 'Keen-Key-Console-${version}-${os}-${arch}.${ext}',
  'Artifact names must include version, operating system, and architecture.'
);
requireCondition(packageJson.build?.mac?.hardenedRuntime === false, 'Unsigned default macOS builds must keep hardened runtime disabled.');
requireCondition(packageJson.build?.mac?.notarize === false, 'Default builds must not attempt macOS notarization without explicit version-release credentials.');
requireCondition(JSON.stringify(packageJson.build?.mac?.target) === JSON.stringify(['dmg', 'zip']), 'macOS targets must be DMG and ZIP.');
requireCondition(JSON.stringify(packageJson.build?.win?.target) === JSON.stringify(['nsis', 'zip']), 'Windows targets must be NSIS and ZIP.');
requireCondition(JSON.stringify(packageJson.build?.linux?.target) === JSON.stringify(['AppImage', 'deb']), 'Linux targets must be AppImage and DEB.');
requireCondition(!macEntitlements.includes('com.apple.security.cs.allow-unsigned-executable-memory'), 'The macOS application entitlement must not allow unsigned executable memory.');
requireCondition(!macInheritedEntitlements.includes('com.apple.security.cs.allow-unsigned-executable-memory'), 'The inherited macOS entitlement must not allow unsigned executable memory.');

if (failures.length > 0) {
  console.error('Release workflow validation FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Release workflow validation PASSED (${actionUses.length} pinned action use(s), ${expectedMatrixRows.length} native package targets).`);
}
