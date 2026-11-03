import { checked, text } from '~/features/admin/staff.server';

/** A material's form, as `SaveMaterialDto` reads it (new and existing alike). */
export const materialValues = (form: FormData) => ({
  code: text(form, 'code')?.toUpperCase(),
  name: text(form, 'name'),
  reelPrice: text(form, 'reelPrice'),
  reelGrams: text(form, 'reelGrams'),
  densityGPerCm3: text(form, 'densityGPerCm3'),
  gramsPerHour: text(form, 'gramsPerHour'),
  stockGrams: text(form, 'stockGrams'),
  lowStockThresholdGrams: text(form, 'lowStockThresholdGrams'),
  active: checked(form, 'active'),
});
