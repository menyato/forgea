export { unlessAsking as shouldRevalidate } from '~/lib/revalidate';
import type {
  AdminProduct,
  AdminProductListItem,
  CategoryView,
  MaterialView,
  ModelFileInfo,
  OptionGroupView,
  Page,
  PricePreview,
  PrintFilesTotal,
  ProductRealCost,
  ProfitKind,
  UploadedFile,
  FontView,
  LogoDetail,
  LogoView,
} from '@forgea/types';
import {
  ModelInfoDto,
  PricePreviewDto,
  PrintFilesDto,
  SaveProductDto,
} from '@forgea/validation';
import { data, Form, redirect } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader, ViewOnly } from '~/features/admin/admin-ui';
import { checked, saveNew, text } from '~/features/admin/staff.server';
import { jsonField, validateForm } from '~/lib/forms.server';
import type { ApiClient } from '~/lib/api-client.server';
import { allPages } from '~/lib/all-pages.server';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import { filamentChoices } from '~/features/production/choices.server';
import type { Route } from './+types/route';
import { ProductForm } from './product-form';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const isNew = params.id === 'new';
  const [
    product,
    categories,
    materials,
    groups,
    list,
    pricing,
    realCost,
    stock,
    fonts,
    logos,
  ] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : api.get<AdminProduct>(
          `/products/manage/${encodeURIComponent(params.id)}`,
        ),
    api.get<CategoryView[]>('/categories/manage'),
    api.get<MaterialView[]>('/materials'),
    api.get<OptionGroupView[]>('/option-groups'),
    allPages<AdminProductListItem>(
      api,
      '/products/manage?limit=100&sort=name&order=asc',
    ),
    // The shop's profit rule: only for whoever manages pricing (others get 403).
    api.get<{ cost: { profit: { kind: ProfitKind; value: string } } }>(
      '/pricing/settings',
    ),
    // What its pieces really cost: only for whoever runs production (others get 403).
    isNew
      ? Promise.resolve(null)
      : api.get<ProductRealCost>(
          `/print-jobs/products/${encodeURIComponent(params.id)}/cost`,
        ),
    // The filaments on the shelf (others get 403 and no list).
    filamentChoices(api),
    // Text and logos added to the model: the fonts, and the logos as they print.
    api.get<FontView[]>('/fonts'),
    api
      .get<LogoView[]>('/logos')
      .then(async (r) =>
        r.ok
          ? (
              await Promise.all(
                r.data.map((l) =>
                  api.get<LogoDetail>(`/logos/${encodeURIComponent(l.id)}`),
                ),
              )
            ).flatMap((d) => (d.ok ? [d.data] : []))
          : [],
      ),
  ]);
  if (product && !product.ok)
    throw new Response(product.message, { status: product.status });
  for (const r of [categories, materials, groups]) {
    if (!r.ok) throw new Response(r.message, { status: r.status });
  }
  return {
    product: product?.ok ? product.data : null,
    categories: categories.ok ? categories.data : [],
    materials: materials.ok ? materials.data : [],
    groups: groups.ok ? groups.data : [],
    shopProfit: pricing.ok ? pricing.data.cost.profit : null,
    realCost: realCost?.ok ? realCost.data : null,
    // The filaments on the shelf a colour may be printed from (none for someone who can't
    // see the stock).
    filaments: stock.filter((i) => i.colour !== ''),
    fonts: fonts.ok ? fonts.data.filter((f) => f.active) : [],
    logos,
    others: list
      .filter((p) => p.id !== params.id)
      .map((p) => ({ id: p.id, name: p.name })),
  };
}

export type UploadResult =
  | { uploaded: UploadedFile; error?: undefined }
  | { uploaded?: undefined; error: string };

export type PrintFilesResult =
  | { total: PrintFilesTotal; error?: undefined }
  | { total?: undefined; error: string };

export type ModelInfoResult =
  | { info: ModelFileInfo; error?: undefined }
  | { info?: undefined; error: string };

/** upload-model | upload-image | model-info | print-files | preview | duplicate | save */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');

  if (intent === 'duplicate') return duplicate(api, params.id);

  // What the product would sell at, while it is being edited (the API prices it).
  if (intent === 'preview') {
    const parsed = validateForm(PricePreviewDto, {
      materialId: text(form, 'materialId'),
      grams: text(form, 'grams'),
      printHours: text(form, 'printHours'),
      ...(jsonField(form, 'text') ? { text: jsonField(form, 'text') } : {}),
      profitKind: text(form, 'profitKind'),
      profitValue: text(form, 'profitValue'),
      priceOverride: text(form, 'priceOverride'),
      colours: jsonField(form, 'colours') ?? undefined,
      modelFileKey: text(form, 'modelFileKey'),
      printFileKeys: jsonField(form, 'printFileKeys') ?? undefined,
      extraCosts: jsonField(form, 'extraCosts') ?? undefined,
      priceLinesOff: jsonField(form, 'priceLinesOff') ?? undefined,
    });
    if (!parsed.ok) return data({ preview: null }, { status: 400 });
    const r = await api.post<PricePreview>(
      '/products/price-preview',
      parsed.value,
    );
    return r.ok
      ? { preview: r.data }
      : data({ preview: null }, { status: r.status });
  }

  // What an uploaded 3MF says: size, grams per colour and print time (read by the API).
  if (intent === 'model-info') {
    const parsed = validateForm(ModelInfoDto, {
      key: text(form, 'key'),
      materialId: text(form, 'materialId'),
      solidityPercent: text(form, 'solidityPercent'),
    });
    if (!parsed.ok) {
      return data<ModelInfoResult>(
        { error: Object.values(parsed.errors)[0] ?? 'Check the file' },
        { status: 400 },
      );
    }
    const r = await api.post<ModelFileInfo>(
      '/products/model-info',
      parsed.value,
    );
    return r.ok
      ? data<ModelInfoResult>({ info: r.data })
      : data<ModelInfoResult>({ error: r.message }, { status: r.status });
  }

  // The product's sliced print files, read and added up by the API.
  if (intent === 'print-files') {
    const parsed = validateForm(PrintFilesDto, {
      files: jsonField(form, 'files') ?? [],
      materialId: text(form, 'materialId'),
    });
    if (!parsed.ok) {
      return data<PrintFilesResult>(
        { error: Object.values(parsed.errors)[0] ?? 'Check the files' },
        { status: 400 },
      );
    }
    const r = await api.post<PrintFilesTotal>(
      '/products/print-files',
      parsed.value,
    );
    return r.ok
      ? data<PrintFilesResult>({ total: r.data })
      : data<PrintFilesResult>({ error: r.message }, { status: r.status });
  }

  if (intent === 'upload-model' || intent === 'upload-image') {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return data<UploadResult>({ error: 'Choose a file' }, { status: 400 });
    }
    const upload = new FormData();
    upload.set('file', file, file.name);
    const r = await api.postForm<UploadedFile>(
      intent === 'upload-model'
        ? '/uploads/product-model'
        : '/uploads/product-image',
      upload,
    );
    return r.ok
      ? data<UploadResult>({ uploaded: r.data })
      : data<UploadResult>({ error: r.message }, { status: r.status });
  }

  const isNew = params.id === 'new';
  return saveNew(
    SaveProductDto,
    {
      slug: text(form, 'slug'),
      name: text(form, 'name'),
      description: text(form, 'description'),
      designer: text(form, 'designer'),
      categoryId: text(form, 'categoryId'),
      materialId: text(form, 'materialId'),
      grams: text(form, 'grams'),
      printHours: text(form, 'printHours'),
      // Absent = a regular product: the API clears the text settings.
      text: jsonField(form, 'text'),
      isCustom: checked(form, 'isCustom'),
      active: checked(form, 'active'),
      studioOnly: checked(form, 'studioOnly'),
      modelFileKey: text(form, 'modelFileKey'),
      imageKeys: jsonField(form, 'imageKeys') ?? [],
      options: jsonField(form, 'options') ?? [],
      sizeXcm: text(form, 'sizeXcm'),
      sizeYcm: text(form, 'sizeYcm'),
      sizeZcm: text(form, 'sizeZcm'),
      sizes: jsonField(form, 'sizes') ?? [],
      colours: jsonField(form, 'colours') ?? [],
      printFiles: jsonField(form, 'printFiles') ?? [],
      partColourGroupId: text(form, 'partColourGroupId'),
      slots: jsonField(form, 'slots') ?? [],
      profitKind: text(form, 'profitKind'),
      profitValue: text(form, 'profitValue'),
      priceOverride: text(form, 'priceOverride'),
      extraCosts: jsonField(form, 'extraCosts') ?? [],
      priceLinesOff: jsonField(form, 'priceLinesOff') ?? [],
    },
    (dto) =>
      isNew
        ? api.post<AdminProduct>('/products', dto)
        : api.put<AdminProduct>(
            `/products/${encodeURIComponent(params.id)}`,
            dto,
          ),
    // A new product gets its own address, so reloading the page edits it instead of copying it.
    (saved) => (isNew ? `/admin/products/${saved.id}` : null),
  );
}

/**
 * A copy to start a similar product from: everything (sizes and options included), hidden from
 * the shop, under "<name> (copy)" and a free web address. Opens the copy.
 */
async function duplicate(api: ApiClient, id: string) {
  const source = await api.get<AdminProduct>(
    `/products/manage/${encodeURIComponent(id)}`,
  );
  if (!source.ok) throw new Response(source.message, { status: source.status });
  const p = source.data;
  // -copy, -copy-2 … -copy-20, then a unique one: a product copied many times still copies.
  const slugFor = (n: number) =>
    n <= 20
      ? `${p.slug.slice(0, 70)}-copy${n > 1 ? `-${n}` : ''}`
      : `${p.slug.slice(0, 60)}-copy-${Date.now().toString(36)}${n}`;
  for (let n = 1; n <= 22; n++) {
    const created = await api.post<AdminProduct>('/products', {
      slug: slugFor(n),
      name: `${p.name} (copy)`.slice(0, 120),
      description: p.description,
      ...(p.categoryId ? { categoryId: p.categoryId } : {}),
      materialId: p.materialId,
      grams: p.grams,
      printHours: p.printHours,
      isCustom: p.isCustom,
      ...(p.designer ? { designer: p.designer } : {}),
      active: false,
      studioOnly: p.studioOnly,
      ...(p.modelFileKey ? { modelFileKey: p.modelFileKey } : {}),
      imageKeys: p.imageKeys,
      options: p.options,
      ...(p.size
        ? { sizeXcm: p.size.x, sizeYcm: p.size.y, sizeZcm: p.size.z }
        : {}),
      sizes: p.sizes.map((s) => ({
        label: s.label,
        sizeXcm: s.size.x,
        sizeYcm: s.size.y,
        sizeZcm: s.size.z,
        grams: s.grams,
        printHours: s.printHours,
        isDefault: s.isDefault,
      })),
      colours: p.colours,
      printFiles: p.printFiles.map((f) => ({ key: f.fileKey, name: f.name })),
      ...(p.partColourGroupId
        ? { partColourGroupId: p.partColourGroupId }
        : {}),
      slots: p.slots,
      // Everything that makes it what it is: its personalised text, and (shown only to whoever
      // manages pricing, so only theirs) its own profit, price and extra costs.
      ...(p.text ? { text: p.text } : {}),
      ...(p.profit
        ? { profitKind: p.profit.kind, profitValue: p.profit.value }
        : {}),
      ...(p.priceOverride ? { priceOverride: p.priceOverride } : {}),
      extraCosts: p.extraCosts,
      priceLinesOff: p.priceLinesOff,
    });
    if (created.ok) throw redirect(`/admin/products/${created.data.id}`);
    // The address is taken: try the next one.
    if (created.status !== 409) {
      throw new Response(created.message, { status: created.status });
    }
  }
  throw new Response('Too many copies of this product already', {
    status: 409,
  });
}

export default function EditProduct({ loaderData }: Route.ComponentProps) {
  const { product } = loaderData;
  const editable = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Products', to: '/admin/products' }]}
        title={product ? product.name : 'New product'}
        intro="Upload the model (STL, GLB, or a Bambu Studio 3MF with its colours) to see it in 3D and get its grams and print time, then its sizes and the options customers can pick."
        action={
          product && editable ? (
            <Form method="post">
              <input type="hidden" name="intent" value="duplicate" />
              <button type="submit" className={buttonClass('secondary')}>
                Duplicate
              </button>
            </Form>
          ) : undefined
        }
      />
      <ViewOnly editable={editable}>
        <ProductForm key={product?.id ?? 'new'} {...loaderData} />
      </ViewOnly>
      {product && (
        <div className="mt-8 border-t border-border pt-4">
          <DeleteRecord kind="product" id={product.id} what={'this product'} />
        </div>
      )}
    </>
  );
}
