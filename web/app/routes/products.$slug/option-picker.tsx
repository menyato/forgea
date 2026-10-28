import { OptionKind, type ProductOption } from '@forgea/types';
import { useId } from 'react';

/** The shopper's current choices: group id → value id (choices) or text (text options). */
export type Choices = Readonly<Record<string, string>>;

/** One option: colour swatches, a row of buttons for other choices, or a text box. */
export function OptionPicker({
  option,
  value,
  onChange,
}: {
  option: ProductOption;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const legend = (
    <legend className="mb-2 text-sm font-semibold">
      {option.name}
      {!option.required && (
        <span className="font-normal text-text-muted"> (optional)</span>
      )}
    </legend>
  );

  if (option.kind === OptionKind.TEXT) {
    return (
      <fieldset>
        {legend}
        <label htmlFor={id} className="sr-only">
          {option.name}
        </label>
        <input
          id={id}
          type="text"
          value={value ?? ''}
          maxLength={option.maxLength ?? undefined}
          onChange={(e) => onChange(e.currentTarget.value)}
          className="w-full rounded-md border border-border bg-surface px-3 py-2"
          aria-describedby={`${id}-count`}
        />
        <p id={`${id}-count`} className="mt-1 text-xs text-text-muted">
          {(value ?? '').length} / {option.maxLength} characters
        </p>
      </fieldset>
    );
  }

  return (
    <fieldset>
      {legend}
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {option.choices.map((c) => {
          const selected = value === c.id;
          return (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-2 rounded-pill border px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring ${
                selected
                  ? 'border-accent bg-accent/10 font-semibold'
                  : 'border-border hover:border-text-muted'
              }`}
            >
              <input
                type="radio"
                name={`option-${option.groupId}`}
                value={c.id}
                checked={selected}
                onChange={() => onChange(c.id)}
                className="sr-only"
              />
              {c.swatchHex && (
                <span
                  aria-hidden="true"
                  className="size-4 rounded-full border border-border"
                  style={{ backgroundColor: c.swatchHex }}
                />
              )}
              {c.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
