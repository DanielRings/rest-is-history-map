/**
 * Viewport helpers: visible-country detection and bbox computation.
 *
 * Both functions are intentionally MapLibre-aware (they read feature
 * geometry from `queryRenderedFeatures`) but never mutate the map. The
 * pure filter predicates that depend on them live in `src/filter/`.
 */

import type { LngLatBoundsLike, Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";

import { COUNTRIES_FILL_LAYER } from "./style";

/** Shape of the Natural Earth Admin 0 properties we care about. */
export interface CountryProperties {
  ISO_A3_EH: string;
  ADMIN?: string;
  NAME?: string;
  NAME_LONG?: string;
}

/** Minimal GeoJSON FeatureCollection typing for the country source. */
export interface CountriesGeoJSON {
  type: "FeatureCollection";
  features: ReadonlyArray<{
    type: "Feature";
    properties: CountryProperties;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }>;
}

/**
 * Walk the rendered country fill layer and return the set of unique ISO3
 * codes currently in the viewport.
 *
 * @param map - The MapLibre map (must have finished loading).
 * @returns Read-only set keyed by ISO_A3_EH.
 */
export function computeVisibleCountries(map: MapLibreMap): ReadonlySet<string> {
  const features = map.queryRenderedFeatures({ layers: [COUNTRIES_FILL_LAYER] });
  const out = new Set<string>();
  for (const f of features) {
    const iso3 = readIso3(f);
    if (iso3 !== null) out.add(iso3);
  }
  return out;
}

/**
 * Compute the bounding box of a group of features, in [west, south, east,
 * north] order — directly usable as `LngLatBoundsLike` for `fitBounds`.
 *
 * @throws If `features` is empty or no feature has a polygon geometry.
 *
 * TODO(W4): naive bbox; ignores antimeridian wrap. Russia's far-east tip
 * and USA Alaska will produce a bbox that crosses the entire globe. Spot-
 * check after first real run; consider splitting features at lon ±180.
 */
export function bboxFor(features: readonly MapGeoJSONFeature[]): LngLatBoundsLike {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let saw = false;
  for (const f of features) {
    const g = f.geometry;
    if (g.type === "Polygon") {
      saw = walkRings(g.coordinates, updateBounds) || saw;
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) saw = walkRings(poly, updateBounds) || saw;
    }
  }
  if (!saw) {
    throw new Error("bboxFor: no polygon coordinates in supplied features");
  }
  return [
    [west, south],
    [east, north],
  ];

  function updateBounds(lon: number, lat: number): void {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
}

/** Read the ISO3 code (ISO_A3_EH) from any feature; null if missing. */
export function readIso3(feature: MapGeoJSONFeature): string | null {
  const props = feature.properties as CountryProperties | null;
  if (props === null) return null;
  const v = props.ISO_A3_EH;
  if (typeof v !== "string" || v.length !== 3) return null;
  return v.toUpperCase();
}

function walkRings(rings: GeoJSON.Position[][], cb: (lon: number, lat: number) => void): boolean {
  let saw = false;
  for (const ring of rings) {
    for (const pt of ring) {
      const lon = pt[0];
      const lat = pt[1];
      if (typeof lon === "number" && typeof lat === "number") {
        cb(lon, lat);
        saw = true;
      }
    }
  }
  return saw;
}
