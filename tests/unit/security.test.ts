import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/database';
import { clearAllCredentials, getCredential, storeCredential, unlockCredential } from '@/lib/vault/credentialVault';
import type { CredentialMeta } from '@shared/types';
import { canonicalJson, sha256 } from '@/lib/maintenance/scope';

describe('credential vault and immutable scope hashing', () => {
  beforeEach(async () => { clearAllCredentials(); await db.delete(); await db.open(); });

  it('stores only AES-GCM ciphertext and unlocks with the passphrase', async () => {
    const meta: CredentialMeta = { id: 'credential', workspaceId: 'workspace', label: 'Read', type: 'read', storageMode: 'encrypted', hint: 'hint', createdAt: new Date(0).toISOString() };
    await storeCredential(meta, 'a-very-secret-read-key', 'encrypted', 'correct horse battery staple');
    const record = await db.secrets.get(meta.id);
    expect(record?.algorithm).toBe('AES-GCM');
    expect(JSON.stringify(record)).not.toContain('a-very-secret-read-key');
    clearAllCredentials();
    await expect(unlockCredential(meta.id, 'wrong passphrase')).rejects.toThrow(/incorrect/);
    await unlockCredential(meta.id, 'correct horse battery staple');
    expect(getCredential(meta.id)).toBe('a-very-secret-read-key');
  });

  it('produces stable canonical hashes independent of object key order', async () => {
    expect(canonicalJson({ b: 2, a: [1, { z: true, y: 'x' }] })).toBe('{"a":[1,{"y":"x","z":true}],"b":2}');
    await expect(sha256({ a: 1, b: 2 })).resolves.toBe(await sha256({ b: 2, a: 1 }));
  });
});
