import type { CategoryView } from '@forgea/types';
import { SaveCategoryDto } from '@forgea/validation';
import { useCan } from '~/features/admin/access';
import { AdminHeader, ViewOnly } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { CategoryForm } from '~/features/admin-categories/category-form';
import { categoryValues } from '~/features/admin-categories/category-values.server';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import { oneOf } from '~/features/admin/related.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  return {
    category: await oneOf<CategoryView>(
      context.get(apiContext),
      '/categories/manage',
      params.id,
      'category',
    ),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(SaveCategoryDto, categoryValues(form), (dto) =>
    context
      .get(apiContext)
      .put(`/categories/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function EditCategory({ loaderData }: Route.ComponentProps) {
  const { category } = loaderData;
  const editable = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Categories', to: '/admin/categories' }]}
        title={category.name}
        intro={
          category.active
            ? `In the shop at /shop?category=${category.slug}.`
            : 'Hidden from the shop; its products keep it.'
        }
      />
      <ViewOnly editable={editable}>
        <CategoryForm key={category.id} category={category} />
      </ViewOnly>
      <div className="mt-8 border-t border-border pt-4">
        <DeleteRecord kind="category" id={category.id} what={'this category'} />
      </div>
    </>
  );
}
