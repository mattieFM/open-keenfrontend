import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasAll(env, names) {
  return names.every((name) => typeof env[name] === 'string' && env[name].trim().length > 0);
}

function remove(env, names) {
  for (const name of names) delete env[name];
}

function isInside(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

const platform = option('--platform');
const arch = option('--arch');
const supportedPlatforms = new Set(['linux', 'win', 'mac']);
const supportedArchitectures = new Set(['x64', 'arm64']);

if (!supportedPlatforms.has(platform)) throw new Error('--platform must be linux, win, or mac.');
if (!supportedArchitectures.has(arch)) throw new Error('--arch must be x64 or arm64.');
if (platform !== 'mac' && arch !== 'x64') throw new Error(`${platform} packages are currently defined only for x64.`);

const nativePlatform = { linux: 'linux', win: 'win32', mac: 'darwin' }[platform];
if (process.platform !== nativePlatform) {
  throw new Error(`Refusing to package ${platform}/${arch} on ${process.platform}; use the matching native operating system.`);
}
if (process.arch !== arch) {
  throw new Error(`Refusing to label a ${process.arch} Node process as ${arch}; use a native ${arch} runner.`);
}

const explicitVersionTagBuild = process.env.KEEN_CI_VERSION_TAG;
if (explicitVersionTagBuild !== undefined && !['true', 'false'].includes(explicitVersionTagBuild)) {
  throw new Error('KEEN_CI_VERSION_TAG must be exactly true or false when supplied.');
}
const implicitVersionTagBuild =
  process.env.GITHUB_EVENT_NAME === 'push' &&
  process.env.GITHUB_REF_TYPE === 'tag' &&
  process.env.GITHUB_REF_NAME?.startsWith('v') === true;
const versionTagBuild =
  explicitVersionTagBuild === 'false'
    ? false
    : explicitVersionTagBuild === 'true'
      ? process.env.GITHUB_ACTIONS === 'true'
        ? implicitVersionTagBuild
        : true
      : implicitVersionTagBuild;
const env = { ...process.env };
const builderArgs = [`--${platform}`, `--${arch}`];
let signingStatus = 'unsigned';
let temporarySecretDirectory;

const standardSigningVariables = ['CSC_LINK', 'CSC_KEY_PASSWORD'];
const signingAliases = ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
const appleIdVariables = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD'];
const appleApiVariables = ['APPLE_API_KEY', 'APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
const appleVariables = [...appleIdVariables, ...appleApiVariables, 'APPLE_TEAM_ID'];

function forceUnsignedMacBuild() {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  builderArgs.push('--config.mac.hardenedRuntime=false', '--config.mac.notarize=false');
}

async function materializeAppleApiKey() {
  if (!env.APPLE_API_KEY_BASE64?.trim()) return;
  if (env.APPLE_API_KEY?.trim()) {
    delete env.APPLE_API_KEY_BASE64;
    return;
  }

  const encodedApiKey = env.APPLE_API_KEY_BASE64.replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encodedApiKey) || encodedApiKey.length % 4 !== 0) {
    throw new Error('APPLE_API_KEY_BASE64 must contain valid base64-encoded .p8 key data.');
  }
  const decodedApiKey = Buffer.from(encodedApiKey, 'base64').toString('utf8');
  if (!decodedApiKey.includes('-----BEGIN PRIVATE KEY-----') || !decodedApiKey.includes('-----END PRIVATE KEY-----')) {
    throw new Error('APPLE_API_KEY_BASE64 must decode to a PKCS#8 private key.');
  }

  const workspaceRoot = resolve(env.GITHUB_WORKSPACE?.trim() || process.cwd());
  const temporaryRoot = resolve(env.RUNNER_TEMP?.trim() || tmpdir());
  if (isInside(workspaceRoot, temporaryRoot)) {
    throw new Error('Refusing to write Apple notarization key material inside the source checkout. Configure RUNNER_TEMP outside GITHUB_WORKSPACE.');
  }

  temporarySecretDirectory = await mkdtemp(join(temporaryRoot, 'keen-notarize-'));
  const apiKeyPath = join(temporarySecretDirectory, 'AuthKey.p8');
  await writeFile(apiKeyPath, decodedApiKey, { encoding: 'utf8', mode: 0o600 });
  env.APPLE_API_KEY = apiKeyPath;
  delete env.APPLE_API_KEY_BASE64;
}

try {
  if (!versionTagBuild) {
    remove(env, [...standardSigningVariables, ...signingAliases, ...appleVariables]);
    if (platform === 'mac') forceUnsignedMacBuild();
    else env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    console.log('Creating an unsigned continuous, non-version-tag, or pull-request package.');
  } else if (platform === 'mac') {
    if (!env.CSC_LINK && env.MAC_CSC_LINK) env.CSC_LINK = env.MAC_CSC_LINK;
    if (!env.CSC_KEY_PASSWORD && env.MAC_CSC_KEY_PASSWORD) env.CSC_KEY_PASSWORD = env.MAC_CSC_KEY_PASSWORD;
    remove(env, signingAliases);

    const hasCertificate = Boolean(env.CSC_LINK?.trim());

    // electron-builder/@electron/notarize expects APPLE_API_KEY to be an
    // absolute path to a .p8 file. Decode the repository's base64 secret into
    // a mode-0600 directory beneath RUNNER_TEMP, outside the checkout, and
    // remove it in the finally block after packaging. A certificate is needed
    // before notarization can be attempted, so an unsigned fallback does not
    // touch otherwise unused API-key material.
    if (hasCertificate) await materializeAppleApiKey();

    const hasAppleIdNotarization = hasAll(env, [...appleIdVariables, 'APPLE_TEAM_ID']);
    const hasApiKeyNotarization = hasAll(env, ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_TEAM_ID']);

    if (!hasCertificate) {
      remove(env, [...standardSigningVariables, ...appleVariables]);
      forceUnsignedMacBuild();
      console.warn('::warning title=Unsigned macOS release::MAC_CSC_LINK is not configured; signing and notarization are disabled.');
    } else {
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
      builderArgs.push('--config.mac.hardenedRuntime=true');
      signingStatus = 'signed';

      if (hasApiKeyNotarization) {
        // Do not expose two authentication methods to the notarization helper.
        remove(env, appleIdVariables);
        builderArgs.push('--config.mac.notarize=true');
        signingStatus = 'signed-and-notarized';
        console.log('Creating a signed and notarized macOS version package with an App Store Connect API key.');
      } else if (hasAppleIdNotarization) {
        remove(env, appleApiVariables);
        builderArgs.push('--config.mac.notarize=true');
        signingStatus = 'signed-and-notarized';
        console.log('Creating a signed and notarized macOS version package with Apple ID credentials.');
      } else {
        remove(env, appleVariables);
        builderArgs.push('--config.mac.notarize=false');
        console.warn('::warning title=macOS notarization disabled::A signing certificate is configured, but no complete Apple notarization credential set is available.');
      }
    }
  } else if (platform === 'win') {
    if (!env.CSC_LINK && env.WIN_CSC_LINK) env.CSC_LINK = env.WIN_CSC_LINK;
    if (!env.CSC_KEY_PASSWORD && env.WIN_CSC_KEY_PASSWORD) env.CSC_KEY_PASSWORD = env.WIN_CSC_KEY_PASSWORD;
    remove(env, [...signingAliases, ...appleVariables]);

    if (env.CSC_LINK?.trim()) {
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'true';
      signingStatus = 'signed';
      console.log('Creating an Authenticode-signed Windows version package.');
    } else {
      remove(env, standardSigningVariables);
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
      console.warn('::warning title=Unsigned Windows release::WIN_CSC_LINK is not configured; the package will be unsigned.');
    }
  } else {
    remove(env, [...standardSigningVariables, ...signingAliases, ...appleVariables]);
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  }

  const npmCli = process.env.npm_execpath;
  const npmArgs = ['run', 'dist', '--', ...builderArgs];
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = npmCli ? [npmCli, ...npmArgs] : npmArgs;

  console.log(`Packaging ${platform}/${arch} with electron-builder --publish never.`);
  const result = spawnSync(command, commandArgs, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`electron-builder exited with status ${result.status ?? 'unknown'}.`);

  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const outputDirectory = resolve(packageJson.build?.directories?.output ?? 'release');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, 'package-signing-status.json'),
    `${JSON.stringify({ schemaVersion: 1, platform, arch, signingStatus }, null, 2)}\n`,
    'utf8'
  );
  console.log(`Package signing status: ${signingStatus}.`);
} finally {
  if (temporarySecretDirectory) {
    await rm(temporarySecretDirectory, { recursive: true, force: true });
  }
}
