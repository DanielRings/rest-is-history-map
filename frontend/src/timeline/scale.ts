/**
 * Piecewise-linear timeline scale.
 *
 * Six anchor years with non-uniform compression: antiquity (the −3000 → −500
 * stretch) is squeezed and the modern era (1800 → 2025) expanded, so the
 * fixture's Bronze Age episodes and 21st-century interviews are both
 * usable on a phone-width axis.
 *
 * Year 0 does not exist in the data (schema forbids it; historians jump
 * from −1 BC straight to AD 1). The axis itself, however, is continuous
 * through 0 — `yearToPx(0)` returns a defined value midway between
 * `yearToPx(-1)` and `yearToPx(1)`.
 */

import type { TimeWindow } from "../filter/predicate";

/** A breakpoint on the piecewise-linear axis. */
interface Anchor {
  /** Calendar year (negative = BC). */
  year: number;
  /** Position along the axis as a fraction in [0, 1]. */
  t: number;
}

/**
 * Anchor table. The `t` values are a hand-tuned designer choice: antiquity
 * compressed, the period 500 → 1800 (where the bulk of fixture episodes
 * cluster) given the largest share, and 1800 → 2025 expanded so modern
 * episodes get touch-targetable room.
 */
const ANCHORS: readonly Anchor[] = [
  { year: -3000, t: 0.0 },
  { year: -500, t: 0.12 },
  { year: 500, t: 0.3 },
  { year: 1500, t: 0.5 },
  { year: 1800, t: 0.7 },
  { year: 2000, t: 0.95 },
  { year: 2025, t: 1.0 },
];

/** Inclusive global bounds of the axis. */
export const TIMELINE_BOUNDS: { readonly min: number; readonly max: number } = {
  min: -3000,
  max: 2025,
};

/** Anchor years exposed to callers that want to draw tick labels.
 *  Year 1 is added as the BC/AD boundary marker and year 1000 as the
 *  millennium marker — neither is a piecewise anchor (the scale already
 *  interpolates through them) but each earns its own tick for readability. */
export const TIMELINE_TICKS: readonly number[] = [...ANCHORS.map((a) => a.year), 1, 1000].sort(
  (a, b) => a - b,
);

/**
 * Convert a calendar year to a horizontal pixel offset.
 *
 * @param year - Calendar year; clamped to `TIMELINE_BOUNDS` before mapping.
 * @param width - Drawable width in CSS pixels.
 * @returns Pixel offset in [0, width].
 */
export function yearToPx(year: number, width: number): number {
  const y = clamp(year, TIMELINE_BOUNDS.min, TIMELINE_BOUNDS.max);
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const lo = ANCHORS[i];
    const hi = ANCHORS[i + 1];
    if (lo === undefined || hi === undefined) {
      throw new Error("yearToPx: ANCHORS underflow");
    }
    if (y >= lo.year && y <= hi.year) {
      const frac = (y - lo.year) / (hi.year - lo.year);
      return width * (lo.t + frac * (hi.t - lo.t));
    }
  }
  throw new Error(`yearToPx: year ${year} fell outside all segments`);
}

/**
 * Inverse of {@link yearToPx}. Maps a pixel offset back to a calendar year.
 *
 * Returns a real number; callers that need an integer year (e.g. the URL
 * hash) should round explicitly.
 *
 * @param px - Pixel offset; clamped to [0, width].
 * @param width - Drawable width in CSS pixels.
 */
export function pxToYear(px: number, width: number): number {
  if (width <= 0) {
    throw new Error("pxToYear: width must be positive");
  }
  const t = clamp(px / width, 0, 1);
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const lo = ANCHORS[i];
    const hi = ANCHORS[i + 1];
    if (lo === undefined || hi === undefined) {
      throw new Error("pxToYear: ANCHORS underflow");
    }
    if (t >= lo.t && t <= hi.t) {
      const frac = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t);
      return lo.year + frac * (hi.year - lo.year);
    }
  }
  throw new Error(`pxToYear: t ${t} fell outside all segments`);
}

/**
 * Clamp a TimeWindow to the global bounds.
 *
 * Used by the URL-hash decoder and by drag handlers. `start === end` is a
 * valid state — it means the timeline is in "year mode" (a single year
 * selected). Callers that want a non-empty range must check explicitly.
 */
export function clampWindow(w: TimeWindow): TimeWindow {
  const start = clamp(Math.min(w.start, w.end), TIMELINE_BOUNDS.min, TIMELINE_BOUNDS.max);
  const end = clamp(Math.max(w.start, w.end), TIMELINE_BOUNDS.min, TIMELINE_BOUNDS.max);
  return { start, end };
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
