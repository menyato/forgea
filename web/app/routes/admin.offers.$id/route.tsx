import type { FreeOfferView, QuotableProduct } from '@forgea/types';
import { SaveFreeOfferDto } from '@forgea/validation';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { OfferForm } from '~/features/admin-offers/offer-form';
import { offerValues } from '~/features/admin-offers/offer-values.server';
import { apiContext } from '~/lib/request.server';
import { studioDateTime } from '~/lib/studio-time';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [offer, products] = await Promise.all([
    api.get<FreeOfferView>(`/offers/${encodeURIComponent(params.id)}`),
    api.get<QuotableProduct[]>('/products/quotable'),
  ]);
  if (!offer.ok) throw new Response(offer.message, { status: offer.status });
  if (!products.ok)
    throw new Response(products.message, { status: products.status });
  return { offer: offer.data, products: products.data };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(SaveFreeOfferDto, offerValues(form), (dto) =>
    context
      .get(apiContext)
      .put(`/offers/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function EditOffer({ loaderData }: Route.ComponentProps) {
  const { offer, products } = loaderData;
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Free offers', to: '/admin/offers' }]}
        title={offer.title}
        intro={`${offer.productName} · ${studioDateTime(offer.startsAt)} to ${studioDateTime(offer.endsAt)} · ${offer.claimed} claimed${offer.maxClaims ? ` of ${offer.maxClaims}` : ''}.`}
      />
      <OfferForm key={offer.id} offer={offer} products={products} />
    </>
  );
}
