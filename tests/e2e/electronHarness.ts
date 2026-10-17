import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function launchTestApp() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'keen-key-console-e2e-'));
  const removeProfile = () => rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  try {
    // Chromium requires this only in root-owned development containers. Ordinary
    // CI/users keep the sandbox enabled, and every test uses disposable data.
    const rootFlags = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
    const app = await electron.launch({ args: [...rootFlags, `--user-data-dir=${userDataDir}`, '.'] });
    return {
      app,
      close: async () => {
        try { await app.close(); }
        finally { await removeProfile(); }
      }
    };
  } catch (error) {
    await removeProfile();
    throw error;
  }
}
