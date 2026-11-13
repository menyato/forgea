import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

const CONTROL =
  'w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-base text-text ' +
  'placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-1 ' +
  'focus-visible:outline-focus-ring aria-[invalid=true]:border-danger';

/**
 * Every control says whether the browser may autofill it (DevTools flags those that don't):
 * contact fields by their type, everything else off. A field's own autoComplete wins.
 */
const AUTOFILL: Partial<Record<string, string>> = {
  email: 'email',
  tel: 'tel',
  password: 'current-password',
};

interface FieldProps {
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string;
}

/** Label, control and error message wired together for screen readers (aria-describedby). */
export function Field({
  label,
  name,
  error,
  hint,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={CONTROL}
        autoComplete={AUTOFILL[input.type ?? 'text'] ?? 'off'}
        {...input}
      />
      <FieldNote id={`${id}-note`} error={error} hint={hint} />
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  error,
  hint,
  ...input
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={`${CONTROL} min-h-24`}
        autoComplete="off"
        {...input}
      />
      <FieldNote id={`${id}-note`} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({
  label,
  name,
  error,
  hint,
  children,
  ...select
}: FieldProps &
  SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const id = useId();
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={CONTROL}
        autoComplete="off"
        {...select}
      >
        {children}
      </select>
      <FieldNote id={`${id}-note`} error={error} hint={hint} />
    </div>
  );
}

/** A yes/no setting with an explanation underneath. */
export function CheckboxField({
  label,
  name,
  hint,
  ...input
}: Omit<FieldProps, 'error'> & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        name={name}
        value="on"
        aria-describedby={hint ? `${id}-note` : undefined}
        className="mt-1 size-4 accent-[var(--forgea-color-accent)]"
        autoComplete="off"
        {...input}
      />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <FieldNote id={`${id}-note`} hint={hint} />
      </div>
    </div>
  );
}

function FieldNote({
  id,
  error,
  hint,
}: {
  id: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  if (error) {
    return (
      <p id={id} className="text-sm text-danger">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={id} className="text-xs text-text-muted">
      {hint}
    </p>
  ) : null;
}

/** A form-level message, e.g. an error returned by the API. */
export function FormAlert({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}
