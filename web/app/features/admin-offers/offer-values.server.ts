import { checked, text } from '~/features/admin/staff.server';
import { fromStudioInput } from '~/lib/studio-time';

/** A free offer's form, as `SaveFreeOfferDto` reads it; times typed in the studio's time. */
export const offerValues = (form: FormData) => {
  const at = (name: string) => {
    const value = text(form, name);
    return value ? fromStudioInput(value) : undefined;
  };
  return {
    productId: text(form, 'productId'),
    title: text(form, 'title'),
    description: text(form, 'description'),
    startsAt: at('startsAt'),
    endsAt: at('endsAt'),
    maxClaims: text(form, 'maxClaims'),
    active: checked(form, 'active'),
  };
};
