import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import type { FunnelStep, KeenFilter } from '@shared/types';
import { Button, Callout, Field, IconButton, Input, Textarea } from '../../components/ui';

function blankStep(): FunnelStep {
  return { event_collection: '', actor_property: '' };
}

function StepFilters({ value, onChange }: { value: KeenFilter[]; onChange(value: KeenFilter[]): void }): JSX.Element {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  return <Field label="Step filters (JSON)" error={error || undefined}><Textarea className="textarea--code textarea--compact" value={text} onChange={(event) => {
    const nextText = event.target.value; setText(nextText);
    try { const parsed = JSON.parse(nextText) as KeenFilter[]; if (!Array.isArray(parsed)) throw new Error('Filters must be an array.'); onChange(parsed); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Invalid JSON.'); }
  }} /></Field>;
}

export function FunnelBuilder({ steps, onChange }: { steps: FunnelStep[]; onChange(steps: FunnelStep[]): void }): JSX.Element {
  const update = (index: number, next: FunnelStep) => onChange(steps.map((step, itemIndex) => itemIndex === index ? next : step));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps]; [next[index], next[target]] = [next[target], next[index]];
    if (next[0]) next[0] = { ...next[0], optional: false, inverted: false };
    onChange(next);
  };
  return (
    <div className="stack">
      <Callout tone="info" title="Actor matching">Use a stable actor property across steps. Keen’s current documentation is inconsistent: the general limits table states 1,000,000 unique actors while the funnel section states 2,000,000. This console warns conservatively at 1,000,000 and treats the server response as authoritative.</Callout>
      {steps.map((step, index) => <section className="funnel-step" key={`${index}-${step.event_collection}`}>
        <div className="row row--between"><strong>Step {index + 1}</strong><div className="row"><IconButton label="Move step up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></IconButton><IconButton label="Move step down" disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></IconButton><IconButton label="Duplicate step" onClick={() => onChange([...steps.slice(0, index + 1), { ...step, filters: step.filters ? structuredClone(step.filters) : undefined }, ...steps.slice(index + 1)])}><Copy size={15} /></IconButton><IconButton label="Delete step" disabled={steps.length <= 2} onClick={() => onChange(steps.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></IconButton></div></div>
        <div className="form-grid"><Field label="Event collection" required><Input list="explorer-collection-options" value={step.event_collection} onChange={(event) => update(index, { ...step, event_collection: event.target.value })} placeholder="purchases" /></Field><Field label="Actor property" required><Input list="explorer-property-options" value={step.actor_property} onChange={(event) => update(index, { ...step, actor_property: event.target.value })} placeholder="user.id" /></Field></div>
        <Field label="Step timeframe override" hint="Leave blank to inherit the funnel timeframe."><Input value={typeof step.timeframe === 'string' ? step.timeframe : step.timeframe ? JSON.stringify(step.timeframe) : ''} onChange={(event) => {
          const text = event.target.value.trim(); if (!text) update(index, { ...step, timeframe: undefined }); else if (text.startsWith('{')) { try { update(index, { ...step, timeframe: JSON.parse(text) }); } catch { /* retain last valid value */ } } else update(index, { ...step, timeframe: text });
        }} placeholder="this_14_days or absolute JSON" /></Field>
        <div className="row"><label className="checkbox-row"><input type="checkbox" disabled={index === 0} checked={Boolean(step.optional)} onChange={(event) => update(index, { ...step, optional: event.target.checked })} /><span>Optional step</span></label><label className="checkbox-row"><input type="checkbox" disabled={index === 0} checked={Boolean(step.inverted)} onChange={(event) => update(index, { ...step, inverted: event.target.checked })} /><span>Inverted step</span></label></div>
        <StepFilters value={step.filters ?? []} onChange={(filters) => update(index, { ...step, filters })} />
      </section>)}
      <Button variant="secondary" onClick={() => onChange([...steps, blankStep()])}><Plus size={14} /> Add funnel step</Button>
    </div>
  );
}
