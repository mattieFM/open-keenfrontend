import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Braces, FileUp, Plus, Send, Terminal } from 'lucide-react';
import type { KeenResponse } from '@shared/types';
import { Badge, Button, Callout, Card, CredentialSelect, EmptyState, ErrorPanel, Field, Input, PageHeader, ReadOnlyGate, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';

const EVENT_LIMIT = 900_000;
const BULK_LIMIT = 10_000_000;

type Mode = 'single' | 'bulk' | 'import' | 'snippets';

export function EventWriterPage(): JSX.Element {
  const { workspace, client, runtimeMode } = useWorkspaceContext();
  const credentials = useOperationCredentials('event.write').candidates;
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '');
  const [mode, setMode] = useState<Mode>('single');
  const [collection, setCollection] = useState('purchases');
  const [singleJson, setSingleJson] = useState(JSON.stringify({ amount: 42.5, customer: { id: 'customer_123' }, keen: { timestamp: new Date().toISOString() } }, null, 2));
  const [bulkJson, setBulkJson] = useState(JSON.stringify({ purchases: [{ amount: 10 }, { amount: 20 }] }, null, 2));
  const [importJson, setImportJson] = useState('');
  const [error, setError] = useState<unknown>();
  const [response, setResponse] = useState<KeenResponse<unknown>>();
  const [sending, setSending] = useState(false);
  const [failedBatch, setFailedBatch] = useState<Record<string, Array<Record<string, unknown>>>>();
  const selectedCredential = credentials.find((item) => item.id === credentialId);

  const currentText = mode === 'single' ? singleJson : mode === 'bulk' ? bulkJson : importJson;
  const bytes = useMemo(() => new TextEncoder().encode(currentText).byteLength, [currentText]);
  const validation = useMemo(() => validatePayload(mode, collection, currentText), [mode, collection, currentText]);

  const send = async () => {
    if (!client || !selectedCredential || validation.error) return;
    setSending(true); setError(undefined); setResponse(undefined); setFailedBatch(undefined);
    try {
      const parsed = JSON.parse(currentText) as Record<string, unknown>;
      if (mode === 'single') {
        const result = await client.recordEvent(selectedCredential, collection, parsed);
        setResponse(result);
      } else {
        const payload = parsed as Record<string, Array<Record<string, unknown>>>;
        const result = await client.recordEvents(selectedCredential, payload);
        setResponse(result);
        const failed = failedItemsFromResponse(payload, result.data);
        setFailedBatch(Object.keys(failed).length ? failed : undefined);
      }
    } catch (caught) { setError(caught); } finally { setSending(false); }
  };

  const retryExplicitFailures = async () => {
    if (!client || !selectedCredential || !failedBatch) return;
    setSending(true); setError(undefined); setResponse(undefined);
    const payload = failedBatch;
    setFailedBatch(undefined);
    try {
      const result = await client.recordEvents(selectedCredential, payload);
      setResponse(result);
      const failed = failedItemsFromResponse(payload, result.data);
      setFailedBatch(Object.keys(failed).length ? failed : undefined);
    } catch (caught) { setError(caught); } finally { setSending(false); }
  };

  const openImport = async () => {
    const opened = await window.keenDesktop.openText();
    if (!opened.opened || opened.content === undefined) return;
    try {
      const parsed = parseImported(opened.content, collection);
      setImportJson(JSON.stringify(parsed, null, 2)); setMode('import'); setError(undefined);
    } catch (caught) { setError(caught); }
  };

  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before recording events." />;
  return <><PageHeader eyebrow="Event writer" title="Record and validate events" description="Send single or bulk events with a Write, Master, or write-scoped Access Key. Mutations never auto-run or auto-retry." actions={<Button variant="secondary" onClick={openImport}><FileUp size={15} /> Import JSON, NDJSON, or CSV</Button>} />
    <div className="tabs" role="tablist">{(['single', 'bulk', 'import', 'snippets'] as Mode[]).map((tab) => <button key={tab} className={`tab ${mode === tab ? 'active' : ''}`} onClick={() => setMode(tab)}>{tab === 'single' ? 'Single event' : tab === 'bulk' ? 'Bulk batch' : tab === 'import' ? 'Import preview' : 'Code & Kafka'}</button>)}</div>
    <div className="split-layout split-layout--wide event-writer-layout"><Card><div className="card__header"><div><h2>{mode === 'snippets' ? 'Integration templates' : mode === 'single' ? 'Single event payload' : 'Bulk event payload'}</h2><p>Authorization uses the selected key header; no key is inserted into generated code.</p></div>{mode !== 'snippets' ? <Badge tone={validation.error ? 'danger' : 'success'}>{bytes.toLocaleString()} bytes</Badge> : null}</div><div className="card__body stack">
      <CredentialSelect credentials={credentials} value={credentialId} onChange={setCredentialId} label="Write-capable credential" />
      {mode === 'single' || mode === 'import' ? <Field label="Event collection" required><Input value={collection} onChange={(event) => setCollection(event.target.value)} placeholder="purchases" /></Field> : null}
      {mode === 'single' ? <><Field label="Event JSON" error={validation.error}><Textarea className="textarea--code event-editor" value={singleJson} onChange={(event) => setSingleJson(event.target.value)} spellCheck={false} /></Field><div className="row"><Button variant="secondary" onClick={() => { try { const data = JSON.parse(singleJson) as Record<string, unknown>; setSingleJson(JSON.stringify({ ...data, keen: { ...((data.keen as object | undefined) ?? {}), timestamp: new Date().toISOString() } }, null, 2)); } catch { /* validation already shown */ } }}><Plus size={14} /> Set keen.timestamp</Button></div></> : mode === 'bulk' || mode === 'import' ? <Field label={mode === 'bulk' ? 'Bulk JSON map' : 'Normalized import preview'} hint="Top-level keys are collection names; values are arrays of events." error={validation.error}><Textarea className="textarea--code event-editor" value={mode === 'bulk' ? bulkJson : importJson} onChange={(event) => mode === 'bulk' ? setBulkJson(event.target.value) : setImportJson(event.target.value)} spellCheck={false} /></Field> : <SnippetPanel workspace={workspace} collection={collection} />}
      {mode !== 'snippets' ? <><PayloadWarnings validation={validation} bytes={bytes} single={mode === 'single'} /><ReadOnlyGate enabled={runtimeMode === 'changes-enabled'}><Callout tone="warning">Event writes mutate the project. A network timeout can be ambiguous, so the app does not retry automatically.</Callout></ReadOnlyGate>{error ? <ErrorPanel error={error} /> : null}{response ? <ResponsePanel response={response} /> : null}{failedBatch ? <Callout tone="warning" title="Explicit failed-item retry available"><div className="row row--between"><span>{countBatchEvents(failedBatch)} item{countBatchEvents(failedBatch) === 1 ? '' : 's'} were explicitly reported as failed and mapped back to the submitted payload.</span><Button variant="secondary" loading={sending} disabled={runtimeMode !== 'changes-enabled'} onClick={retryExplicitFailures}>Retry failed items once</Button></div></Callout> : null}</> : null}
    </div>{mode !== 'snippets' ? <div className="card__footer form-actions"><Button loading={sending} disabled={runtimeMode !== 'changes-enabled' || !selectedCredential || Boolean(validation.error)} onClick={send}><Send size={15} /> Send {mode === 'single' ? 'event' : 'batch'} once</Button></div> : null}</Card>
      <Card><div className="card__header"><div><h2>Delivery contract</h2><p>Important validation behavior for developer handoff testing.</p></div></div><div className="card__body stack"><Callout tone="info" title="No generated event database ID">A successful event response confirms acceptance, but it does not return a new event database identifier.</Callout><Callout tone="warning" title="Query visibility can lag">Newly recorded events can take roughly ten seconds to become visible to analyses.</Callout><Callout tone="info" title="Inspect bulk item statuses">HTTP 200 can still contain per-event failures. Every returned collection/item status is shown below the request.</Callout><Callout tone="warning" title="Size safeguards">The UI blocks events above 900,000 bytes and bulk HTTP bodies above 10,000,000 bytes. Split batches above 5,000 events.</Callout></div></Card>
    </div>
  </>;
}

function validatePayload(mode: Mode, collection: string, text: string): { error?: string; eventCount: number; largestEventBytes: number } {
  if (mode === 'snippets') return { eventCount: 0, largestEventBytes: 0 };
  try {
    const data = JSON.parse(text) as unknown;
    if (mode === 'single') {
      if (!collection.trim()) return { error: 'Collection name is required.', eventCount: 0, largestEventBytes: 0 };
      if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'A single event must be one JSON object.', eventCount: 0, largestEventBytes: 0 };
      const size = new TextEncoder().encode(JSON.stringify(data)).byteLength;
      return { error: size > EVENT_LIMIT ? `Event exceeds ${EVENT_LIMIT.toLocaleString()} bytes.` : undefined, eventCount: 1, largestEventBytes: size };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Bulk payload must map collection names to event arrays.', eventCount: 0, largestEventBytes: 0 };
    const entries = Object.entries(data as Record<string, unknown>);
    if (!entries.length || entries.some(([, events]) => !Array.isArray(events))) return { error: 'Every bulk collection value must be an event array.', eventCount: 0, largestEventBytes: 0 };
    const events = entries.flatMap(([, value]) => value as unknown[]);
    const sizes = events.map((event) => new TextEncoder().encode(JSON.stringify(event)).byteLength);
    const largest = Math.max(0, ...sizes);
    const bodySize = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    return { error: largest > EVENT_LIMIT ? `At least one event exceeds ${EVENT_LIMIT.toLocaleString()} bytes.` : bodySize > BULK_LIMIT ? `Bulk payload exceeds ${BULK_LIMIT.toLocaleString()} bytes.` : undefined, eventCount: events.length, largestEventBytes: largest };
  } catch (caught) { return { error: caught instanceof Error ? caught.message : 'Invalid JSON.', eventCount: 0, largestEventBytes: 0 }; }
}

function parseImported(content: string, collection: string): Record<string, Array<Record<string, unknown>>> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Imported file is empty.');
  try {
    const json = JSON.parse(trimmed) as unknown;
    if (Array.isArray(json)) return { [collection]: json as Array<Record<string, unknown>> };
    if (json && typeof json === 'object') {
      const values = Object.values(json as Record<string, unknown>);
      if (values.length && values.every(Array.isArray)) return json as Record<string, Array<Record<string, unknown>>>;
      return { [collection]: [json as Record<string, unknown>] };
    }
  } catch { /* try NDJSON/CSV */ }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.every((line) => { try { JSON.parse(line); return true; } catch { return false; } })) return { [collection]: lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
  const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, dynamicTyping: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? 'CSV parse failed.');
  return { [collection]: parsed.data as Array<Record<string, unknown>> };
}

function PayloadWarnings({ validation, bytes, single }: { validation: ReturnType<typeof validatePayload>; bytes: number; single: boolean }): JSX.Element {
  return <div className="stack stack--tight">{validation.error ? <Callout tone="danger">{validation.error}</Callout> : <Callout tone="success">Payload structure is valid: {validation.eventCount.toLocaleString()} event{validation.eventCount === 1 ? '' : 's'}, largest event {validation.largestEventBytes.toLocaleString()} bytes.</Callout>}{!single && validation.eventCount > 5000 ? <Callout tone="warning">This batch contains more than 5,000 events. Split it into smaller user-approved submissions.</Callout> : null}{bytes > (single ? EVENT_LIMIT : BULK_LIMIT) * .8 ? <Callout tone="warning">Payload is above 80% of the documented byte limit.</Callout> : null}</div>;
}

function ResponsePanel({ response }: { response: KeenResponse<unknown> }): JSX.Element {
  const statuses = flattenStatuses(response.data);
  return <div className="stack"><Callout tone="success" title={`Keen returned HTTP ${response.status}`}>Request completed in {response.elapsedMs} ms. Review every item result before retrying anything.</Callout>{statuses.length ? <div className="table-wrap"><table><thead><tr><th>Collection/item</th><th>Status</th><th>Details</th></tr></thead><tbody>{statuses.map((status) => <tr key={status.path}><td>{status.path}</td><td><Badge tone={status.ok ? 'success' : 'danger'}>{status.ok ? 'accepted' : 'failed'}</Badge></td><td><code>{JSON.stringify(status.value)}</code></td></tr>)}</tbody></table></div> : <pre className="json-view">{JSON.stringify(response.data, null, 2)}</pre>}</div>;
}
function flattenStatuses(data: unknown): Array<{ path: string; ok: boolean; value: unknown }> {
  if (!data || typeof data !== 'object') return [];
  const rows: Array<{ path: string; ok: boolean; value: unknown }> = [];
  for (const [collection, value] of Object.entries(data as Record<string, unknown>)) if (Array.isArray(value)) value.forEach((item, index) => { const record = item as Record<string, unknown>; rows.push({ path: `${collection}[${index}]`, ok: record.success !== false && !record.error, value: item }); });
  return rows;
}

export function failedItemsFromResponse(payload: Record<string, Array<Record<string, unknown>>>, data: unknown): Record<string, Array<Record<string, unknown>>> {
  if (!data || typeof data !== 'object') return {};
  const failed: Record<string, Array<Record<string, unknown>>> = {};
  for (const [collection, statuses] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(statuses) || !Array.isArray(payload[collection])) continue;
    statuses.forEach((item, index) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const explicitlyFailed = record.success === false || Boolean(record.error);
      const original = payload[collection]?.[index];
      if (explicitlyFailed && original) (failed[collection] ??= []).push(original);
    });
  }
  return failed;
}

export function countBatchEvents(batch: Record<string, Array<Record<string, unknown>>>): number {
  return Object.values(batch).reduce((total, events) => total + events.length, 0);
}

function SnippetPanel({ workspace, collection }: { workspace: { projectId: string; analyticsBaseUrl: string }; collection: string }): JSX.Element {
  const eventPath = `${workspace.analyticsBaseUrl}/projects/${encodeURIComponent(workspace.projectId)}/events/${encodeURIComponent(collection)}`;
  const curl = `curl -X POST '${eventPath}' \\\n  -H 'Authorization: \${KEEN_WRITE_KEY}' \\\n  -H 'Content-Type: application/json' \\\n  --data '{"event":"value"}'`;
  const kafka = `bootstrap.servers=b1.kafka-in.keen.io:9092,b2.kafka-in.keen.io:9092,b3.kafka-in.keen.io:9092\nsecurity.protocol=SASL_SSL\nsasl.mechanism=PLAIN\nsasl.username=\${KEEN_PROJECT_ID}\nsasl.password=\${KEEN_WRITE_KEY}\ntopic=${collection}`;
  return <div className="stack"><Callout tone="info" title="Configuration generator only">Electron does not attempt browser TCP Kafka. Inbound uses a Write Key; outbound uses a Read Key and may require Keen-side enablement.</Callout><Field label="cURL event template"><Textarea className="textarea--code" readOnly value={curl} /></Field><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(curl)}><Terminal size={14} /> Copy cURL</Button><Field label="Kafka producer properties"><Textarea className="textarea--code" readOnly value={kafka} /></Field><Button variant="secondary" onClick={() => void navigator.clipboard.writeText(kafka)}><Braces size={14} /> Copy Kafka config</Button></div>;
}
