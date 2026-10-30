import {
  OptionKind,
  type OptionGroupView,
  type OptionValueView,
  type ProductOptionConfig,
} from '@forgea/types';
import { Link } from 'react-router';

/**
 * Which option groups this product offers, which of their choices, and the default.
 * Groups and choices themselves (and their price rules) are edited on the Options page.
 */
export function OptionsConfig({
  groups,
  value,
  onChange,
}: {
  groups: readonly OptionGroupView[];
  value: readonly ProductOptionConfig[];
  onChange: (value: ProductOptionConfig[]) => void;
}) {
  const configOf = (groupId: string) =>
    value.find((o) => o.groupId === groupId);
  const update = (groupId: string, change: Partial<ProductOptionConfig>) =>
    onChange(
      value.map((o) => (o.groupId === groupId ? { ...o, ...change } : o)),
    );

  if (groups.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No options yet.{' '}
        <Link to="/admin/options" className="underline">
          Create colours, sizes or a text option
        </Link>{' '}
        first.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {groups.map((g) => {
        const config = configOf(g.id);
        const activeValues = g.values.filter((v) => v.active);
        return (
          <fieldset
            key={g.id}
            className={`grid gap-3 rounded-md border p-4 ${
              config ? 'border-accent' : 'border-border'
            }`}
          >
            <legend className="sr-only">{g.name}</legend>
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                name={`offer-${g.id}`}
                checked={config !== undefined}
                onChange={(e) =>
                  onChange(
                    e.currentTarget.checked
                      ? [
                          ...value,
                          {
                            groupId: g.id,
                            required: g.kind === OptionKind.CHOICE,
                            valueIds: activeValues.map((v) => v.id),
                            defaultValueId: activeValues[0]?.id ?? null,
                          },
                        ]
                      : value.filter((o) => o.groupId !== g.id),
                  )
                }
              />
              Offer {g.name}
              {!g.active && (
                <span className="text-xs font-normal text-warning">
                  (switched off on the Options page)
                </span>
              )}
            </label>
            {config && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`required-${g.id}`}
                    checked={config.required}
                    onChange={(e) =>
                      update(g.id, { required: e.currentTarget.checked })
                    }
                  />
                  Customers must choose this
                </label>
                {g.kind === OptionKind.CHOICE && (
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        update(g.id, {
                          valueIds: activeValues.map((v) => v.id),
                          defaultValueId:
                            config.defaultValueId ??
                            activeValues[0]?.id ??
                            null,
                        })
                      }
                    >
                      Offer all
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        update(g.id, { valueIds: [], defaultValueId: null })
                      }
                    >
                      None
                    </button>
                  </div>
                )}
                {g.kind === OptionKind.CHOICE ? (
                  <ul className="grid gap-1.5 text-sm">
                    {g.values.map((v) => {
                      const offered = config.valueIds.includes(v.id);
                      return (
                        <li
                          key={v.id}
                          className="flex items-start justify-between gap-3 rounded-md px-2 py-1 hover:bg-surface-raised"
                        >
                          <label className="flex min-w-0 flex-1 items-start gap-2">
                            <input
                              type="checkbox"
                              name={`value-${v.id}`}
                              checked={offered}
                              onChange={(e) => {
                                const valueIds = e.currentTarget.checked
                                  ? [...config.valueIds, v.id]
                                  : config.valueIds.filter((id) => id !== v.id);
                                update(g.id, {
                                  valueIds,
                                  defaultValueId: valueIds.includes(
                                    config.defaultValueId ?? '',
                                  )
                                    ? config.defaultValueId
                                    : null,
                                });
                              }}
                            />
                            {v.swatchHex && (
                              <span
                                aria-hidden="true"
                                className="size-3.5 rounded-full border border-border"
                                style={{ backgroundColor: v.swatchHex }}
                              />
                            )}
                            {/* Long names wrap inside the row; the effect goes under them. */}
                            <span className="min-w-0 break-words">
                              {v.label}
                              {!v.active && (
                                <span className="ml-1 text-xs text-warning">
                                  (off)
                                </span>
                              )}
                              {effectOf(v) && (
                                <span className="block text-xs text-text-muted">
                                  {effectOf(v)}
                                </span>
                              )}
                            </span>
                          </label>
                          {offered && (
                            <label className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                              <input
                                type="radio"
                                name={`default-${g.id}`}
                                checked={config.defaultValueId === v.id}
                                onChange={() =>
                                  update(g.id, { defaultValueId: v.id })
                                }
                              />
                              default
                            </label>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-text-muted">
                    Customers type up to {g.maxLength} characters
                    {Number(g.textExtraPrice) > 0 && ` (+$${g.textExtraPrice})`}
                    .
                  </p>
                )}
              </>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

/** What a choice does to the price, in a few words: "+$1.50", "material ×1.8". */
function effectOf(v: OptionValueView): string | null {
  const parts = [
    ...(Number(v.extraPrice) > 0 ? [`+$${v.extraPrice}`] : []),
    ...(Number(v.gramsMultiplier) !== 1
      ? [`material ×${Number(v.gramsMultiplier)}`]
      : []),
    ...(Number(v.hoursMultiplier) !== 1
      ? [`time ×${Number(v.hoursMultiplier)}`]
      : []),
    ...(v.materialId ? ['switches material'] : []),
  ];
  return parts.length ? `(${parts.join(', ')})` : null;
}
