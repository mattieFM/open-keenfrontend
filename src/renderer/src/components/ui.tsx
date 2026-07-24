import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, KeyRound, LoaderCircle, LockKeyhole, X } from 'lucide-react';
import type { CredentialMeta, CredentialType, KeenApiError } from '@shared/types';

export function Button({ className = '', variant = 'primary', loading, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean }): JSX.Element {
  return (
    <button className={`button button--${variant} ${className}`} {...props} disabled={props.disabled || loading}>
      {loading ? <LoaderCircle className="spin" size={16} aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }): JSX.Element {
  return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}

export function Card({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={`card ${className}`} {...props}>{children}</div>;
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }): JSX.Element {
  return (
    <label className={`field ${error ? 'field--error' : ''}`}>
      <span className="field__label">{label}{required ? <span aria-hidden> *</span> : null}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return <span className="select-wrap"><select {...props} className={`select ${props.className ?? ''}`} /> <ChevronDown size={15} aria-hidden /></span>;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'purple' | 'blue'; children: ReactNode }): JSX.Element {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children: ReactNode }): JSX.Element {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`callout callout--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div>{title ? <strong>{title}</strong> : null}<div>{children}</div></div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }): JSX.Element {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: ReactNode; action?: ReactNode }): JSX.Element {
  return <div className="empty-state">{icon}<h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function ErrorPanel({ error }: { error: unknown }): JSX.Element {
  const keenError = error as Partial<KeenApiError> | undefined;
  const message = keenError?.message ?? (error instanceof Error ? error.message : 'An unexpected error occurred.');
  return (
    <div className="error-panel" role="alert">
      <AlertTriangle size={18} aria-hidden />
      <div><strong>Request failed</strong><p>{message}</p>{keenError?.status ? <Badge tone="danger">HTTP {keenError.status}</Badge> : null}</div>
    </div>
  );
}

export function Modal({ title, description, children, onClose, footer }: { title: string; description?: ReactNode; children: ReactNode; onClose(): void; footer?: ReactNode }): JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

const TYPE_LABELS: Record<CredentialType, string> = {
  read: 'Read Key',
  write: 'Write Key',
  master: 'Master Key',
  access: 'Restricted Access Key',
  organization: 'Organization Key'
};

export function CredentialSelect({ credentials, value, onChange, label = 'Credential', disabled, allowedTypes }: { credentials: CredentialMeta[]; value?: string; onChange(value: string): void; label?: string; disabled?: boolean; allowedTypes?: CredentialType[] }): JSX.Element {
  const choices = allowedTypes ? credentials.filter((credential) => allowedTypes.includes(credential.type)) : credentials;
  return (
    <Field label={label} hint="The selected key is sent only in the Authorization header.">
      <Select value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">Choose a credential</option>
        {choices.map((credential) => <option key={credential.id} value={credential.id}>{credential.label} · {TYPE_LABELS[credential.type]} · {credential.hint}</option>)}
      </Select>
    </Field>
  );
}

export function ReadOnlyGate({ enabled, children }: { enabled: boolean; children: ReactNode }): JSX.Element {
  if (enabled) return <>{children}</>;
  return <Callout tone="warning" title="Remote changes are disabled"><span className="inline-icon"><LockKeyhole size={15} /> Enable changes from the workspace header before submitting this operation.</span></Callout>;
}

export function KeyTypeIcon(): JSX.Element {
  return <span className="key-type-icon"><KeyRound size={15} /></span>;
}
