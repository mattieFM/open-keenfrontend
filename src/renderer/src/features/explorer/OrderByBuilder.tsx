import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { QueryDraft } from '@shared/types';
import { Button, IconButton, Input, Select } from '../../components/ui';

type Clause = NonNullable<QueryDraft['order_by']>[number];

export function OrderByBuilder({ value, onChange }: { value: Clause[]; onChange(value: Clause[] | undefined): void }): JSX.Element {
  const set = (next: Clause[]) => onChange(next.length ? next : undefined);
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= value.length) return; const next = [...value]; [next[index], next[target]] = [next[target], next[index]]; set(next); };
  return <div className="stack stack--compact">{value.map((clause, index) => <div className="order-row" key={index}><Input list="explorer-property-options" aria-label={`Order property ${index + 1}`} value={clause.property_name} onChange={(event) => set(value.map((item, itemIndex) => itemIndex === index ? { ...item, property_name: event.target.value } : item))} placeholder="result" /><Select aria-label={`Order direction ${index + 1}`} value={clause.direction ?? 'ASC'} onChange={(event) => set(value.map((item, itemIndex) => itemIndex === index ? { ...item, direction: event.target.value as 'ASC' | 'DESC' } : item))}><option value="ASC">Ascending</option><option value="DESC">Descending</option></Select><IconButton label="Move clause up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></IconButton><IconButton label="Move clause down" disabled={index === value.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></IconButton><IconButton label="Remove order clause" onClick={() => set(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></IconButton></div>)}<Button variant="secondary" onClick={() => set([...value, { property_name: 'result', direction: 'ASC' }])}><Plus size={14} /> Add order clause</Button></div>;
}
