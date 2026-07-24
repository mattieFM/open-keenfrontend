import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Operation } from '@shared/types';
import { useWorkspaceStore } from '../db/workspaceStore';
import { KeenClient } from './KeenClient';
import { DashboardServiceClient } from './DashboardServiceClient';
import { credentialCandidates, selectCredential } from './credentialRouter';

export function useWorkspaceContext() {
  const { workspaceId } = useParams();
  const workspace = useWorkspaceStore((state) => state.workspaces.find((item) => item.id === workspaceId));
  const runtimeMode = useWorkspaceStore((state) => workspaceId ? state.runtimeModes[workspaceId] ?? 'read-only' : 'read-only');
  const client = useMemo(() => workspace ? new KeenClient(workspace, runtimeMode) : undefined, [workspace, runtimeMode]);
  const dashboardClient = useMemo(() => workspace ? new DashboardServiceClient(workspace, runtimeMode) : undefined, [workspace, runtimeMode]);
  return { workspaceId, workspace, runtimeMode, client, dashboardClient };
}

export function useOperationCredentials(operation: Operation) {
  const { workspace } = useWorkspaceContext();
  const candidates = workspace ? credentialCandidates(workspace, operation) : [];
  return {
    candidates,
    select: (preferredId?: string) => {
      if (!workspace) throw new Error('Workspace not found.');
      return selectCredential(workspace, operation, preferredId);
    }
  };
}
