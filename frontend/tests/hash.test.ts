/**
 * URL-hash encode/decode tests.
 *
 * Round-trip is the load-bearing property; malformed strings return null
 * (not throw) so a stale Discord link doesn't fatally break the page.
 */

import { describe, expect, it } from "vitest";

import { decodeHash, encodeHash, type HashFragment } from "../src/state/hash";

describe("encodeHash / decodeHash", () => {
  it("round-trips a typical fragment", () => {
    const f: HashFragment = {
      window: { start: -3000, end: 2025 },
      mapCenter: [10.123, 20.456],
      mapZoom: 1.5,
    };
    const encoded = encodeHash(f);
    expect(encoded).toMatch(/^#-?\d+,-?\d+\/-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{2}$/);
    const decoded = decodeHash(encoded);
    expect(decoded).not.toBeNull();
    if (decoded === null) return;
    expect(decoded.window.start).toBe(-3000);
    expect(decoded.window.end).toBe(2025);
    expect(decoded.mapCenter[0]).toBeCloseTo(10.123, 2);
    expect(decoded.mapCenter[1]).toBeCloseTo(20.456, 2);
    expect(decoded.mapZoom).toBeCloseTo(1.5, 1);
  });

  it("returns null on empty / missing hash", () => {
    expect(decodeHash("")).toBeNull();
    expect(decodeHash("#")).toBeNull();
  });

  it("returns null on malformed hash", () => {
    expect(decodeHash("#bogus")).toBeNull();
    expect(decodeHash("#1,2,3/4,5,6")).toBeNull();
    expect(decodeHash("#1000/0,0,1")).toBeNull(); // missing tEnd
    expect(decodeHash("#100,50/0,0,1")).toBeNull(); // start >= end
    expect(decodeHash("#-3000,2025/200,0,1")).toBeNull(); // lat out of range
    expect(decodeHash("#-3000,2025/0,0,99")).toBeNull(); // zoom out of range
  });

  it("accepts a hash without a leading #", () => {
    const decoded = decodeHash("-44,14/41.000,12.000,3.50");
    expect(decoded).not.toBeNull();
    if (decoded === null) return;
    expect(decoded.window.start).toBe(-44);
    expect(decoded.window.end).toBe(14);
  });
});
