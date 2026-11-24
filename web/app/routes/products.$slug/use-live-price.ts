import type { DesignMeasurement } from '@forgea/types';
import { useCallback, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';

/**
 * A designed piece's price, from the API, a moment after the design settles: priced from what
 * the browser built for its preview, so the server does no geometry while the customer edits.
 * If the preview can't build it (no WebGL, an old browser), the API builds it after a short
 * wait.
 */
export function useLivePrice(designJson: string, ready: boolean) {
  // What the preview built (in this browser), for the design it was built from.
  const [measured, setMeasured] = useState<{
    design: string;
    json: string;
  } | null>(null);
  const onMeasured = useCallback(
    (design: string, m: DesignMeasurement) =>
      setMeasured({ design, json: JSON.stringify(m) }),
    [],
  );
  const measuredJson = measured?.design === designJson ? measured.json : null;

  const pricing = useFetcher<{ unitPrice?: string; error?: string }>();
  const { submit: requestPrice } = pricing;
  // The design the latest answer is for: until the current one is priced, it shows as updating.
  const [pricedFor, setPricedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () => {
        setPricedFor(designJson);
        void requestPrice(
          {
            options: '[]',
            design: designJson,
            ...(measuredJson ? { measured: measuredJson } : {}),
          },
          { method: 'post' },
        );
      },
      measuredJson ? 250 : 2500,
    );
    return () => clearTimeout(timer);
  }, [requestPrice, designJson, measuredJson, ready]);
  const stale = pricedFor !== designJson || pricing.state !== 'idle';
  return {
    onMeasured,
    measuredJson,
    stale,
    price: ready && pricing.data?.unitPrice ? pricing.data.unitPrice : null,
    // A refusal counts only for the design on screen (the next change may fix it).
    error: ready && !stale ? pricing.data?.error : undefined,
  };
}
