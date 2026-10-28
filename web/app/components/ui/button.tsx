import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-95',
  secondary: 'border border-border bg-surface text-text hover:bg-background',
  quiet: 'text-text-muted underline-offset-4 hover:text-text hover:underline',
};

/** The one button style used across the storefront, so focus and disabled states never drift. */
export const buttonClass = (variant: Variant = 'primary', extra = '') =>
  [
    'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
    'transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-60',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    VARIANTS[variant],
    extra,
  ].join(' ');

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={buttonClass(variant, className)}
      {...props}
    />
  );
}
