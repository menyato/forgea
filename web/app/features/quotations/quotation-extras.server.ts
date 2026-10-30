import type { OrderSettings } from '@forgea/pricing';
import type { CurrencyQuote, QuotationDetail } from '@forgea/types';
import type { ApiClient } from '~/lib/api-client.server';

/**
 * What the quotation page shows beside the quotation: the delivery fee the order will add
 * (so the customer accepts exactly what they will be charged) and the currencies for the
 * order confirmation.
 */
export async function quotationExtras(api: ApiClient, q: QuotationDetail) {
  const [currencies, settings] = await Promise.all([
    api.get<CurrencyQuote[]>('/currencies'),
    api.get<OrderSettings>('/pricing/order-settings'),
  ]);
  return {
    currencies: currencies.ok ? currencies.data : [],
    deliveryFee:
      q.delivery && settings.ok ? String(settings.data.deliveryFee) : null,
  };
}
