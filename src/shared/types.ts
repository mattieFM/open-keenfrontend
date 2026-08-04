export type CredentialType =
  | "read"
  | "write"
  | "master"
  | "access"
  | "organization";
export type StorageMode = "memory" | "session" | "encrypted" | "plaintext";
export type CapabilityState = "unknown" | "allowed" | "denied";
export type RuntimeMode = "read-only" | "changes-enabled";
export type ConfidenceClass =
  | "documented-api"
  | "documented-ui"
  | "source-observed"
  | "local"
  | "organization"
  | "hosted-only";

export type Operation =
  | "schema.read"
  | "query.run"
  | "saved.result.read"
  | "saved.definition.read"
  | "saved.manage"
  | "dashboard.read"
  | "dashboard.manage"
  | "event.write"
  | "accessKey.manage"
  | "maintenance"
  | "dataset.read"
  | "dataset.manage"
  | "organization.manage";

export type CredentialMeta = {
  id: string;
  workspaceId: string;
  label: string;
  type: CredentialType;
  storageMode: StorageMode;
  hint: string;
  createdAt: string;
};

export type WorkspaceRecord = {
  id: string;
  localName: string;
  projectId: string;
  analyticsBaseUrl: string;
  dashboardBaseUrl?: string;
  dashboardServiceEnabled: boolean;
  organizationId?: string;
  credentials: CredentialMeta[];
  capabilities: Partial<Record<Operation, CapabilityState>>;
  preferences: {
    defaultTimezone: string;
    queryConcurrency: number;
    includeSchemaOnStreamList: boolean;
    dashboardPersistence: "local" | "keen-service" | "hybrid";
    autoDashboards?: boolean;
    autoDashboardTimeframe?: string;
    autoDashboardEventTypeProperty?: string;
    autoDashboardLastSync?: string;
  };
  demo?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD";

export type ApiRequestPayload = {
  requestId: string;
  baseUrl: string;
  path: string;
  method: HttpMethod;
  authorization?: string;
  headers?: Record<string, string>;
  body?: string;
  responseType?: "text" | "arrayBuffer";
  timeoutMs?: number;
};

export type ApiBridgeResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  rawText?: string;
  binaryBase64?: string;
  elapsedMs: number;
};

export type ApiBridgeResult =
  | { ok: true; response: ApiBridgeResponse }
  | {
      ok: false;
      error: {
        kind: "network" | "abort" | "validation";
        message: string;
        retryable: boolean;
      };
    };

export type RedactedRequest = {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  credentialLabel?: string;
};

export type KeenApiError = {
  kind: "network" | "cors" | "abort" | "http" | "parse" | "validation";
  status?: number;
  errorCode?: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: unknown;
  redactedRequest: RedactedRequest;
};

export type KeenResponse<T = unknown> = {
  data: T;
  status: number;
  headers: Record<string, string>;
  requestId?: string;
  elapsedMs: number;
  rawText: string;
  binaryBase64?: string;
  redactedRequest: RedactedRequest;
};

export type NormalFilter = {
  property_name: string;
  operator: string;
  property_value?: unknown;
  [key: string]: unknown;
};

export type OrFilter = {
  operator: "or";
  operands: KeenFilter[];
  [key: string]: unknown;
};

export type KeenFilter = NormalFilter | OrFilter;
export type KeenTimeframe = string | { start: string; end: string };

export type FunnelStep = {
  event_collection: string;
  actor_property: string;
  timeframe?: KeenTimeframe;
  filters?: KeenFilter[];
  optional?: boolean;
  inverted?: boolean;
  [key: string]: unknown;
};

export type QueryDraft = {
  analysis_type: string;
  event_collection?: string;
  target_property?: string;
  percentile?: number;
  timeframe?: KeenTimeframe;
  timezone?: string | number;
  filters?: KeenFilter[];
  group_by?:
    | string
    | string[]
    | Record<string, unknown>
    | Array<string | Record<string, unknown>>;
  order_by?: Array<{ property_name: string; direction?: "ASC" | "DESC" }>;
  limit?: number;
  interval?: string;
  zero_fill?: boolean;
  include_metadata?: boolean;
  latest?: number;
  property_names?: string[];
  email?: string;
  content_type?: string;
  content_encoding?: string;
  steps?: FunnelStep[];
  analyses?: Record<string, Record<string, unknown>>;
  [unknownParameter: string]: unknown;
};

export type ChartType =
  | "metric"
  | "table"
  | "line"
  | "area"
  | "bar"
  | "pie"
  | "donut"
  | "funnel"
  | "gauge"
  | "heatmap"
  | "bubble"
  | "choropleth";

export type SemanticResult =
  | { kind: "scalar"; value: number | string | boolean | null }
  | { kind: "grouped"; rows: Array<Record<string, unknown>> }
  | { kind: "interval"; rows: Array<Record<string, unknown>> }
  | { kind: "records"; rows: Array<Record<string, unknown>> }
  | { kind: "unique"; values: unknown[] }
  | { kind: "funnel"; values: number[] }
  | { kind: "multi"; values: Record<string, unknown> }
  | { kind: "unknown"; value: unknown };

export type ChartWidget = {
  id: string;
  type: "chart";
  title: string;
  subtitle?: string;
  source:
    | { kind: "ad-hoc"; query: QueryDraft }
    | { kind: "saved"; name: string };
  chartType: ChartType;
  valueFormat?: "number" | "compact" | "duration-ms" | "percent";
  showTableFallback?: boolean;
  credentialId?: string;
  unknown?: Record<string, unknown>;
};

export type TextWidget = {
  id: string;
  type: "text";
  markdown: string;
};

export type ImageWidget = {
  id: string;
  type: "image";
  url: string;
  alt: string;
  decorative?: boolean;
  fit: "contain" | "cover" | "original";
  caption?: string;
};

export type FilterWidget = {
  id: string;
  type: "filter";
  title: string;
  eventCollection: string;
  propertyName: string;
  targetWidgetIds: string[];
  options: string[];
  selected: string[];
  selectionMode?: "single" | "multiple";
  allowSearch?: boolean;
  optionSource?: "manual" | "query";
};

export type DateRangeWidget = {
  id: string;
  type: "date-range";
  title: string;
  targetWidgetIds: string[];
  timeframe: KeenTimeframe;
  timezone?: string | number;
};

export type DashboardWidget =
  | ChartWidget
  | TextWidget
  | ImageWidget
  | FilterWidget
  | DateRangeWidget;

export type DashboardLayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

export type DashboardDocument = {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  title: string;
  tags: string[];
  widgets: DashboardWidget[];
  layout: DashboardLayoutItem[];
  settings: {
    gridGap: number;
    background: string;
    tileBackground: string;
    tileRadius: number;
  };
  theme: { palette: string[] };
  metadata: Record<string, unknown>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type EncryptedSecretRecord = {
  id: string;
  workspaceId: string;
  algorithm: "AES-GCM" | "none";
  kdf: "PBKDF2" | "none";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
};

export type QueryDraftRecord = {
  id: string;
  workspaceId: string;
  name: string;
  query: QueryDraft;
  chartType: ChartType;
  createdAt: string;
  updatedAt: string;
};

export type KnownSavedQueryRecord = {
  id: string;
  workspaceId: string;
  name: string;
  lastOpenedAt: string;
};

export type MaintenanceAuditRecord = {
  id: string;
  workspaceId: string;
  action: string;
  scopeHash: string;
  target: string;
  status: "submitted" | "failed";
  createdAt: string;
};

export type DesktopBridge = {
  getVersion(): Promise<string>;
  approveHosts(hosts: string[]): Promise<void>;
  request(payload: ApiRequestPayload): Promise<ApiBridgeResult>;
  cancel(requestId: string): void;
  saveText(input: {
    suggestedName: string;
    content: string;
  }): Promise<{ saved: boolean; path?: string }>;
  saveBinary(input: {
    suggestedName: string;
    base64: string;
  }): Promise<{ saved: boolean; path?: string }>;
  openText(): Promise<{ opened: boolean; path?: string; content?: string }>;
  openExternal(url: string): Promise<void>;
};
