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
