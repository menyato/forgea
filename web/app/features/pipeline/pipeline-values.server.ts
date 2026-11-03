import { checked, text } from '~/features/admin/staff.server';

/** A stage form's values, for `SaveLeadStageDto`. */
export const stageValues = (form: FormData) => ({
  name: text(form, 'name'),
  sortOrder: text(form, 'sortOrder'),
  isWon: checked(form, 'isWon'),
  defaultProbability: text(form, 'defaultProbability'),
  active: checked(form, 'active'),
});

/** A lost reason form's values, for `SaveLostReasonDto`. */
export const reasonValues = (form: FormData) => ({
  name: text(form, 'name'),
  active: checked(form, 'active'),
});
