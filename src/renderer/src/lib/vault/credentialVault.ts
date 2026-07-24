import type { CredentialMeta, EncryptedSecretRecord, StorageMode } from '@shared/types';
import { db } from '../db/database';

const memorySecrets = new Map<string, string>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_ITERATIONS = 310_000;

type CryptoBytes = Uint8Array<ArrayBuffer>;

function toBase64(bytes: CryptoBytes): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): CryptoBytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(passphrase: string, salt: CryptoBytes, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function storeCredential(meta: CredentialMeta, value: string, mode: StorageMode, passphrase?: string): Promise<void> {
  if (!value.trim()) throw new Error('Credential value is required.');
  memorySecrets.set(meta.id, value.trim());
  if (mode !== 'encrypted') {
    await db.secrets.delete(meta.id);
    return;
  }
  if (!passphrase || passphrase.length < 10) throw new Error('Encrypted storage requires a passphrase of at least 10 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, DEFAULT_ITERATIONS);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value.trim())));
  const record: EncryptedSecretRecord = {
    id: meta.id,
    workspaceId: meta.workspaceId,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2',
    iterations: DEFAULT_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    createdAt: new Date().toISOString()
  };
  await db.secrets.put(record);
}

export async function unlockCredential(id: string, passphrase: string): Promise<void> {
  const record = await db.secrets.get(id);
  if (!record) throw new Error('No encrypted credential is stored for this key.');
  try {
    const key = await deriveKey(passphrase, fromBase64(record.salt), record.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(record.iv) },
      key,
      fromBase64(record.ciphertext)
    );
    memorySecrets.set(id, decoder.decode(plaintext));
  } catch {
    throw new Error('The passphrase is incorrect or the encrypted credential is damaged.');
  }
}

export function putMemoryCredential(id: string, value: string): void {
  memorySecrets.set(id, value.trim());
}

export function getCredential(id: string): string | undefined {
  return memorySecrets.get(id);
}

export function hasCredential(id: string): boolean {
  return memorySecrets.has(id);
}

export function lockWorkspace(workspaceId: string, credentials: CredentialMeta[]): void {
  for (const credential of credentials) {
    if (credential.workspaceId === workspaceId) memorySecrets.delete(credential.id);
  }
}

export function clearAllCredentials(): void {
  memorySecrets.clear();
}

export async function deleteCredential(id: string): Promise<void> {
  memorySecrets.delete(id);
  await db.secrets.delete(id);
}
