import { boardLayout, boardShapes, designProblem } from '@forgea/text3d';
import {
  type BoardItem,
  boardReachMm,
  type Region,
} from '@forgea/text3d/design';
import type { ProductTextOffer, TextDesignInput } from '@forgea/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fontsFor } from './font-set.client';
import { settingsOf } from './text-settings';

/** Within this many mm of the middle, an item snaps to it (and a guide shows). */
const SNAP_MM = 2;

interface Drawn {
  key: string;
  /** The base as it prints (the letter or plaque, the frame behind items, a trophy's foot). */
  base: Region[];
  /** Each item's outline at 0, 0 (turned and sized): moved on screen without reshaping. */
  items: Map<string, { regions: Region[]; box: Box }>;
  /** What the canvas shows (mm, y up): the piece and a margin, kept while dragging. */
  view: Box;
}
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A board piece seen from the front, flat, as it prints: the base in its colour and each item
 * in its own where it was put. Items are dragged (mouse or finger), nudged with the arrow keys
 * (Shift: 5 mm) and snap to the middle across. Made by the same @forgea/text3d code as the 3D
 * preview and the print, so where it is here is where it prints.
 */
export default function BoardCanvas({
  offer,
  design,
  selected,
  onSelect,
  onMove,
  onProblem,
}: {
  offer: ProductTextOffer;
  design: TextDesignInput;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onProblem: (problem: string | null) => void;
}) {
  const settings = useMemo(
    () => settingsOf(offer, design.heightMm),
    [offer, design.heightMm],
  );
  const reach = boardReachMm(settings);
  const key = JSON.stringify(design);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const logos = useMemo(
    () => new Map(offer.logos.map((l) => [l.id, l])),
    [offer.logos],
  );

  useEffect(() => {
    let cancelled = false;
    const d = JSON.parse(key) as TextDesignInput;
    const timer = setTimeout(() => {
      const ids = [
        d.fontId,
        ...(d.accentFontId ? [d.accentFontId] : []),
        ...(d.items ?? []).flatMap((i) => i.fontId ?? []),
      ];
      fontsFor(offer.fonts, ids)
        .then((set) => {
          if (cancelled) return;
          const problem = designProblem(set, d, settings);
          onProblem(problem);
          if (problem) return;
          const layout = boardLayout(set, d, settings, logos);
          const base = layout.parts
            .filter((p) => p.colour === d.textColour && p.z0 <= 0)
            .flatMap((p) => p.regions);
          // Each item at the middle: the screen moves it, so a drag reshapes nothing.
          const still = boardShapes(
            set,
            {
              ...d,
              items: (d.items ?? []).map((i) => ({ ...i, x: 0, y: 0 })),
            },
            settings,
            logos,
          );
          const shapes = new Map(
            still.items.map((i) => [
              i.id,
              { regions: i.regions, box: boxOf(i.regions) },
            ]),
          );
          // The piece and everything on it, square, with room around to drag into.
          const all = boxOf(base);
          for (const i of d.items ?? []) {
            const b = shapes.get(i.id)?.box;
            if (!b) continue;
            all.minX = Math.min(all.minX, i.x + b.minX);
            all.maxX = Math.max(all.maxX, i.x + b.maxX);
            all.minY = Math.min(all.minY, i.y + b.minY);
            all.maxY = Math.max(all.maxY, i.y + b.maxY);
          }
          const half =
            Math.max(all.maxX - all.minX, all.maxY - all.minY) * 0.62;
          const [cx, cy] = [
            (all.minX + all.maxX) / 2,
            (all.minY + all.maxY) / 2,
          ];
          setDrawn((old) => {
            const view = {
              minX: cx - half,
              maxX: cx + half,
              minY: cy - half,
              maxY: cy + half,
            };
            // Small changes keep the frame still (no jumping while editing).
            const keep =
              old &&
              view.minX >= old.view.minX &&
              view.maxX <= old.view.maxX &&
              view.minY >= old.view.minY &&
              view.maxY <= old.view.maxY &&
              old.view.maxX - old.view.minX < (view.maxX - view.minX) * 1.4;
            return { key, base, items: shapes, view: keep ? old.view : view };
          });
        })
        .catch((error: unknown) => {
          if (!cancelled)
            onProblem(error instanceof Error ? error.message : String(error));
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, offer.fonts, settings, logos, onProblem]);

  const hex = useMemo(
    () => new Map(offer.colours.map((c) => [c.id, c.swatchHex ?? '#888888'])),
    [offer.colours],
  );
  const svg = useRef<SVGSVGElement>(null);
  // The item being dragged, where it is now (the page hears of it when it is let go).
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);

  /** A pointer's place in mm, y up. */
  const mmAt = (e: { clientX: number; clientY: number }) => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: -p.y };
  };
  const kept = (x: number, y: number) => {
    const r = Math.hypot(x, y);
    const k = r > reach ? reach / r : 1;
    const sx = Math.abs(x * k) < SNAP_MM ? 0 : x * k;
    return { x: round1(sx), y: round1(y * k) };
  };

  const items = design.items ?? [];
  const at = (item: BoardItem) =>
    drag?.id === item.id ? { x: drag.x, y: drag.y } : item;
  const chosen = items.find((i) => i.id === selected);
  const box = chosen ? drawn?.items.get(chosen.id)?.box : undefined;
  const chosenAt = chosen ? at(chosen) : null;
  // Lines drawn the same width on screen however big the piece is.
  const unit = drawn ? (drawn.view.maxX - drawn.view.minX) / 300 : reach / 150;

  return (
    <svg
      ref={svg}
      viewBox={
        drawn
          ? `${drawn.view.minX} ${-drawn.view.maxY} ${drawn.view.maxX - drawn.view.minX} ${drawn.view.maxY - drawn.view.minY}`
          : `${-reach} ${-reach} ${2 * reach} ${2 * reach}`
      }
      role="application"
      aria-label="Your design, flat: drag each thing where you want it; arrow keys move the one chosen"
      tabIndex={0}
      className="h-full w-full touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-focus-ring"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
      onKeyDown={(e) => {
        if (!chosen) return;
        const step = e.shiftKey ? 5 : 1;
        const move = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step],
        }[e.key];
        if (!move) return;
        e.preventDefault();
        const next = kept(chosen.x + move[0]!, chosen.y + move[1]!);
        onMove(chosen.id, next.x, next.y);
      }}
    >
      {/* The middle across: shown while something sits on it. */}
      {drag && drag.x === 0 && (
        <line
          x1={0}
          x2={0}
          y1={-reach}
          y2={reach}
          className="stroke-accent"
          strokeWidth={unit}
          strokeDasharray={`${unit * 5} ${unit * 5}`}
        />
      )}
      <g transform="scale(1,-1)">
        {drawn && (
          <path
            d={pathOf(drawn.base)}
            fill={hex.get(design.textColour)}
            fillRule="evenodd"
            className="stroke-border"
            strokeWidth={unit * 0.75}
            pointerEvents="none"
          />
        )}
        {[...(drawn?.items ?? [])]
          .filter(([id]) => !items.some((i) => i.id === id))
          .map(([id, shape]) => (
            <path
              key={id}
              d={pathOf(shape.regions)}
              fill={hex.get(design.accentColour ?? design.textColour)}
              fillRule="evenodd"
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={unit * 0.5}
              pointerEvents="none"
            />
          ))}
        {items.map((item) => {
          const shape = drawn?.items.get(item.id);
          if (!shape) return null;
          const p = at(item);
          return (
            <g
              key={item.id}
              transform={`translate(${p.x} ${p.y})`}
              className="cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                const m = mmAt(e);
                if (!m) return;
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                onSelect(item.id);
                setDrag({
                  id: item.id,
                  x: item.x,
                  y: item.y,
                  dx: m.x - item.x,
                  dy: m.y - item.y,
                });
              }}
              onPointerMove={(e) => {
                if (drag?.id !== item.id) return;
                const m = mmAt(e);
                if (!m) return;
                setDrag({ ...drag, ...kept(m.x - drag.dx, m.y - drag.dy) });
              }}
              onPointerUp={() => {
                if (drag?.id !== item.id) return;
                onMove(item.id, drag.x, drag.y);
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
            >
              {/* Easy to grab: the whole box, not only thin strokes of text. */}
              <rect
                x={shape.box.minX}
                y={shape.box.minY}
                width={shape.box.maxX - shape.box.minX}
                height={shape.box.maxY - shape.box.minY}
                fill="transparent"
              />
              <path
                d={pathOf(shape.regions)}
                fill={hex.get(item.colour)}
                fillRule="evenodd"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={unit * 0.5}
              />
            </g>
          );
        })}
        {box && chosenAt && (
          <rect
            x={chosenAt.x + box.minX - 1.5}
            y={chosenAt.y + box.minY - 1.5}
            width={box.maxX - box.minX + 3}
            height={box.maxY - box.minY + 3}
            fill="none"
            className="stroke-accent"
            strokeWidth={unit * 1.2}
            strokeDasharray={`${unit * 3.75} ${unit * 2.5}`}
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function pathOf(regions: readonly Region[]): string {
  const ring = (c: readonly (readonly [number, number])[]) =>
    `M${c.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;
  return regions.map((r) => [r.outer, ...r.holes].map(ring).join('')).join('');
}

function boxOf(regions: readonly Region[]): Box {
  const box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let first = true;
  for (const r of regions)
    for (const [x, y] of r.outer) {
      if (first) {
        Object.assign(box, { minX: x, maxX: x, minY: y, maxY: y });
        first = false;
      }
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y);
      box.maxY = Math.max(box.maxY, y);
    }
  return box;
}
