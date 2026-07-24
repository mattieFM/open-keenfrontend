import { useMemo } from 'react';
import { Braces, CornerDownRight, Plus, Trash2 } from 'lucide-react';
import type { KeenFilter, NormalFilter, OrFilter } from '@shared/types';
import { Button, Callout, IconButton, Input, Select } from '../../components/ui';

const OPERATORS = [
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'exists', 'in',
  'contains', 'not_contains', 'regex', 'within'
] as const;

function isOr(filter: KeenFilter): filter is OrFilter {
  return filter.operator === 'or' && 'operands' in filter;
}

function defaultFilter(): NormalFilter {
  return { property_name: '', operator: 'eq', property_value: '' };
}

function parseValue(operator: string, text: string, current: unknown): unknown {
  if (operator === 'exists') return text === 'true';
  if (operator === 'in') return text.split(',').map((value) => value.trim()).filter(Boolean);
  if (operator === 'within') {
    try { return JSON.parse(text); } catch { return current; }
  }
  if (typeof current === 'number') {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : text;
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text.trim())) return Number(text);
  return text;
}

function valueText(filter: NormalFilter): string {
  const value = filter.property_value;
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value === undefined ? '' : String(value);
}

function FilterRow({ filter, onChange, onRemove, depth }: { filter: NormalFilter; onChange(filter: NormalFilter): void; onRemove(): void; depth: number }): JSX.Element {
  const operator = String(filter.operator ?? 'eq');
  const needsStructured = operator === 'within';
  return (
    <div className="filter-row" style={{ marginLeft: depth * 12 }}>
      <Input list="explorer-property-options" aria-label="Filter property" placeholder="customer.id" value={String(filter.property_name ?? '')} onChange={(event) => onChange({ ...filter, property_name: event.target.value })} />
      <Select aria-label="Filter operator" value={operator} onChange={(event) => {
        const nextOperator = event.target.value;
        const next: NormalFilter = { ...filter, operator: nextOperator };
        if (nextOperator === 'exists') next.property_value = true;
        else if (nextOperator === 'in') next.property_value = Array.isArray(filter.property_value) ? filter.property_value : [];
        else if (nextOperator === 'within') next.property_value = typeof filter.property_value === 'object' ? filter.property_value : { coordinates: [0, 0], max_distance_miles: 10 };
        onChange(next);
      }}>
        {OPERATORS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
      </Select>
      {operator === 'exists' ? (
        <Select aria-label="Exists value" value={String(Boolean(filter.property_value))} onChange={(event) => onChange({ ...filter, property_value: event.target.value === 'true' })}>
          <option value="true">exists</option><option value="false">does not exist</option>
        </Select>
      ) : (
        <Input aria-label="Filter value" className={needsStructured ? 'mono' : ''} placeholder={operator === 'in' ? 'CA, US' : needsStructured ? '{"coordinates":[-79,43],"max_distance_miles":10}' : 'value'} value={valueText(filter)} onChange={(event) => onChange({ ...filter, property_value: parseValue(operator, event.target.value, filter.property_value) })} />
      )}
      <IconButton label="Remove filter" onClick={onRemove}><Trash2 size={15} /></IconButton>
    </div>
  );
}

function FilterNode({ filter, onChange, onRemove, depth }: { filter: KeenFilter; onChange(filter: KeenFilter): void; onRemove(): void; depth: number }): JSX.Element {
  if (!isOr(filter)) return <FilterRow filter={filter} onChange={onChange} onRemove={onRemove} depth={depth} />;
  return (
    <div className="or-group" style={{ marginLeft: depth * 12 }}>
      <div className="row row--between"><strong className="small inline-icon"><CornerDownRight size={14} /> OR group</strong><IconButton label="Remove OR group" onClick={onRemove}><Trash2 size={15} /></IconButton></div>
      <div className="stack stack--compact">
        {filter.operands.map((operand, index) => <FilterNode key={index} filter={operand} depth={depth + 1} onChange={(next) => onChange({ ...filter, operands: filter.operands.map((item, itemIndex) => itemIndex === index ? next : item) })} onRemove={() => onChange({ ...filter, operands: filter.operands.filter((_, itemIndex) => itemIndex !== index) })} />)}
        <div className="row"><Button variant="ghost" onClick={() => onChange({ ...filter, operands: [...filter.operands, defaultFilter()] })}><Plus size={14} /> OR operand</Button><Button variant="ghost" onClick={() => onChange({ ...filter, operands: [...filter.operands, { operator: 'or', operands: [defaultFilter(), defaultFilter()] }] })}><Braces size={14} /> Nested OR</Button></div>
      </div>
    </div>
  );
}

function containsOperator(filters: KeenFilter[], operator: string): boolean {
  return filters.some((filter) => isOr(filter) ? containsOperator(filter.operands, operator) : filter.operator === operator);
}

export function FilterBuilder({ filters, onChange }: { filters: KeenFilter[]; onChange(filters: KeenFilter[]): void }): JSX.Element {
  const hasGeo = useMemo(() => containsOperator(filters, 'within'), [filters]);
  return (
    <div className="stack stack--compact">
      {filters.length ? filters.map((filter, index) => <FilterNode key={index} filter={filter} depth={0} onChange={(next) => onChange(filters.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => onChange(filters.filter((_, itemIndex) => itemIndex !== index))} />) : <div className="empty-inline">No filters. Root entries are combined with AND.</div>}
      <div className="row"><Button variant="secondary" onClick={() => onChange([...filters, defaultFilter()])}><Plus size={14} /> Add AND filter</Button><Button variant="secondary" onClick={() => onChange([...filters, { operator: 'or', operands: [defaultFilter(), defaultFilter()] }])}><Braces size={14} /> Add OR group</Button></div>
      {hasGeo ? <Callout tone="warning">Geographic <code>within</code> filters cannot be combined with <code>group_by</code>.</Callout> : null}
    </div>
  );
}
