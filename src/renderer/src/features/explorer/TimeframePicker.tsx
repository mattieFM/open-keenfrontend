import { useEffect, useMemo, useState } from 'react';
import type { KeenTimeframe } from '@shared/types';
import { Button, Field, Input, Select } from '../../components/ui';

const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_7_days', 'Last 7 days'],
  ['this_14_days', 'Last 14 days'],
  ['this_30_days', 'Last 30 days'],
  ['this_90_days', 'Last 90 days'],
  ['previous_7_days', 'Previous 7 days'],
  ['previous_30_days', 'Previous 30 days']
] as const;

function toLocalDateTime(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function TimeframePicker({ value, timezone, onChange, allowEmpty = false, showTimezone = true, compact = false, label = 'Timeframe' }: {
  value?: KeenTimeframe;
  timezone?: string | number;
  onChange(value: KeenTimeframe | undefined, timezone?: string | number): void;
  allowEmpty?: boolean;
  showTimezone?: boolean;
  compact?: boolean;
  label?: string;
}): JSX.Element {
  const initialMode = value && typeof value === 'object' ? 'absolute' : value ? 'relative' : allowEmpty ? 'inherit' : 'relative';
  const [mode, setMode] = useState<'inherit' | 'relative' | 'absolute'>(initialMode);
  const relativeValue = typeof value === 'string' ? value : 'this_14_days';
  const preset = useMemo(() => PRESETS.some(([candidate]) => candidate === relativeValue) ? relativeValue : 'custom', [relativeValue]);

  useEffect(() => {
    if (!value && allowEmpty) setMode('inherit');
    else if (value && typeof value === 'object') setMode('absolute');
    else if (typeof value === 'string') setMode('relative');
  }, [allowEmpty, value]);

  const switchMode = (next: 'inherit' | 'relative' | 'absolute') => {
    setMode(next);
    if (next === 'inherit') onChange(undefined, undefined);
    if (next === 'relative') onChange(typeof value === 'string' && value ? value : 'this_14_days', timezone ?? 'UTC');
    if (next === 'absolute') onChange(typeof value === 'object' ? value : { start: new Date(Date.now() - 14 * 86_400_000).toISOString(), end: new Date().toISOString() }, undefined);
  };

  return <div className={`timeframe-picker ${compact ? 'timeframe-picker--compact' : ''}`}>
    <div className="row row--between"><strong className="small">{label}</strong><div className="segmented segmented--wrap">{allowEmpty ? <button type="button" className={mode === 'inherit' ? 'active' : ''} onClick={() => switchMode('inherit')}>Inherit</button> : null}<button type="button" className={mode === 'relative' ? 'active' : ''} onClick={() => switchMode('relative')}>Relative</button><button type="button" className={mode === 'absolute' ? 'active' : ''} onClick={() => switchMode('absolute')}>Absolute</button></div></div>
    {mode === 'inherit' ? <div className="empty-inline">Uses the dashboard or funnel-level timeframe.</div> : mode === 'relative' ? <div className={showTimezone ? 'form-grid' : 'stack stack--compact'}>
      <Field label="Range"><Select value={preset} onChange={(event) => {
        const next = event.target.value;
        if (next !== 'custom') onChange(next, timezone ?? 'UTC');
        else if (PRESETS.some(([candidate]) => candidate === relativeValue)) onChange('this_14_days', timezone ?? 'UTC');
      }}>{PRESETS.map(([candidate, title]) => <option key={candidate} value={candidate}>{title}</option>)}<option value="custom">Custom Keen relative range</option></Select></Field>
      {preset === 'custom' ? <Field label="Custom range" hint="For example: this_45_days or previous_2_months"><Input value={relativeValue} onChange={(event) => onChange(event.target.value, timezone ?? 'UTC')} /></Field> : null}
      {showTimezone ? <Field label="Timezone" hint="IANA name such as America/Detroit"><Input value={String(timezone ?? 'UTC')} onChange={(event) => onChange(relativeValue, event.target.value || 'UTC')} /></Field> : null}
    </div> : <div className="form-grid">
      <Field label="Start"><Input type="datetime-local" value={toLocalDateTime(typeof value === 'object' ? value.start : undefined)} onChange={(event) => onChange({ start: toIso(event.target.value), end: typeof value === 'object' ? value.end : new Date().toISOString() }, undefined)} /></Field>
      <Field label="End (exclusive)"><Input type="datetime-local" value={toLocalDateTime(typeof value === 'object' ? value.end : undefined)} onChange={(event) => onChange({ start: typeof value === 'object' ? value.start : new Date(Date.now() - 14 * 86_400_000).toISOString(), end: toIso(event.target.value) }, undefined)} /></Field>
    </div>}
    {allowEmpty && mode !== 'inherit' ? <Button type="button" variant="ghost" onClick={() => switchMode('inherit')}>Clear override</Button> : null}
  </div>;
}
