import compact from '@forgea/brand/assets/logo-compact.svg?raw';
import mark from '@forgea/brand/assets/logo-mark.svg?raw';
import { useEffect, useRef, useState } from 'react';

const SOURCES = { mark, compact } as const;

/**
 * The logo being 3D printed: it appears from the bottom up, one layer at a time, under the
 * nozzle's copper line. Pure CSS (app.css, `.forgea-print`), so it costs nothing to load.
 *
 * - "loop": keeps printing — a loading indicator (works before JavaScript starts).
 * - "once": prints the first time it scrolls into view, then stays.
 *
 * With reduced motion it is simply the logo. Decorative: give the surrounding text the meaning.
 */
export function PrintingLogo({
  variant = 'mark',
  mode = 'once',
  className = '',
}: {
  variant?: keyof typeof SOURCES;
  mode?: 'loop' | 'once';
  className?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  // Server HTML shows the finished logo; the browser hides it until it can print it.
  const [state, setState] = useState<'shown' | 'waiting' | 'printing'>(
    mode === 'loop' ? 'printing' : 'shown',
  );
  useEffect(() => {
    if (mode === 'loop' || !box.current) return;
    const el = box.current;
    if (el.getBoundingClientRect().top < window.innerHeight) {
      setState('printing');
      return;
    }
    setState('waiting');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('printing');
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  return (
    <span
      ref={box}
      aria-hidden="true"
      data-print={state}
      data-loop={mode === 'loop' ? '' : undefined}
      className={`forgea-print ${className}`}
    >
      <span
        className="forgea-print-model [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: SOURCES[variant] }}
      />
      <span className="forgea-print-nozzle" />
    </span>
  );
}
