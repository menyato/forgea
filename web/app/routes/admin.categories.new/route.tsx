import type { CategoryView } from '@forgea/types';
import { SaveCategoryDto } from '@forgea/validation';
import { AdminHeader } from '~/features/admin/admin-ui';
import { saveNew } from '~/features/admin/staff.server';
import { CategoryForm } from '~/features/admin-categories/category-form';
import { categoryValues } from '~/features/admin-categories/category-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new category; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return saveNew(
    SaveCategoryDto,
    categoryValues(form),
    (dto) => context.get(apiContext).post<CategoryView>('/categories', dto),
    (created) => `/admin/categories/${created.id}`,
  );
}

export default function NewCategory() {
  return (
    <>
      <AdminHeader
        title="New category"
        intro="A section of the shop. Products choose their category on their own page."
        trail={[{ label: 'Categories', to: '/admin/categories' }]}
      />
      <CategoryForm />
    </>
  );
}
