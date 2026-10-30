import type {
  AdminProduct,
  AdminProductListItem,
  CategoryView,
  MaterialView,
  OptionGroupView,
  Page,
  UploadedFile,
} from '@forgea/types';
import { SaveProductDto } from '@forgea/validation';
import { data, Form, redirect } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader, ViewOnly } from '~/features/admin/admin-ui';
import { checked, save, text } from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import type { ApiClient } from '~/lib/api-client.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { ProductForm } from './product-form';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const isNew = params.id === 'new';
  const [product, categories, materials, groups, list] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : api.get<AdminProduct>(
          `/products/manage/${encodeURIComponent(params.id)}`,
        ),
    api.get<CategoryView[]>('/categories/manage'),
    api.get<MaterialView[]>('/materials'),
    api.get<OptionGroupView[]>('/option-groups'),
    api.get<Page<AdminProductListItem>>(
      '/products/manage?limit=100&sort=name&order=asc',
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
    others: list.ok
      ? list.data.items
          .filter((p) => p.id !== params.id)
          .map((p) => ({ id: p.id, name: p.name }))
      : [],
  };
}

export type UploadResult =
  | { uploaded: UploadedFile; error?: undefined }
  | { uploaded?: undefined; error: string };

/** upload-model | upload-image | duplicate | save */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');

  if (intent === 'duplicate') return duplicate(api, params.id);

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
  let createdId: string | undefined;
  const result = await save(
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
      isCustom: checked(form, 'isCustom'),
      active: checked(form, 'active'),
      modelFileKey: text(form, 'modelFileKey'),
      imageKeys: jsonField(form, 'imageKeys') ?? [],
      options: jsonField(form, 'options') ?? [],
      sizeXcm: text(form, 'sizeXcm'),
      sizeYcm: text(form, 'sizeYcm'),
      sizeZcm: text(form, 'sizeZcm'),
      sizes: jsonField(form, 'sizes') ?? [],
    },
    async (dto) => {
      const r = isNew
        ? await api.post<AdminProduct>('/products', dto)
        : await api.put<AdminProduct>(
            `/products/${encodeURIComponent(params.id)}`,
            dto,
          );
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  // A new product gets its own address, so reloading the page edits it instead of copying it.
  if (isNew && createdId) throw redirect(`/admin/products/${createdId}`);
  return result;
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
  for (let n = 1; n <= 20; n++) {
    const created = await api.post<AdminProduct>('/products', {
      slug: `${p.slug}-copy${n > 1 ? `-${n}` : ''}`.slice(0, 80),
      name: `${p.name} (copy)`.slice(0, 120),
      description: p.description,
      ...(p.categoryId ? { categoryId: p.categoryId } : {}),
      materialId: p.materialId,
      grams: p.grams,
      printHours: p.printHours,
      isCustom: p.isCustom,
      ...(p.designer ? { designer: p.designer } : {}),
      active: false,
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
        title={product ? product.name : 'New product'}
        intro="Upload the model to see it in 3D and get suggested grams and print time, then its sizes and the options customers can pick."
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
    </>
  );
}
