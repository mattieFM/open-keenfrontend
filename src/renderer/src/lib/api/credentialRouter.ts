import type { CredentialMeta, CredentialType, Operation, WorkspaceRecord } from '@shared/types';
import { hasCredential } from '../vault/credentialVault';

const ROUTES: Record<Operation, CredentialType[]> = {
  'schema.read': ['access', 'read', 'master'],
  'query.run': ['access', 'read', 'master'],
  'saved.result.read': ['access', 'read', 'master'],
  'saved.definition.read': ['access', 'master'],
  'saved.manage': ['master'],
  'dashboard.read': ['access', 'read', 'master'],
  'dashboard.manage': ['master'],
  'event.write': ['access', 'write', 'master'],
  'accessKey.manage': ['master'],
  'maintenance': ['master'],
  'dataset.read': ['access', 'read', 'master'],
  'dataset.manage': ['master'],
  'organization.manage': ['organization']
};

export function credentialCandidates(workspace: WorkspaceRecord, operation: Operation): CredentialMeta[] {
  const order = ROUTES[operation];
  return workspace.credentials
    .filter((credential) => order.includes(credential.type))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

export function selectCredential(workspace: WorkspaceRecord, operation: Operation, preferredId?: string): CredentialMeta {
  const candidates = credentialCandidates(workspace, operation);
  const preferred = preferredId ? candidates.find((credential) => credential.id === preferredId) : undefined;
  if (preferred) return preferred;
  const unlocked = candidates.find((credential) => hasCredential(credential.id));
  if (unlocked) return unlocked;
  if (candidates[0]) return candidates[0];
  throw new Error(`No configured credential can attempt ${operation}.`);
}
