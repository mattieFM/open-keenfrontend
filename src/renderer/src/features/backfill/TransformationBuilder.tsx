import { Copy, FileJson, Fingerprint, Plus, Trash2, Type, Workflow } from 'lucide-react';
import { Button, Field, IconButton, Input, Select } from '../../components/ui';
import type { FieldTransformation, MissingSourceBehavior, TransformationOperation, ValueSource } from './types';

export function newTransformation(): FieldTransformation {
  return {
    id: crypto.randomUUID(),
    operation: 'set',
    targetPath: 'project_id',
    source: 'project-id',
    value: '',
    onlyIfMissing: false,
    missingSource: 'error'
  };
}

function sourceLabel(source: ValueSource): string {
  if (source === 'literal') return 'Literal / JSON value';
  if (source === 'copy') return 'Copy another property';
  if (source === 'project-id') return 'Current project ID';
  if (source === 'uuid') return 'Generate UUID per event';
  return 'Template';
}

function sourceIcon(source: ValueSource): JSX.Element {
  if (source === 'copy') return <Copy size={14} />;
  if (source === 'project-id') return <Fingerprint size={14} />;
  if (source === 'uuid') return <Workflow size={14} />;
  if (source === 'template') return <Type size={14} />;
  return <FileJson size={14} />;
}

export function TransformationBuilder({
  transformations,
  onChange,
  propertyListId
}: {
  transformations: FieldTransformation[];
  onChange(transformations: FieldTransformation[]): void;
  propertyListId: string;
}): JSX.Element {
  const update = (id: string, patch: Partial<FieldTransformation>) => onChange(transformations.map((item) => item.id === id ? { ...item, ...patch } : item));
  return (
    <div className="stack stack--tight">
      {transformations.map((transformation, index) => (
        <section className="backfill-change" key={transformation.id}>
          <div className="backfill-change__header">
            <strong>Field change {index + 1}</strong>
            <IconButton label={`Remove field change ${index + 1}`} onClick={() => onChange(transformations.filter((item) => item.id !== transformation.id))}><Trash2 size={15} /></IconButton>
          </div>
          <div className="backfill-change__grid">
            <Field label="Action">
              <Select aria-label={`Field change ${index + 1} action`} value={transformation.operation} onChange={(event) => { const operation = event.target.value as TransformationOperation; update(transformation.id, { operation, ...(operation === 'remove' ? { onlyIfMissing: false } : {}) }); }}>
                <option value="set">Set / upsert field</option>
                <option value="remove">Remove field (rebuild only)</option>
              </Select>
            </Field>
            <Field label="Target property" required>
              <Input list={propertyListId} aria-label={`Field change ${index + 1} target property`} value={transformation.targetPath} onChange={(event) => update(transformation.id, { targetPath: event.target.value })} placeholder="project_id or event_id" />
            </Field>
            {transformation.operation === 'set' ? (
              <Field label="Value source">
                <Select aria-label={`Field change ${index + 1} value source`} value={transformation.source} onChange={(event) => update(transformation.id, { source: event.target.value as ValueSource, value: '' })}>
                  {(['literal', 'copy', 'project-id', 'uuid', 'template'] as ValueSource[]).map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
                </Select>
              </Field>
            ) : <div />}
          </div>
          {transformation.operation === 'set' ? (
            <div className="backfill-change__value">
              <span className="backfill-change__source-icon">{sourceIcon(transformation.source)}</span>
              {transformation.source === 'literal' ? <Input aria-label={`Field change ${index + 1} literal value`} value={transformation.value} onChange={(event) => update(transformation.id, { value: event.target.value })} placeholder='Literal or JSON, e.g. "active", 42, true, {"tier":"pro"}' />
                : transformation.source === 'copy' ? <Input list={propertyListId} aria-label={`Field change ${index + 1} source property`} value={transformation.value} onChange={(event) => update(transformation.id, { value: event.target.value })} placeholder="source.property.path" />
                  : transformation.source === 'template' ? <Input aria-label={`Field change ${index + 1} template`} value={transformation.value} onChange={(event) => update(transformation.id, { value: event.target.value })} placeholder="{{customer.id}}-{{project.id}}-{{uuid}}" />
                    : <div className="empty-inline">{transformation.source === 'project-id' ? 'The active workspace Project ID is written to every matched event.' : 'A different UUID is generated for each matched event and locked into the preview.'}</div>}
            </div>
          ) : null}
          <div className="backfill-change__options">
            {transformation.operation === 'set' ? <label className="checkbox-row"><input type="checkbox" checked={transformation.onlyIfMissing} onChange={(event) => update(transformation.id, { onlyIfMissing: event.target.checked })} /><span>Only change events where the target is missing</span></label> : null}
            {transformation.operation === 'set' && ['copy', 'template'].includes(transformation.source) ? (
              <Field label="If a source field is missing">
                <Select value={transformation.missingSource} onChange={(event) => update(transformation.id, { missingSource: event.target.value as MissingSourceBehavior })}>
                  <option value="error">Stop before backup is armed</option>
                  <option value="skip">Skip this assignment</option>
                  <option value="null">Write null</option>
                </Select>
              </Field>
            ) : null}
          </div>
        </section>
      ))}
      <Button variant="secondary" onClick={() => onChange([...transformations, newTransformation()])}><Plus size={14} /> Add field change</Button>
    </div>
  );
}
