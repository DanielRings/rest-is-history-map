/**
 * Filter predicate tests.
 *
 * Covers boundary cases for `timelineOverlaps` and the empty-countries
 * branch for `sidebarVisible`, plus a count check for `litCountries`.
 */

import { describe, expect, it } from "vitest";

import type { Episode } from "../src/data/episodes";
import {
  litCountries,
  mapVisible,
  sidebarVisible,
  timelineOverlaps,
} from "../src/filter/predicate";

function ep(overrides: Partial<Episode> = {}): Episode {
  return {
    guid: "fixture",
    title: "t",
    description: "d",
    pub_date: "2024-01-01T00:00:00Z",
    access: "public",
    countries: ["ITA"],
    year_start: 100,
    year_end: 200,
    date_precision: "year",
    kind: "historical",
    topics: [],
    historical_figures: [],
    links: {},
    ...overrides,
  };
}

describe("timelineOverlaps", () => {
  it("returns true for an episode contained in the window", () => {
    expect(timelineOverlaps(ep({ year_start: 100, year_end: 200 }), { start: 0, end: 500 })).toBe(
      true,
    );
  });

  it("returns true at touching endpoints", () => {
    expect(
      timelineOverlaps(ep({ year_start: 1453, year_end: 1453 }), { start: 1400, end: 1453 }),
    ).toBe(true);
    expect(
      timelineOverlaps(ep({ year_start: 1453, year_end: 1453 }), { start: 1453, end: 1500 }),
    ).toBe(true);
  });

  it("returns false for fully disjoint intervals", () => {
    expect(timelineOverlaps(ep({ year_start: 100, year_end: 200 }), { start: 300, end: 400 })).toBe(
      false,
    );
  });

  it("handles BC ↔ AD spans", () => {
    expect(
      timelineOverlaps(ep({ year_start: -50, year_end: 50 }), { start: -3000, end: -100 }),
    ).toBe(false);
    expect(timelineOverlaps(ep({ year_start: -50, year_end: 50 }), { start: -1, end: 1 })).toBe(
      true,
    );
  });
});

describe("mapVisible / sidebarVisible", () => {
  const visible = new Set(["ITA", "FRA"]);

  it("mapVisible: false for non-geographic episodes", () => {
    expect(mapVisible(ep({ countries: [] }), { start: 0, end: 500 }, visible)).toBe(false);
  });

  it("sidebarVisible: true for non-geographic episodes inside the window", () => {
    expect(sidebarVisible(ep({ countries: [] }), { start: 0, end: 500 }, visible)).toBe(true);
  });

  it("sidebarVisible: false for non-geographic episodes outside the window", () => {
    expect(
      sidebarVisible(
        ep({ countries: [], year_start: 1900, year_end: 2000 }),
        { start: 0, end: 500 },
        visible,
      ),
    ).toBe(false);
  });

  it("mapVisible: true when any country intersects the viewport", () => {
    expect(mapVisible(ep({ countries: ["FRA", "ESP"] }), { start: 0, end: 500 }, visible)).toBe(
      true,
    );
  });

  it("mapVisible: false when no country intersects the viewport", () => {
    expect(mapVisible(ep({ countries: ["ESP"] }), { start: 0, end: 500 }, visible)).toBe(false);
  });
});

describe("litCountries", () => {
  it("counts each timeline-matching, viewport-visible iso3", () => {
    const eps: Episode[] = [
      ep({ guid: "a", countries: ["ITA"], year_start: 100, year_end: 200 }),
      ep({ guid: "b", countries: ["ITA", "FRA"], year_start: 150, year_end: 180 }),
      ep({ guid: "c", countries: ["ESP"], year_start: 100, year_end: 200 }), // not visible
      ep({ guid: "d", countries: ["FRA"], year_start: 1800, year_end: 1900 }), // wrong window
    ];
    const visible = new Set(["ITA", "FRA"]);
    const result = litCountries(eps, { start: 0, end: 500 }, visible);
    expect(result.get("ITA")).toBe(2);
    expect(result.get("FRA")).toBe(1);
    expect(result.has("ESP")).toBe(false);
  });
});
