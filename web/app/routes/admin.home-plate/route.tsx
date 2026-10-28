import type { AdminProductListItem, HomePlate, Page } from '@forgea/types';
import { SetHomePlateDto } from '@forgea/validation';
import { useMemo, useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { SelectField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save } from '~/features/admin/staff.server';
import { BuildPlate } from '~/features/build-plate/build-plate';
import type { PlateItem } from '~/features/build-plate/build-plate-scene.client';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [plate, products] = await Promise.all([
    api.get<HomePlate>('/products/plate'),
    api.get<Page<AdminProductListItem>>(
      '/products/manage?limit=100&sort=name&order=asc',
    ),
  ]);
  if (!plate.ok) throw new Response(plate.message, { status: plate.status });
  if (!products.ok)
    throw new Response(products.message, { status: products.status });
  return {
    plate: plate.data,
    // Only products with a 3D model can stand on the bed.
    candidates: products.data.items.filter((p) => p.hasModel),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const productIds = form
    .getAll('productId')
    .filter((v): v is string => typeof v === 'string' && v !== '');
  return save(SetHomePlateDto, { productIds }, (dto) =>
    context.get(apiContext).put('/products/plate', dto),
  );
}

/** The bed's five spots, in order: the centre prints first, then the corners. */
const SPOTS = [
  'Centre',
  'Back left',
  'Back right',
  'Front left',
  'Front right',
];

export default function HomePlatePage({ loaderData }: Route.ComponentProps) {
  const { plate, candidates } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const [chosen, setChosen] = useState<string[]>(() =>
    SPOTS.map((_, i) => (plate.chosen ? (plate.products[i]?.id ?? '') : '')),
  );
  // The bed as saved (and as the home page shows it); it reloads after each save.
  const preview = useMemo(
    () =>
      plate.products.flatMap((p): PlateItem[] =>
        p.modelKey
          ? [
              {
                slug: p.slug,
                name: p.name,
                modelKey: p.modelKey,
                color: p.previewColor ?? '#9a9ea3',
              },
            ]
          : [],
      ),
    [plate.products],
  );
  const duplicate =
    new Set(chosen.filter(Boolean)).size !== chosen.filter(Boolean).length;

  return (
    <>
      <AdminHeader
        title="Home page bed"
        intro="Choose what stands on the 3D print bed at the top of the home page: up to five products with a 3D model. The centre prints first, then the corners."
      />
      <div className="grid gap-6 xl:grid-cols-[24rem_1fr]">
        <Panel title="On the bed">
          {!plate.chosen && (
            <p className="text-sm text-text-muted">
              Nothing chosen yet: the newest products with a model stand in.
            </p>
          )}
          <fetcher.Form method="post" className="grid gap-4">
            {SPOTS.map((spot, i) => (
              <SelectField
                key={spot}
                label={spot}
                name="productId"
                value={chosen[i]}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setChosen((all) => all.map((x, j) => (j === i ? v : x)));
                }}
              >
                <option value="">Empty</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!p.active && ' (hidden)'}
                  </option>
                ))}
              </SelectField>
            ))}
            {duplicate && (
              <p className="text-sm text-danger">
                Each product can stand on the bed once.
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={duplicate || fetcher.state !== 'idle'}
              >
                Save the bed
              </Button>
              <SaveStatus state={fetcher.state} result={fetcher.data} />
            </div>
          </fetcher.Form>
        </Panel>
        <Panel title="Saved bed">
          <p className="text-sm text-text-muted">
            The bed as the home page shows it now. Save to see your changes
            here.
          </p>
          <div className="aspect-[4/3]">
            <BuildPlate
              key={preview.map((p) => p.modelKey).join()}
              items={preview}
              hovered={null}
              onHover={() => undefined}
              onOpen={() => undefined}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}
