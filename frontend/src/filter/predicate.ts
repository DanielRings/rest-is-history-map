/**
 * Filter predicate — single source of truth.
 *
 * Pure functions; no DOM, no MapLibre, no store. The map, sidebar, and
 * choropleth all derive what they show by passing the current `TimeWindow`
 * and `visibleCountries` set through these predicates.
 */

import type { Episode } from "../data/episodes";

/** A closed interval of years on the timeline axis. */
export interface TimeWindow {
  /** Inclusive start year (negative = BC). */
  start: number;
  /** Inclusive end year. */
  end: number;
}

/**
 * Whether an episode's [year_start, year_end] interval overlaps the window.
 *
 * Touching endpoints count as overlap (e.g. an episode ending in year 1500
 * matches a window starting at 1500).
 */
export function timelineOverlaps(
  ep: Pick<Episode, "year_start" | "year_end">,
  w: TimeWindow,
): boolean {
  return ep.year_start <= w.end && ep.year_end >= w.start;
}

/**
 * Whether the episode should be lit on the map: timeline-overlapping AND
 * tagged to at least one country currently in the viewport.
 *
 * Episodes with no countries (interviews, meta) are never map-visible.
 */
export function mapVisible(
  ep: Episode,
  w: TimeWindow,
  visibleCountries: ReadonlySet<string>,
): boolean {
  if (!timelineOverlaps(ep, w)) return false;
  if (ep.countries.length === 0) return false;
  for (const iso3 of ep.countries) {
    if (visibleCountries.has(iso3)) return true;
  }
  return false;
}

/**
 * Whether the episode belongs in the sidebar list: timeline-overlapping AND
 * (non-geographic OR map-visible).
 *
 * The "non-geographic" branch is why interviews and meta episodes still
 * appear in the list even when the map is fully zoomed out — they have no
 * country to tie them to.
 */
export function sidebarVisible(
  ep: Episode,
  w: TimeWindow,
  visibleCountries: ReadonlySet<string>,
): boolean {
  if (!timelineOverlaps(ep, w)) return false;
  if (ep.countries.length === 0) return true;
  return mapVisible(ep, w, visibleCountries);
}

/**
 * For each viewport-visible ISO3, count the number of timeline-matching
 * episodes tagged to it. Drives the choropleth fill intensity.
 *
 * @returns Map keyed by ISO3; entries with count 0 are omitted.
 */
export function litCountries(
  eps: readonly Episode[],
  w: TimeWindow,
  visibleCountries: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const ep of eps) {
    if (!timelineOverlaps(ep, w)) continue;
    for (const iso3 of ep.countries) {
      if (!visibleCountries.has(iso3)) continue;
      out.set(iso3, (out.get(iso3) ?? 0) + 1);
    }
  }
  return out;
}
