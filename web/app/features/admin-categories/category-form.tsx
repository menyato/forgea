import type { CategoryView } from '@forgea/types';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';

/** A category's form (new or existing): its name and address, then how the shop shows it. */
export function CategoryForm({ category }: { category?: CategoryView }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post" className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Category">
          <Field
            label="Name"
            name="name"
            required
            defaultValue={category?.name}
            error={errors['name']}
          />
          <Field
            label="Web address"
            name="slug"
            required
            defaultValue={category?.slug}
            error={errors['slug']}
            hint="Shown in links: /shop?category=home-desk"
          />
          <Field
            label="Description (optional)"
            name="description"
            defaultValue={category?.description ?? undefined}
            error={errors['description']}
          />
        </Panel>
        <Panel title="In the shop">
          <Field
            label="Order"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={category?.sortOrder ?? 0}
            error={errors['sortOrder']}
            hint="Lower numbers come first"
          />
          <CheckboxField
            label="Visible in the shop"
            name="active"
            defaultChecked={category?.active ?? true}
            hint="Hidden ones disappear from the shop but keep their products"
          />
        </Panel>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          {category ? 'Save' : 'Add category'}
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}
