import { useRouteLoaderData } from 'react-router';
import { SelectField } from '~/components/ui/field';
import type { loader as rootLoader } from '~/root';

/**
 * Where to deliver: one of the studio's delivery areas (Settings → Delivery areas), never free
 * text, so every order goes somewhere the studio delivers to. An older value no longer on the
 * list shows as it is, to be changed (the API refuses it until it is).
 */
export function DeliveryAreaField({
  name = 'city',
  value,
  error,
}: {
  name?: string;
  value?: string | null | undefined;
  error?: string | undefined;
}) {
  const areas =
    useRouteLoaderData<typeof rootLoader>('root')?.store?.deliveryAreas ?? [];
  const stale =
    value && !areas.some((a) => a.toLowerCase() === value.toLowerCase());
  return (
    <SelectField
      label="Delivery area"
      name={name}
      required
      defaultValue={value ?? ''}
      autoComplete="address-level2"
      error={error}
      hint={
        stale
          ? `"${value}" isn't on the list any more: choose an area.`
          : undefined
      }
    >
      <option value="" disabled>
        Choose your area…
      </option>
      {stale && <option value={value}>{value}</option>}
      {areas.map((a) => (
        <option key={a} value={a}>
          {a}
        </option>
      ))}
    </SelectField>
  );
}
