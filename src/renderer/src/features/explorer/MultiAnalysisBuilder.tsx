import { Plus, Trash2 } from 'lucide-react';
import type { QueryDraft } from '@shared/types';
import { Button, Field, IconButton, Input, Select } from '../../components/ui';

const TYPES = ['count', 'count_unique', 'sum', 'average', 'minimum', 'maximum', 'median', 'percentile', 'select_unique', 'standard_deviation'] as const;
const TARGET_TYPES = new Set<string>(TYPES.filter((type) => type !== 'count'));

type Analysis = Record<string, unknown>;

function entries(value: QueryDraft['analyses']): Array<[string, Analysis]> {
  return Object.entries(value ?? {});
}

function uniqueName(existing: Set<string>): string {
  let index = existing.size + 1;
  while (existing.has(`analysis_${index}`)) index += 1;
  return `analysis_${index}`;
}

export function MultiAnalysisBuilder({ value, onChange }: { value: QueryDraft['analyses']; onChange(value: NonNullable<QueryDraft['analyses']>): void }): JSX.Element {
  const rows = entries(value);
  const setRows = (next: Array<[string, Analysis]>) => onChange(Object.fromEntries(next));
  return <div className="stack stack--compact">
    {rows.map(([name, analysis], index) => {
      const type = typeof analysis.analysis_type === 'string' ? analysis.analysis_type : 'count';
      return <div className="multi-analysis-row" key={`${name}-${index}`}>
        <Field label={`Result name ${index + 1}`}><Input value={name} onChange={(event) => setRows(rows.map((row, rowIndex) => rowIndex === index ? [event.target.value, row[1]] : row))} placeholder="total_sessions" /></Field>
        <Field label="Analysis"><Select value={type} onChange={(event) => {
          const nextType = event.target.value;
          const next: Analysis = { ...analysis, analysis_type: nextType };
          if (!TARGET_TYPES.has(nextType)) delete next.target_property;
          setRows(rows.map((row, rowIndex) => rowIndex === index ? [row[0], next] : row));
        }}>{TYPES.map((candidate) => <option key={candidate} value={candidate}>{candidate.replace(/_/g, ' ')}</option>)}</Select></Field>
        {TARGET_TYPES.has(type) ? <Field label="Target property"><Input list="explorer-property-options" value={String(analysis.target_property ?? '')} onChange={(event) => setRows(rows.map((row, rowIndex) => rowIndex === index ? [row[0], { ...analysis, target_property: event.target.value }] : row))} /></Field> : <div />}
        {type === 'percentile' ? <Field label="Percentile"><Input type="number" min="0" max="100" value={Number(analysis.percentile ?? 95)} onChange={(event) => setRows(rows.map((row, rowIndex) => rowIndex === index ? [row[0], { ...analysis, percentile: Number(event.target.value) }] : row))} /></Field> : <div />}
        <IconButton label={`Remove ${name || `analysis ${index + 1}`}`} onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></IconButton>
      </div>;
    })}
    <Button type="button" variant="secondary" onClick={() => setRows([...rows, [uniqueName(new Set(rows.map(([name]) => name))), { analysis_type: 'count' }]])}><Plus size={14} /> Add analysis</Button>
  </div>;
}
