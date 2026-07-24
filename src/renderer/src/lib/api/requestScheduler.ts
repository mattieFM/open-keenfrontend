export type RequestLane = 'read' | 'query' | 'extraction';

export type SchedulerSnapshot = {
  paused: boolean;
  reason?: string;
  active: number;
  queued: number;
  lanes: Record<RequestLane, { active: number; queued: number; limit: number }>;
};

type QueueEntry = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

type LaneState = {
  limit: number;
  active: number;
  queue: QueueEntry[];
};

type WorkspaceScheduler = {
  paused: boolean;
  reason?: string;
  lanes: Record<RequestLane, LaneState>;
  listeners: Set<() => void>;
};

const schedulers = new Map<string, WorkspaceScheduler>();
const activeBridgeRequests = new Map<string, Set<string>>();

function createScheduler(queryConcurrency: number): WorkspaceScheduler {
  const bounded = Math.max(1, Math.min(10, Math.floor(queryConcurrency || 4)));
  return {
    paused: false,
    lanes: {
      read: { limit: 4, active: 0, queue: [] },
      query: { limit: bounded, active: 0, queue: [] },
      extraction: { limit: 1, active: 0, queue: [] }
    },
    listeners: new Set()
  };
}

function schedulerFor(workspaceId: string, queryConcurrency = 4): WorkspaceScheduler {
  let scheduler = schedulers.get(workspaceId);
  if (!scheduler) {
    scheduler = createScheduler(queryConcurrency);
    schedulers.set(workspaceId, scheduler);
  } else {
    scheduler.lanes.query.limit = Math.max(1, Math.min(10, Math.floor(queryConcurrency || 4)));
  }
  return scheduler;
}

function notify(scheduler: WorkspaceScheduler): void {
  scheduler.listeners.forEach((listener) => listener());
}

function pump(workspaceId: string, laneName: RequestLane): void {
  const scheduler = schedulers.get(workspaceId);
  if (!scheduler || scheduler.paused) return;
  const lane = scheduler.lanes[laneName];
  while (!scheduler.paused && lane.active < lane.limit && lane.queue.length) {
    const entry = lane.queue.shift();
    if (!entry) break;
    if (entry.signal?.aborted) {
      entry.reject(new DOMException('The request was cancelled before execution.', 'AbortError'));
      continue;
    }
    if (entry.abort && entry.signal) entry.signal.removeEventListener('abort', entry.abort);
    lane.active += 1;
    notify(scheduler);
    void entry.run().then(entry.resolve, entry.reject).finally(() => {
      lane.active = Math.max(0, lane.active - 1);
      notify(scheduler);
      pump(workspaceId, laneName);
    });
  }
  notify(scheduler);
}

export function scheduleWorkspaceRead<T>(
  workspaceId: string,
  laneName: RequestLane,
  queryConcurrency: number,
  run: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const scheduler = schedulerFor(workspaceId, queryConcurrency);
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The request was cancelled before execution.', 'AbortError'));
      return;
    }
    const entry: QueueEntry = {
      run,
      resolve: (value) => resolve(value as T),
      reject,
      signal
    };
    if (signal) {
      entry.abort = () => {
        const lane = scheduler.lanes[laneName];
        const index = lane.queue.indexOf(entry);
        if (index >= 0) {
          lane.queue.splice(index, 1);
          reject(new DOMException('The queued request was cancelled.', 'AbortError'));
          notify(scheduler);
        }
      };
      signal.addEventListener('abort', entry.abort, { once: true });
    }
    scheduler.lanes[laneName].queue.push(entry);
    notify(scheduler);
    pump(workspaceId, laneName);
  });
}

export function pauseWorkspaceScheduler(workspaceId: string, reason = 'Keen returned HTTP 429. New reads are paused until you resume them.'): void {
  const scheduler = schedulerFor(workspaceId);
  scheduler.paused = true;
  scheduler.reason = reason;
  notify(scheduler);
}

export function resumeWorkspaceScheduler(workspaceId: string): void {
  const scheduler = schedulerFor(workspaceId);
  scheduler.paused = false;
  scheduler.reason = undefined;
  notify(scheduler);
  (Object.keys(scheduler.lanes) as RequestLane[]).forEach((lane) => pump(workspaceId, lane));
}

export function cancelWorkspaceQueue(workspaceId: string): void {
  const scheduler = schedulers.get(workspaceId);
  if (!scheduler) return;
  for (const lane of Object.values(scheduler.lanes)) {
    const queued = lane.queue.splice(0);
    queued.forEach((entry) => {
      if (entry.abort && entry.signal) entry.signal.removeEventListener('abort', entry.abort);
      entry.reject(new DOMException('The queued request was cancelled because the workspace changed or locked.', 'AbortError'));
    });
  }
  notify(scheduler);
}


export function trackWorkspaceBridgeRequest(workspaceId: string, requestId: string): () => void {
  let requests = activeBridgeRequests.get(workspaceId);
  if (!requests) {
    requests = new Set<string>();
    activeBridgeRequests.set(workspaceId, requests);
  }
  requests.add(requestId);
  return () => {
    const current = activeBridgeRequests.get(workspaceId);
    current?.delete(requestId);
    if (current?.size === 0) activeBridgeRequests.delete(workspaceId);
  };
}

export function cancelWorkspaceRequests(workspaceId: string): void {
  cancelWorkspaceQueue(workspaceId);
  const requests = activeBridgeRequests.get(workspaceId);
  if (requests && typeof window !== 'undefined' && window.keenDesktop) {
    for (const requestId of requests) window.keenDesktop.cancel(requestId);
  }
  activeBridgeRequests.delete(workspaceId);
}

export function getWorkspaceSchedulerSnapshot(workspaceId: string): SchedulerSnapshot {
  const scheduler = schedulerFor(workspaceId);
  const lanes = Object.fromEntries((Object.keys(scheduler.lanes) as RequestLane[]).map((name) => {
    const lane = scheduler.lanes[name];
    return [name, { active: lane.active, queued: lane.queue.length, limit: lane.limit }];
  })) as SchedulerSnapshot['lanes'];
  return {
    paused: scheduler.paused,
    reason: scheduler.reason,
    active: Object.values(lanes).reduce((sum, lane) => sum + lane.active, 0),
    queued: Object.values(lanes).reduce((sum, lane) => sum + lane.queued, 0),
    lanes
  };
}

export function subscribeWorkspaceScheduler(workspaceId: string, listener: () => void): () => void {
  const scheduler = schedulerFor(workspaceId);
  scheduler.listeners.add(listener);
  return () => {
    scheduler.listeners.delete(listener);
  };
}
