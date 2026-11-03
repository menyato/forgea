import { checked, text } from '~/features/admin/staff.server';

/** An option group's form, as `SaveOptionGroupDto` reads it (new and existing alike). */
export const groupValues = (form: FormData) => ({
  name: text(form, 'name'),
  kind: text(form, 'kind'),
  maxLength: text(form, 'maxLength'),
  textExtraPrice: text(form, 'textExtraPrice') ?? '0',
  sortOrder: text(form, 'sortOrder') ?? 0,
  active: checked(form, 'active'),
});
