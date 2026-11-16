export { unlessAsking as shouldRevalidate } from '~/lib/revalidate';
import type {
  CustomRequestView,
  RequestEstimate,
  UploadedFile,
} from '@forgea/types';
import { CreateCustomRequestDto, EstimateRequestDto } from '@forgea/validation';
import { REQUEST_QUANTITY_MAX } from '@forgea/validation/constants';
import { useState } from 'react';
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useRouteLoaderData,
} from 'react-router';
import { Busy } from '~/components/brand/busy';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Button, buttonClass } from '~/components/ui/button';
import {
  Field,
  FormAlert,
  SelectField,
  TextAreaField,
} from '~/components/ui/field';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { seoMeta, siteOrigin } from '~/features/seo/seo';
import { text } from '~/features/admin/staff.server';
import { type FieldErrors, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import { readUploadForm } from '~/lib/upload-guard.server';
import type { loader as rootLoader } from '~/root';
import type { Route } from './+types/route';
import { RequestFile } from './request-file';

export function meta({ matches }: Route.MetaArgs) {
  return seoMeta({
    origin: siteOrigin(matches),
    path: '/custom',
    title: 'Custom order — Forgea',
    description:
      'Describe what you need or send a 3D file: we quote it and print it in our studio.',
  });
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const materials = await context
    .get(apiContext)
    .get<{ id: string; code: string; name: string }[]>(
      '/custom-requests/materials',
    );
  return {
    materials: materials.ok ? materials.data : [],
    signInUrl: signInFor(url),
  };
}

export type FileResult =
  | { uploaded: UploadedFile; error?: undefined }
  | { uploaded?: undefined; error: string };
export type EstimateResult =
  | { estimate: RequestEstimate | null; error?: undefined }
  | { estimate?: undefined; error: string };

/** upload (a file) | estimate (instant range) | send (the request). */
export async function action({ request, url, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(signInFor(url));
  const form = await readUploadForm(request, api);
  const intent = form.get('intent');

  if (intent === 'upload') {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return data<FileResult>({ error: 'Choose a file' }, { status: 400 });
    }
    const upload = new FormData();
    upload.set('file', file, file.name);
    const r = await api.postForm<UploadedFile>(
      '/custom-requests/files',
      upload,
    );
    return r.ok
      ? data<FileResult>({ uploaded: r.data })
      : data<FileResult>({ error: r.message }, { status: r.status });
  }

  if (intent === 'estimate') {
    const parsed = validateForm(EstimateRequestDto, {
      fileKey: text(form, 'fileKey'),
      materialId: text(form, 'materialId'),
      quantity: text(form, 'quantity'),
    });
    if (!parsed.ok) return data<EstimateResult>({ estimate: null });
    const r = await api.post<{ estimate: RequestEstimate | null }>(
      '/custom-requests/estimate',
      parsed.value,
    );
    return r.ok
      ? data<EstimateResult>({ estimate: r.data.estimate })
      : data<EstimateResult>({ error: r.message }, { status: r.status });
  }

  const parsed = validateForm(CreateCustomRequestDto, {
    title: text(form, 'title'),
    description: text(form, 'description'),
    quantity: text(form, 'quantity'),
    materialId: text(form, 'materialId'),
    colour: text(form, 'colour'),
    fileKey: text(form, 'fileKey'),
  });
  if (!parsed.ok) {
    return data({ errors: parsed.errors, message: undefined }, { status: 400 });
  }
  const r = await api.post<CustomRequestView>('/custom-requests', parsed.value);
  if (r.status === 401) throw redirect(signInFor(url));
  if (!r.ok)
    return data({ errors: {}, message: r.message }, { status: r.status });
  throw redirect(`/requests/${r.data.requestNumber}?sent=1`);
}

export default function CustomOrder({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { materials, signInUrl } = loaderData;
  const root = useRouteLoaderData<typeof rootLoader>('root');
  const user = root?.user ?? null;
  const store = root?.store ?? null;
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const sending = useNavigation().state === 'submitting';
  const errors: FieldErrors =
    actionData && 'errors' in actionData && actionData.errors
      ? actionData.errors
      : {};
  const message =
    actionData && 'message' in actionData ? actionData.message : undefined;

  return (
    <main
      className={`${PAGE_WIDTH} grid gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}
    >
      <header className="grid content-start gap-5">
        <h1 className="max-w-[14ch] font-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.95] font-extrabold tracking-tight text-balance">
          Tell us what to make.
        </h1>
        <p className="max-w-[46ch] text-lg text-text-muted">
          Describe it, or attach a 3D file or a photo. With an STL file you get
          a price range at once; we reply with an exact quote
          {store ? `, valid for ${store.requests.quoteValidityDays} days` : ''}.
          Accept it and we start once the deposit arrives.
        </p>
        {store && (
          <p className="text-sm text-text-muted">
            The deposit is{' '}
            {store.requests.depositRefundable
              ? 'refunded if you cancel before printing starts'
              : 'not refundable once paid'}
            . Questions first?{' '}
            <WhatsAppLink
              phone={store.whatsappPhone}
              message="Hello Forgea! A question before I send a custom request."
              className="underline underline-offset-4"
            >
              Ask us on WhatsApp
            </WhatsAppLink>
            .
          </p>
        )}
      </header>

      {user ? (
        <section className="grid content-start gap-6 rounded-lg bg-surface p-5 sm:p-8">
          <RequestFile
            fileKey={fileKey}
            onFileKey={setFileKey}
            materialId={materialId}
            quantity={quantity}
            maxMb={store?.requests.customUploadMaxMb ?? null}
            autoQuote={store?.requests.autoQuoteSlicedFiles ?? false}
          />
          <Form method="post" className="grid gap-5" noValidate>
            <input type="hidden" name="intent" value="send" />
            <input type="hidden" name="fileKey" value={fileKey ?? ''} />
            <FormAlert message={message} />
            <Field
              label="What is it?"
              name="title"
              required
              placeholder="e.g. Wall bracket for a router"
              error={errors['title']}
            />
            <TextAreaField
              label="Describe it"
              name="description"
              required
              rows={5}
              error={errors['description']}
              hint="Size, what it's for, where it goes, anything it must fit."
            />
            <div className="grid gap-5 sm:grid-cols-3">
              <Field
                label="How many"
                name="quantity"
                type="number"
                min={1}
                max={REQUEST_QUANTITY_MAX}
                value={quantity}
                onChange={(e) => setQuantity(e.currentTarget.value)}
                error={errors['quantity']}
              />
              <SelectField
                label="Material"
                name="materialId"
                value={materialId}
                onChange={(e) => setMaterialId(e.currentTarget.value)}
                error={errors['materialId']}
              >
                <option value="">You choose</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </SelectField>
              <Field
                label="Colour (optional)"
                name="colour"
                error={errors['colour']}
              />
            </div>
            <Button
              type="submit"
              disabled={sending}
              className="justify-self-start px-6 py-3 text-base"
            >
              {sending ? <Busy label="Sending…" /> : 'Send request'}
            </Button>
          </Form>
        </section>
      ) : (
        <section className="grid content-start gap-4 rounded-lg bg-surface p-8">
          <h2 className="font-display text-2xl font-bold">
            Sign in to send a request
          </h2>
          <p className="text-text-muted">
            We need a way to send you the quote and follow your order. It takes
            a minute.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to={signInUrl}
              className={buttonClass('primary', 'px-6 py-3')}
            >
              Sign in or create an account
            </Link>
            <Link to="/contact" className="underline underline-offset-4">
              Just tell us your idea, no account needed
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
