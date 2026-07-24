import Dexie, { type EntityTable } from 'dexie';
import type {
  DashboardDocument,
  EncryptedSecretRecord,
  KnownSavedQueryRecord,
  MaintenanceAuditRecord,
  QueryDraftRecord,
  WorkspaceRecord
} from '@shared/types';

class KeenConsoleDatabase extends Dexie {
  workspaces!: EntityTable<WorkspaceRecord, 'id'>;
  secrets!: EntityTable<EncryptedSecretRecord, 'id'>;
  queryDrafts!: EntityTable<QueryDraftRecord, 'id'>;
  knownSavedQueries!: EntityTable<KnownSavedQueryRecord, 'id'>;
  dashboards!: EntityTable<DashboardDocument, 'id'>;
  audits!: EntityTable<MaintenanceAuditRecord, 'id'>;

  constructor() {
    super('keen-key-console');
    this.version(1).stores({
      workspaces: 'id, updatedAt, projectId',
      secrets: 'id, workspaceId',
      queryDrafts: 'id, workspaceId, updatedAt',
      knownSavedQueries: 'id, workspaceId, lastOpenedAt',
      dashboards: 'id, workspaceId, updatedAt',
      audits: 'id, workspaceId, createdAt'
    });
  }
}

export const db = new KeenConsoleDatabase();
