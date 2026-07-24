import { useMemo, useRef, useState } from 'react';
import { Download, Mail, Play, Square } from 'lucide-react';
import type { KeenFilter, KeenResponse, QueryDraft } from '@shared/types';
import { Badge, Button, Callout, Card, CredentialSelect, EmptyState, ErrorPanel, Field, Input, PageHeader, Select, Textarea } from '../../components/ui';
import { useOperationCredentials, useWorkspaceContext } from '../../lib/api/useWorkspace';
import { semanticResultToRows, toCsv } from '../../lib/query/csv';
import { normalizeResult } from '../../lib/query/normalizer';

type Mode = 'synchronous' | 'email';

export function ExtractionsPage(): JSX.Element {
  const { workspace, client } = useWorkspaceContext();
  const credentials = useOperationCredentials('query.run').candidates;
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '');
  const [mode, setMode] = useState<Mode>('synchronous');
  const [collection, setCollection] = useState('purchases');
  const [timeframe, setTimeframe] = useState('this_14_days');
  const [timezone, setTimezone] = useState('UTC');
  const [filtersJson, setFiltersJson] = useState('[]');
  const [properties, setProperties] = useState('keen.timestamp');
  const [latest, setLatest] = useState('100');
  const [contentType, setContentType] = useState('application/json');
  const [gzip, setGzip] = useState(false);
  const [email, setEmail] = useState('');
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [response, setResponse] = useState<KeenResponse<Record<string, unknown>>>();
  const [error, setError] = useState<unknown>();
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController>();
  const credential = credentials.find((item) => item.id === credentialId);

  const parsed = useMemo(() => {
    try { const filters = JSON.parse(filtersJson) as KeenFilter[]; if (!Array.isArray(filters)) throw new Error('Filters must be an array.'); return { filters }; } catch (caught) { return { error: caught instanceof Error ? caught.message : 'Invalid filters JSON.' }; }
  }, [filtersJson]);
  const query: QueryDraft = { analysis_type: 'extraction', event_collection: collection, timeframe, timezone, filters: parsed.filters, latest: latest ? Number(latest) : undefined, property_names: properties.split(',').map((value) => value.trim()).filter(Boolean), include_metadata: includeMetadata, content_type: contentType, content_encoding: gzip ? 'gzip' : undefined, email: mode === 'email' ? email : undefined };
  const binary = mode === 'synchronous' && (contentType !== 'application/json' || gzip);

  const run = async () => {
    if (!client || !credential || parsed.error) return;
    const controller = new AbortController(); abortRef.current = controller; setRunning(true); setError(undefined); setResponse(undefined);
    try { setResponse(await client.runExtraction(credential, query, binary, controller.signal)); } catch (caught) { setError(caught); } finally { setRunning(false); abortRef.current = undefined; }
  };
  const download = async () => {
    if (!response) return;
    const extension = gzip ? (contentType.includes('csv') ? 'csv.gz' : 'json.gz') : contentType.includes('csv') ? 'csv' : contentType.includes('stream') || contentType.includes('ndjson') ? 'ndjson' : 'json';
    if (response.binaryBase64) await window.keenDesktop.saveBinary({ suggestedName: `${collection}-extraction.${extension}`, base64: response.binaryBase64 });
    else if (contentType.includes('csv')) await window.keenDesktop.saveText({ suggestedName: `${collection}-extraction.csv`, content: toCsv(normalizeResult(response.data, query)) });
    else await window.keenDesktop.saveText({ suggestedName: `${collection}-extraction.json`, content: response.rawText || JSON.stringify(response.data, null, 2) });
  };

  if (!workspace) return <EmptyState title="Workspace not found" description="Open a workspace before extracting data." />;
  const rows = response && !response.binaryBase64 ? semanticResultToRows(normalizeResult(response.data, query)) : [];
  return <><PageHeader eyebrow="Extractions" title="Extract project data" description="Run a bounded synchronous extraction or ask Keen to email an asynchronous file link. No polling endpoint is invented." actions={running ? <Button variant="danger" onClick={() => abortRef.current?.abort()}><Square size={14} /> Cancel</Button> : <Button onClick={run} disabled={!credential || Boolean(parsed.error) || !collection || (mode === 'email' && !email)}><Play size={15} /> {mode === 'email' ? 'Request email extraction' : 'Run extraction'}</Button>} />
    <div className="split-layout"><Card><div className="card__header"><div><h2>Extraction definition</h2><p>The synchronous path can scan up to 1,000,000 events and return up to 100,000 records.</p></div><div className="segmented"><button className={mode === 'synchronous' ? 'active' : ''} onClick={() => setMode('synchronous')}>Synchronous</button><button className={mode === 'email' ? 'active' : ''} onClick={() => setMode('email')}>Email / async</button></div></div><div className="card__body stack"><CredentialSelect credentials={credentials} value={credentialId} onChange={setCredentialId} /><div className="form-grid"><Field label="Event collection" required><Input value={collection} onChange={(event) => setCollection(event.target.value)} /></Field><Field label="Relative timeframe" required><Input value={timeframe} onChange={(event) => setTimeframe(event.target.value)} /></Field><Field label="Timezone"><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></Field><Field label="Latest"><Input type="number" min="1" value={latest} onChange={(event) => setLatest(event.target.value)} /></Field></div><Field label="Filters JSON" error={parsed.error}><Textarea className="textarea--code" value={filtersJson} onChange={(event) => setFiltersJson(event.target.value)} /></Field><Field label="Property names" hint="Comma-separated. Blank means all properties and can produce a large file."><Input value={properties} onChange={(event) => setProperties(event.target.value)} /></Field><div className="form-grid"><Field label="Content type"><Select value={contentType} onChange={(event) => setContentType(event.target.value)}><option value="application/json">JSON</option><option value="text/csv">CSV</option><option value="application/x-ndjson">Line-oriented JSON</option><option value="application/json-stream">JSON stream</option></Select></Field><label className="checkbox-row" style={{ alignSelf: 'end', minHeight: 39 }}><input type="checkbox" checked={gzip} onChange={(event) => setGzip(event.target.checked)} /><span>gzip encoding</span></label></div><label className="checkbox-row"><input type="checkbox" checked={includeMetadata} onChange={(event) => setIncludeMetadata(event.target.checked)} /><span>Include metadata when supported</span></label>{mode === 'email' ? <><Field label="Recipient email" required hint="This address is sent to Keen. The documented link validity is 30 days."><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Callout tone="warning" title="Asynchronous delivery">The file can contain up to 10,000,000 events and 2 GB. Submission is never automatically retried because duplicate emails/jobs may result.</Callout></> : properties.split(',').filter(Boolean).length > 100 ? <Callout tone="warning">You selected more than 100 columns. Review breadth before extracting potentially sensitive event data.</Callout> : null}{error ? <ErrorPanel error={error} /> : null}</div><div className="card__footer form-actions">{running ? <Button variant="danger" onClick={() => abortRef.current?.abort()}><Square size={14} /> Cancel</Button> : <Button loading={running} onClick={run} disabled={!credential || Boolean(parsed.error) || (mode === 'email' && !email)}>{mode === 'email' ? <Mail size={15} /> : <Play size={15} />} {mode === 'email' ? 'Send extraction request' : 'Extract now'}</Button>}</div></Card>
      <div className="sticky-panel stack"><Card><div className="card__header"><div><h2>Result / delivery</h2><p>Raw event bodies are kept in memory only until you navigate away or lock the workspace.</p></div>{response ? <Badge tone="success">HTTP {response.status}</Badge> : null}</div><div className="card__body stack">{!response ? <EmptyState title="No extraction requested" description="Build the exact scope and submit it explicitly." /> : mode === 'email' ? <><Callout tone="success" title="Keen accepted the email extraction request">Check the response below for the service acknowledgement. The app does not claim or poll a job status endpoint.</Callout><pre className="json-view">{response.rawText || JSON.stringify(response.data, null, 2)}</pre></> : <><Callout tone="success" title="Extraction returned">{response.binaryBase64 ? 'A binary response is ready to save.' : `${rows.length.toLocaleString()} in-memory row(s) normalized for preview.`}</Callout><Button onClick={download}><Download size={15} /> Save extraction</Button>{response.binaryBase64 ? null : <div className="table-wrap" style={{ maxHeight: 410 }}><table><thead><tr>{[...new Set(rows.flatMap((row) => Object.keys(row)))].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}>{[...new Set(rows.flatMap((item) => Object.keys(item)))].map((header) => <td key={header}>{typeof row[header] === 'object' ? JSON.stringify(row[header]) : String(row[header] ?? '')}</td>)}</tr>)}</tbody></table></div>}</>}</div></Card></div>
    </div>
  </>;
}
