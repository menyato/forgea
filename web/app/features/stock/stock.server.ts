import { randomUUID } from 'node:crypto';
import type {
  MaterialView,
  StockItemView,
  StockOverview,
  StockPrintable,
} from '@forgea/types';
import {
  ReceiveSpoolsDto,
  SaveMaterialDto,
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
    // A fresh one-time key each time the page loads (after a save too).
    requestKey: randomUUID(),
    materials: materials.data.filter((m) => m.active),
    colours: coloursFrom(printables.ok ? printables.data : [], stock.items),
    items: stock.items,
    canBook: stock.canBookPurchases,
    line,
    start: line ? { materialId: line.material.id, colour: line.colour } : null,
  };
}

/**
 * Spools received. For a material the shop doesn't have yet, the material is made first (named
 * as typed, its code from its name, its cost per gram from these spools), then they go on its
 * shelf; a refusal of the material shows as the form's own errors.
 */
export async function receiveSpools(api: ApiClient, form: FormData) {
  let materialId = text(form, 'materialId');
  if (materialId === 'new') {
    const name = text(form, 'newMaterialName') ?? '';
    let made: MaterialView | undefined;
    const refused = await save(
      SaveMaterialDto,
      {
        name,
        code: name
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 20),
        reelPrice: text(form, 'pricePerSpool'),
        reelGrams: text(form, 'spoolGrams'),
        densityGPerCm3: text(form, 'newMaterialDensity'),
        // How fast it prints is the shop's usual until the owner sets it (Materials page).
        gramsPerHour: '12',
        stockGrams: 0,
        lowStockThresholdGrams: 500,
        active: true,
      },
      async (dto) => {
        const r = await api.post<MaterialView>('/materials', dto);
        if (r.ok) made = r.data;
        return r;
      },
    );
    if (!made) return refused;
    materialId = made.id;
  }
  return save(
    ReceiveSpoolsDto,
    {
      materialId,
      colour: text(form, 'colour') ?? '',
      hex: text(form, 'hex'),
      spools: text(form, 'spools'),
      spoolGrams: text(form, 'spoolGrams'),
      pricePerSpool: text(form, 'pricePerSpool'),
      paidFrom: text(form, 'paidFrom'),
      updateCost: checked(form, 'updateCost'),
      note: text(form, 'note'),
      requestKey: text(form, 'requestKey'),
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
      // A recoloured piece: each part with the colour it was printed in.
      parts: form.getAll('part').map((part, i) => ({
        part: String(part),
        colour: String(form.getAll('partColour')[i] ?? ''),
      })),
      quantity: text(form, 'quantity'),
      progressPercent: failed ? text(form, 'progressPercent') : undefined,
      toShelf: failed ? undefined : form.get('toShelf') === 'on',
      // Still on the printer: it waits on the "Where it is" board.
      printing: failed ? undefined : form.get('printing') === 'on',
      printedOn: text(form, 'printedOn'),
      note: text(form, 'note'),
      requestKey: text(form, 'requestKey'),
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
      hex: text(form, 'hex'),
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
  return {
    requestKey: randomUUID(),
    printables: list,
    line,
  };
}
