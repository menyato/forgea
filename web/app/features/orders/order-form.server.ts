import { CheckoutDto } from '@forgea/validation';
import { textFields, validateForm } from '~/lib/forms.server';

const TEXT_FIELDS = [
  'idempotencyKey',
  'name',
  'phone',
  'paymentMethod',
  'currency',
  'city',
  'addressLine',
  'deliveryNotes',
] as const;

/** Reads `OrderForm` (checkout, or accepting a quote) with the shared CheckoutDto. */
export function parseOrderForm(form: FormData) {
  return validateForm(CheckoutDto, {
    ...textFields(form, TEXT_FIELDS),
    delivery: form.get('fulfilment') !== 'pickup',
    rush: form.get('rush') === 'on',
  });
}
