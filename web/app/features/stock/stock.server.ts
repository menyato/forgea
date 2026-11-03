import type {
  MaterialView,
  StockItemView,
  StockOverview,
  StockPrintable,
} from '@forgea/types';
import {
  ReceiveSpoolsDto,
  StockCountDto,
  StudioPrintDto,
} from '@forgea/validation';
import { checked, save, text } from '~/features/admin/staff.server';
import type { ApiClient } from '~/lib/api-client.server';
import { coloursFrom } from './stock-ui';

/** The stock overview (every line, the latest movements), or the API's refusal. */
export async function stockOverview(api: ApiClient, query = '') {
  const r = await api.get<StockOverview>(`/stock${query}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return r.data;
}

/** The line `?line=` names, when it does and it exists. */
const lineOf = (items: readonly StockItemView[], url: URL) => {
  const id = url.searchParams.get('line');
  return (id && items.find((i) => i.id === id)) || null;
};

/** What the spools-received and weighing pages choose from. */
export async function shelfChoices(api: ApiClient, url: URL) {
  const [stock, materials, printables] = await Promise.all([
    stockOverview(api),
    api.get<MaterialView[]>('/materials'),
    // Only for those who record stock (stock.manage); others just read the page.
    api.get<StockPrintable[]>('/stock/printables'),
  ]);
  if (!materials.ok)
    throw new Response(materials.message, { status: materials.status });
  const line = lineOf(stock.items, url);
  return {
    materials: materials.data.filter((m) => m.active),
    colours: coloursFrom(printables.ok ? printables.data : [], stock.items),
    items: stock.items,
    canBook: stock.canBookPurchases,
    line,
    start: line ? { materialId: line.material.id, colour: line.colour } : null,
  };
}

export async function receiveSpools(api: ApiClient, form: FormData) {
  return save(
    ReceiveSpoolsDto,
    {
      materialId: text(form, 'materialId'),
      colour: text(form, 'colour') ?? '',
      spools: text(form, 'spools'),
      spoolGrams: text(form, 'spoolGrams'),
      pricePerSpool: text(form, 'pricePerSpool'),
      paidFrom: text(form, 'paidFrom'),
      updateCost: checked(form, 'updateCost'),
      note: text(form, 'note'),
    },
    (dto) => api.post('/stock/receipts', dto),
  );
}

/** Printed for the studio, or a failed print (as far as it got). */
export async function studioPrint(
  api: ApiClient,
  form: FormData,
  failed: boolean,
) {
  return save(
    StudioPrintDto,
    {
      productId: text(form, 'productId'),
      size: text(form, 'size'),
      colour: text(form, 'colour'),
      quantity: text(form, 'quantity'),
      progressPercent: failed ? text(form, 'progressPercent') : undefined,
      note: text(form, 'note'),
    },
    (dto) =>
      api.post(failed ? '/stock/failed-prints' : '/stock/studio-prints', dto),
  );
}

export async function weighSpools(api: ApiClient, form: FormData) {
  return save(
    StockCountDto,
    {
      materialId: text(form, 'materialId'),
      colour: text(form, 'colour') ?? '',
      gramsOnShelf: text(form, 'gramsOnShelf'),
      note: text(form, 'note'),
    },
    (dto) => api.post('/stock/counts', dto),
  );
}

/** What the studio-print and failed-print pages choose from. */
export async function printChoices(api: ApiClient, url: URL) {
  const printables = await api.get<StockPrintable[]>('/stock/printables');
  const list = printables.ok ? printables.data : [];
  const line = url.searchParams.has('line')
    ? lineOf((await stockOverview(api)).items, url)
    : null;
  return { printables: list, line };
}
