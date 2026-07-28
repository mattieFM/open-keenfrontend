import type { KeenFilter } from '@shared/types';

export type EventRecord = Record<string, unknown>;

export type BackfillMode = 'server-upsert' | 'rebuild';
export type TimestampStrategy = 'preserve' | 'fixed' | 'copy';
export type TransformationOperation = 'set' | 'remove';
export type ValueSource = 'literal' | 'copy' | 'project-id' | 'uuid' | 'template';
export type MissingSourceBehavior = 'error' | 'skip' | 'null';

export type AbsoluteSelection = {
  projectId: string;
  collection: string;
  timeframe: { start: string; end: string };
  filters: KeenFilter[];
};

export type FieldTransformation = {
  id: string;
  operation: TransformationOperation;
  targetPath: string;
  source: ValueSource;
  value: string;
  onlyIfMissing: boolean;
  missingSource: MissingSourceBehavior;
};

export type TimestampPlan = {
  strategy: TimestampStrategy;
  value: string;
};

export type BackfillPlan = {
  mode: BackfillMode;
  selection: AbsoluteSelection;
  transformations: FieldTransformation[];
  timestamp: TimestampPlan;
};

export type TransformationStats = {
  changedEvents: number;
  skippedAssignments: number;
  removedFields: number;
  writtenFields: number;
};

export type BackfillBackup = {
  kind: 'keen-backfill-backup';
  schemaVersion: 1;
  createdAt: string;
  projectId: string;
  collection: string;
  selection: AbsoluteSelection;
  plan: BackfillPlan;
  eventCount: number;
  events: EventRecord[];
  backupHash?: string;
};

export type PreparedBackfill = {
  plan: BackfillPlan;
  scopeHash: string;
  backupHash: string;
  backupPath: string;
  count: number;
  originalEvents: EventRecord[];
  replacementEvents: EventRecord[];
  stats: TransformationStats;
  preparedAt: string;
};

export type BackfillProgress = {
  stage: 'deleting' | 'updating' | 'recreating' | 'restoring' | 'complete';
  completed: number;
  total: number;
  message: string;
};

export type BackfillExecutionResult = {
  mode: BackfillMode | 'restore';
  affectedEvents: number;
  response?: unknown;
  batches?: number;
};
