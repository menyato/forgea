import { type ReactNode, useState } from 'react';
import { Button } from './button';

/**
 * A submit button for something final (cancel, delete, credit): the first press asks on the
 * page itself ("Cancel quotation Q-2026-0007?" with Yes and No), and only "Yes" submits, with
 * this button's `name` and `value`. Never the browser's own pop-up, which embedded browsers
 * (the desktop app's pane) close on their own, so nothing happened.
 */
export function ConfirmButton({
  children,
  question,
  yes,
  name,
  value,
  variant = 'quiet',
  disabled,
}: {
  children: ReactNode;
  /** Asked once pressed, e.g. "Cancel quotation Q-2026-0007? The customer is told." */
  question: string;
  /** The button that does it, e.g. "Yes, cancel it". */
  yes: string;
  name?: string;
  value?: string;
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button
        type="button"
        variant={variant}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {children}
      </Button>
    );
  return (
    <span
      role="group"
      aria-label={question}
      className="inline-flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
    >
      <span className="text-sm">{question}</span>
      <Button
        type="submit"
        name={name}
        value={value}
        variant="primary"
        disabled={disabled}
        // A new question starts closed once the page moves on.
        onClick={() => setTimeout(() => setAsking(false), 0)}
      >
        {yes}
      </Button>
      <Button type="button" variant="quiet" onClick={() => setAsking(false)}>
        No, keep it
      </Button>
    </span>
  );
}
