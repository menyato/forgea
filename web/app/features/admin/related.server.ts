import type { RelatedRecord } from '@forgea/types';
import type { ApiClient } from '~/lib/api-client.server';

/** What this record connects to (the header's Related links); none when it can't be read. */
export async function relatedOf(
  api: ApiClient,
  kind: 'order' | 'quotation' | 'lead' | 'request',
  id: string,
): Promise<RelatedRecord[]> {
  const r = await api.get<RelatedRecord[]>(
    `/related/${kind}/${encodeURIComponent(id)}`,
  );
  return r.ok ? r.data : [];
}

/**
 * One record of a list the API sends whole (categories, materials, fonts, stages…): the
 * list's own refusal, or 404 when it holds no such record.
 */
export async function oneOf<T extends { id: string }>(
  api: ApiClient,
  path: string,
  id: string | undefined,
  what: string,
): Promise<T> {
  const r = await api.get<T[]>(path);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const found = r.data.find((x) => x.id === id);
  if (!found) throw new Response(`No such ${what}`, { status: 404 });
  return found;
}
