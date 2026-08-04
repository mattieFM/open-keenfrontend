import { create } from "zustand";
import type {
  CapabilityState,
  Operation,
  RuntimeMode,
  WorkspaceRecord,
} from "@shared/types";
import { db } from "./database";
import { restorePlaintextCredentials } from "../vault/credentialVault";

export type WorkspaceState = {
  initialized: boolean;
  workspaces: WorkspaceRecord[];
  activeWorkspaceId?: string;
  runtimeModes: Record<string, RuntimeMode>;
  load(): Promise<void>;
  createWorkspace(record: WorkspaceRecord): Promise<void>;
  updateWorkspace(id: string, patch: Partial<WorkspaceRecord>): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  setActive(id?: string): void;
  setRuntimeMode(id: string, mode: RuntimeMode): void;
  setCapability(
    id: string,
    operation: Operation,
    state: CapabilityState,
  ): Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  initialized: false,
  workspaces: [],
  runtimeModes: {},

  async load() {
    const workspaces = await db.workspaces
      .orderBy("updatedAt")
      .reverse()
      .toArray();
    const runtimeModes = Object.fromEntries(
      workspaces.map((workspace) => [workspace.id, "read-only" as const]),
    );
    await restorePlaintextCredentials();
    set({
      initialized: true,
      workspaces,
      runtimeModes,
      activeWorkspaceId:
        get().activeWorkspaceId &&
        workspaces.some((item) => item.id === get().activeWorkspaceId)
          ? get().activeWorkspaceId
          : workspaces[0]?.id,
    });
  },

  async createWorkspace(record) {
    await db.workspaces.put(record);
    set((state) => ({
      workspaces: [
        record,
        ...state.workspaces.filter((item) => item.id !== record.id),
      ],
      activeWorkspaceId: record.id,
      runtimeModes: { ...state.runtimeModes, [record.id]: "read-only" },
    }));
  },

  async updateWorkspace(id, patch) {
    const current = get().workspaces.find((item) => item.id === id);
    if (!current) throw new Error("Workspace not found.");
    const updated: WorkspaceRecord = {
      ...current,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    await db.workspaces.put(updated);
    set((state) => ({
      workspaces: state.workspaces.map((item) =>
        item.id === id ? updated : item,
      ),
    }));
  },

  async deleteWorkspace(id) {
    await db.transaction(
      "rw",
      [
        db.workspaces,
        db.secrets,
        db.queryDrafts,
        db.knownSavedQueries,
        db.dashboards,
        db.audits,
      ],
      async () => {
        await db.workspaces.delete(id);
        await db.secrets.where("workspaceId").equals(id).delete();
        await db.queryDrafts.where("workspaceId").equals(id).delete();
        await db.knownSavedQueries.where("workspaceId").equals(id).delete();
        await db.dashboards.where("workspaceId").equals(id).delete();
        await db.audits.where("workspaceId").equals(id).delete();
      },
    );
    set((state) => {
      const workspaces = state.workspaces.filter((item) => item.id !== id);
      const runtimeModes = { ...state.runtimeModes };
      delete runtimeModes[id];
      return {
        workspaces,
        runtimeModes,
        activeWorkspaceId:
          state.activeWorkspaceId === id
            ? workspaces[0]?.id
            : state.activeWorkspaceId,
      };
    });
  },

  setActive(id) {
    set({ activeWorkspaceId: id });
  },

  setRuntimeMode(id, mode) {
    set((state) => ({ runtimeModes: { ...state.runtimeModes, [id]: mode } }));
  },

  async setCapability(id, operation, capabilityState) {
    const current = get().workspaces.find((item) => item.id === id);
    if (!current) return;
    const updated: WorkspaceRecord = {
      ...current,
      capabilities: { ...current.capabilities, [operation]: capabilityState },
      updatedAt: new Date().toISOString(),
    };
    await db.workspaces.put(updated);
    set((state) => ({
      workspaces: state.workspaces.map((item) =>
        item.id === id ? updated : item,
      ),
    }));
  },
}));

export function getWorkspace(id?: string): WorkspaceRecord | undefined {
  return useWorkspaceStore
    .getState()
    .workspaces.find((workspace) => workspace.id === id);
}
