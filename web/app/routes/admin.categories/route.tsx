import type { CategoryView } from '@forgea/types';
import { SaveCategoryDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<CategoryView[]>('/categories/manage');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { categories: r.data };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const id = text(form, 'id');
  return save(
    SaveCategoryDto,
    {
      slug: text(form, 'slug'),
      name: text(form, 'name'),
      description: text(form, 'description'),
      sortOrder: text(form, 'sortOrder') ?? 0,
      active: checked(form, 'active'),
    },
    (dto) =>
      id
        ? api.put(`/categories/${encodeURIComponent(id)}`, dto)
        : api.post('/categories', dto),
  );
}

export default function Categories({ loaderData }: Route.ComponentProps) {
  const editable = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        title="Categories"
        intro="Sections of the shop. Customers filter by them; hidden ones disappear from the shop but keep their products."
      />
      <ViewOnly editable={editable}>
        <div className="grid gap-4">
          {editable && <CategoryForm key="new" />}
          {loaderData.categories.map((c) => (
            <CategoryForm key={c.id} category={c} />
          ))}
        </div>
      </ViewOnly>
    </>
  );
}

function CategoryForm({ category }: { category?: CategoryView }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <Panel title={category ? category.name : 'New category'}>
      <fetcher.Form
        method="post"
        className="grid gap-4 sm:grid-cols-2"
        // A fresh form after creating, so the next category starts empty.
        key={!category && fetcher.data?.ok ? 'reset' : 'form'}
      >
        {category && <input type="hidden" name="id" value={category.id} />}
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
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            {category ? 'Save' : 'Add category'}
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}
