import { useEffect, useRef, useState } from 'react';
import { STATUS_TONE } from '../../constants/index.js';

/* ------------------------------------------------------------------ Badge */
const TONES = {
  green:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red:    'bg-brand-50 text-brand-700 ring-brand-200',
  amber:  'bg-amber-50 text-amber-800 ring-amber-200',
  blue:   'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  slate:  'bg-slate-100 text-slate-600 ring-slate-200',
  teal:   'bg-organ-50 text-organ-700 ring-organ-200',
};

/** Renders a status value with the colour agreed in constants/STATUS_TONE. */
export function Badge({ value, tone, children, className = '' }) {
  const resolved = tone ?? STATUS_TONE[value] ?? 'slate';
  const text = children ?? String(value ?? '').replace(/_/g, ' ');
  return <span className={`badge ${TONES[resolved]} ${className}`}>{text}</span>;
}

/** A blood group rendered as a compact, always-recognisable chip. */
export function BloodChip({ group, className = '' }) {
  if (!group) return <span className="text-slate-400">&mdash;</span>;
  return (
    <span className={`inline-flex items-center justify-center min-w-[2.75rem] rounded-md bg-brand-50
                      text-brand-700 ring-1 ring-inset ring-brand-200 px-1.5 py-0.5
                      font-mono text-xs font-bold tracking-tight ${className}`}>
      {group}
    </span>
  );
}

/* ------------------------------------------------------------------- Card */
export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'card-pad' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-200">
          <div className="min-w-0">
            {title && <h2 className="font-semibold text-slate-900 truncate">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------- StatCard */
export function StatCard({ label, value, hint, tone = 'slate', icon }) {
  const accents = {
    slate: 'text-slate-900', red: 'text-brand-600', teal: 'text-organ-600',
    amber: 'text-amber-600', green: 'text-emerald-600', blue: 'text-sky-600',
  };
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <span className="text-slate-300">{icon}</span>}
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${accents[tone]}`}>{value ?? '—'}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- States */
export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin text-brand-600 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Loading({ label = 'Loading…', rows = 0 }) {
  if (rows > 0) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label={label}>
        {Array.from({ length: rows }).map((_, index) => <div key={index} className="skeleton h-9 w-full" />)}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500" aria-busy="true">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title = 'Nothing to show', message, action, icon = '🗂️' }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="text-3xl mb-2" aria-hidden="true">{icon}</div>
      <p className="font-medium text-slate-800">{title}</p>
      {message && <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="text-3xl mb-2" aria-hidden="true">⚠️</div>
      <p className="font-medium text-slate-800">Something went wrong</p>
      <p className="text-sm text-brand-700 mt-1 max-w-md mx-auto">{message}</p>
      {onRetry && <button className="btn-secondary mt-4" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/**
 * One component that resolves the four states every data view has.
 * Using it everywhere is what keeps loading/empty/error behaviour consistent.
 */
export function DataState({ loading, error, empty, onRetry, children, emptyProps, loadingRows }) {
  if (loading) return <Loading rows={loadingRows} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (empty) return <EmptyState {...emptyProps} />;
  return children;
}

/* ---------------------------------------------------------------- Fields */
export function Field({ label, htmlFor, error, hint, required, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}{required && <span className="text-brand-600 ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Select({ options, placeholder = 'All', valueKey = 'value', labelKey = 'label', ...props }) {
  return (
    <select className="select" {...props}>
      {placeholder !== null && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option[valueKey]} value={option[valueKey]}>{option[labelKey]}</option>
      ))}
    </select>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" viewBox="0 0 20 20"
           fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.08 3.08a1 1 0 01-1.42 1.42l-3.08-3.08A7 7 0 012 9z" clipRule="evenodd" />
      </svg>
      <input className="input pl-9" type="search" value={value} placeholder={placeholder}
             onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/* ---------------------------------------------------------------- Modal */
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
         role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1}
           className={`relative bg-white w-full ${width} rounded-t-2xl sm:rounded-xl shadow-pop
                       max-h-[92vh] overflow-y-auto animate-fade-in`}>
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl sm:rounded-t-xl">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">&times;</button>
        </header>
        <div className="p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50 sticky bottom-0">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirmation gate for destructive or irreversible actions. */
export function ConfirmDialog({ open, onCancel, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'danger', busy }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} width="max-w-md"
           footer={(
             <>
               <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
               <button className={tone === 'danger' ? 'btn-primary' : 'btn-organ'} onClick={onConfirm} disabled={busy}>
                 {busy && <Spinner className="h-4 w-4 text-white" />}{confirmLabel}
               </button>
             </>
           )}>
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------ Pagination */
export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return null;
  const { page, totalPages, total, limit } = meta;
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-1 border-t border-slate-200"
         aria-label="Pagination">
      <p className="text-xs text-slate-500">
        Showing <span className="font-medium text-slate-700">{first}–{last}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button className="btn-secondary btn-sm" onClick={() => onPage(page - 1)} disabled={!meta.hasPrev}>Previous</button>
        <span className="px-2 text-xs text-slate-500 tabular-nums">Page {page} / {totalPages}</span>
        <button className="btn-secondary btn-sm" onClick={() => onPage(page + 1)} disabled={!meta.hasNext}>Next</button>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ Misc */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Disclaimer({ className = '' }) {
  return (
    <p className={`text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 ${className}`}>
      <span className="font-semibold text-slate-600">Academic simulation.</span>{' '}
      The matching and allocation mechanisms here are simplified simulations intended to demonstrate
      database and software engineering concepts, and must not be used for real-world medical
      decision-making.
    </p>
  );
}

/** Small labelled value used on detail pages. */
export function Detail({ label, children, className = '' }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-slate-500 font-medium">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children ?? <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

/** Horizontal meter used for match score breakdowns. */
export function ScoreBar({ value, max = 100, tone = 'teal' }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  const bar = tone === 'teal' ? 'bg-organ-500' : 'bg-brand-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden min-w-[3rem]">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-600 w-10 text-right">{Number(value).toFixed(0)}</span>
    </div>
  );
}

export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  return [on, () => setOn(true), () => setOn(false), setOn];
}

/* ------------------------------------------------------------ formatters */
export const fmt = {
  date: (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'),
  dateTime: (value) => (value ? new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'),
  number: (value) => (value == null ? '—' : Number(value).toLocaleString()),
  pct: (value) => (value == null ? '—' : `${Number(value).toFixed(1)}%`),
  ml: (value) => (value == null ? '—' : `${Number(value).toLocaleString()} ml`),
  relativeDays: (days) => {
    if (days == null) return '—';
    const n = Number(days);
    if (n < 0) return `${Math.abs(n)}d overdue`;
    if (n === 0) return 'today';
    return `${n}d`;
  },
};
