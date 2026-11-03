import { checked, text } from '~/features/admin/staff.server';

/** A category's form, as `SaveCategoryDto` reads it (new and existing alike). */
export const categoryValues = (form: FormData) => ({
  slug: text(form, 'slug'),
  name: text(form, 'name'),
  description: text(form, 'description'),
  sortOrder: text(form, 'sortOrder') ?? 0,
  active: checked(form, 'active'),
});
