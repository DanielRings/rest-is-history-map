/**
 * Piecewise-linear scale tests: pixel ↔ year round-trip across anchor years
 * and sampled mid-segment positions. Tolerance is 0.5 px (sub-pixel; the
 * scrubber rounds to integer years on output).
 */

import { describe, expect, it } from "vitest";

import {
  TIMELINE_BOUNDS,
  TIMELINE_TICKS,
  clampWindow,
  pxToYear,
  yearToPx,
} from "../src/timeline/scale";

const WIDTH = 1000;

describe("yearToPx / pxToYear round-trip", () => {
  it("round-trips each anchor year", () => {
    for (const y of TIMELINE_TICKS) {
      const px = yearToPx(y, WIDTH);
      const y2 = pxToYear(px, WIDTH);
      expect(Math.abs(y - y2)).toBeLessThan(0.5);
    }
  });

  it("round-trips sampled mid-segment years", () => {
    const samples = [-2000, -100, 100, 1000, 1700, 1900, 2010];
    for (const y of samples) {
      const px = yearToPx(y, WIDTH);
      const y2 = pxToYear(px, WIDTH);
      expect(Math.abs(y - y2)).toBeLessThan(0.5);
    }
  });

  it("yearToPx(0) lies strictly between yearToPx(-1) and yearToPx(1)", () => {
    const before = yearToPx(-1, WIDTH);
    const at = yearToPx(0, WIDTH);
    const after = yearToPx(1, WIDTH);
    expect(at).toBeGreaterThan(before);
    expect(at).toBeLessThan(after);
  });

  it("clamps inputs outside bounds", () => {
    expect(yearToPx(-5000, WIDTH)).toBe(yearToPx(TIMELINE_BOUNDS.min, WIDTH));
    expect(yearToPx(5000, WIDTH)).toBe(yearToPx(TIMELINE_BOUNDS.max, WIDTH));
  });

  it("pxToYear at endpoints returns the bounds", () => {
    expect(pxToYear(0, WIDTH)).toBeCloseTo(TIMELINE_BOUNDS.min, 0);
    expect(pxToYear(WIDTH, WIDTH)).toBeCloseTo(TIMELINE_BOUNDS.max, 0);
  });

  it("pxToYear throws when width is non-positive", () => {
    expect(() => pxToYear(0, 0)).toThrow();
  });
});

describe("clampWindow", () => {
  it("normalises reversed start/end", () => {
    const w = clampWindow({ start: 500, end: -500 });
    expect(w.start).toBeLessThan(w.end);
  });

  it("clamps to global bounds", () => {
    const w = clampWindow({ start: -9999, end: 9999 });
    expect(w.start).toBe(TIMELINE_BOUNDS.min);
    expect(w.end).toBe(TIMELINE_BOUNDS.max);
  });

  it("guarantees start < end even when caller passes equal years", () => {
    const w = clampWindow({ start: 1500, end: 1500 });
    expect(w.start).toBeLessThan(w.end);
  });
});
