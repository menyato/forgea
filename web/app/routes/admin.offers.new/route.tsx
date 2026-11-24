import type { FreeOfferView, QuotableProduct } from '@forgea/types';
import { SaveFreeOfferDto } from '@forgea/validation';
import { AdminHeader } from '~/features/admin/admin-ui';
import { saveNew } from '~/features/admin/staff.server';
import { OfferForm } from '~/features/admin-offers/offer-form';
import { offerValues } from '~/features/admin-offers/offer-values.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<QuotableProduct[]>('/products/quotable');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { products: r.data };
}

/** A new free offer; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return saveNew(
    SaveFreeOfferDto,
    offerValues(form),
    (dto) => context.get(apiContext).post<FreeOfferView>('/offers', dto),
    (created) => `/admin/offers/${created.id}`,
  );
}

export default function NewOffer({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <AdminHeader
        title="New free offer"
        intro="A piece given free for a limited time, one per customer: the shop shows a banner, and the piece's page a Claim it free button."
        trail={[{ label: 'Free offers', to: '/admin/offers' }]}
      />
      <OfferForm products={loaderData.products} />
    </>
  );
}
