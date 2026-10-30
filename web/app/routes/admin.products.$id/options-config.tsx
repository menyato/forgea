import {
  OptionKind,
  type OptionGroupView,
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
                {g.kind === OptionKind.CHOICE ? (
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    {g.values.map((v) => {
                      const offered = config.valueIds.includes(v.id);
                      return (
                        <div key={v.id} className="flex items-center gap-3">
                          <label className="flex items-center gap-2">
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
                            {v.label}
                            {!v.active && (
                              <span className="text-xs text-warning">
                                (off)
                              </span>
                            )}
                          </label>
                          {offered && (
                            <label className="flex items-center gap-1 text-xs text-text-muted">
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
                        </div>
                      );
                    })}
                  </div>
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
