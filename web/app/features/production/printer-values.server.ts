import { checked, text } from '~/features/admin/staff.server';

/** A printer form's values, for `SavePrinterDto`. */
export const printerValues = (form: FormData) => ({
  name: text(form, 'name'),
  watts: text(form, 'watts'),
  ...(text(form, 'priceUsd') ? { priceUsd: text(form, 'priceUsd') } : {}),
  ...(text(form, 'lifeHours') ? { lifeHours: text(form, 'lifeHours') } : {}),
  active: checked(form, 'active'),
  ...(text(form, 'notes') ? { notes: text(form, 'notes') } : {}),
});
