import type {
  AdminProduct,
  CategoryView,
  MaterialView,
  OptionGroupView,
  UploadedFile,
} from '@forgea/types';
import { SaveProductDto } from '@forgea/validation';
import { data, redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { checked, save, text } from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { ProductForm } from './product-form';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const isNew = params.id === 'new';
  const [product, categories, materials, groups] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : api.get<AdminProduct>(
          `/products/manage/${encodeURIComponent(params.id)}`,
        ),
    api.get<CategoryView[]>('/categories/manage'),
    api.get<MaterialView[]>('/materials'),
    api.get<OptionGroupView[]>('/option-groups'),
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
  };
}

export type UploadResult =
  | { uploaded: UploadedFile; error?: undefined }
  | { uploaded?: undefined; error: string };

/** upload-model | upload-image | save */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');

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

export default function EditProduct({ loaderData }: Route.ComponentProps) {
  const { product } = loaderData;
  return (
    <>
      <AdminHeader
        title={product ? product.name : 'New product'}
        intro="Upload the model to see it in 3D and get suggested grams and print time, then choose the category and the options customers can pick."
      />
      <ProductForm key={product?.id ?? 'new'} {...loaderData} />
    </>
  );
}
