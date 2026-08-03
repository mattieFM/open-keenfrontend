import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import type { FunnelStep } from '@shared/types';
import { Button, Callout, Field, IconButton, Input } from '../../components/ui';
import { FilterBuilder } from './FilterBuilder';
import { TimeframePicker } from './TimeframePicker';

function blankStep(): FunnelStep {
  return { event_collection: '', actor_property: '' };
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
      <Callout tone="info" title="Actor matching">Use one stable actor property across steps. The console warns conservatively at 1,000,000 actors and treats the server response as authoritative.</Callout>
      {steps.map((step, index) => <section className="funnel-step" key={`${index}-${step.event_collection}`}>
        <div className="row row--between"><strong>Step {index + 1}</strong><div className="row"><IconButton label="Move step up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></IconButton><IconButton label="Move step down" disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></IconButton><IconButton label="Duplicate step" onClick={() => onChange([...steps.slice(0, index + 1), structuredClone(step), ...steps.slice(index + 1)])}><Copy size={15} /></IconButton><IconButton label="Delete step" disabled={steps.length <= 2} onClick={() => onChange(steps.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></IconButton></div></div>
        <div className="form-grid"><Field label="Event collection" required><Input list="explorer-collection-options" value={step.event_collection} onChange={(event) => update(index, { ...step, event_collection: event.target.value })} placeholder="purchases" /></Field><Field label="Actor property" required><Input list="explorer-property-options" value={step.actor_property} onChange={(event) => update(index, { ...step, actor_property: event.target.value })} placeholder="user.id" /></Field></div>
        <TimeframePicker compact allowEmpty showTimezone={false} label="Step timeframe override" value={step.timeframe} onChange={(timeframe) => update(index, { ...step, timeframe })} />
        <div className="row"><label className="checkbox-row"><input type="checkbox" disabled={index === 0} checked={Boolean(step.optional)} onChange={(event) => update(index, { ...step, optional: event.target.checked })} /><span>Optional step</span></label><label className="checkbox-row"><input type="checkbox" disabled={index === 0} checked={Boolean(step.inverted)} onChange={(event) => update(index, { ...step, inverted: event.target.checked })} /><span>Inverted step</span></label></div>
        <div className="stack stack--compact"><strong className="small">Step filters</strong><FilterBuilder filters={step.filters ?? []} onChange={(filters) => update(index, { ...step, filters })} /></div>
      </section>)}
      <Button type="button" variant="secondary" onClick={() => onChange([...steps, blankStep()])}><Plus size={14} /> Add funnel step</Button>
    </div>
  );
}
