/**
 * Tile-free MapLibre style.
 *
 * No external tile provider, no glyphs, no sprites, no symbol layers. The
 * Natural Earth Admin 0 GeoJSON is the only source; choropleth fills are
 * driven by feature-state so per-frame updates touch only the iso3s whose
 * count changed.
 */

import type { GeoJSONSourceSpecification, StyleSpecification } from "maplibre-gl";

import type { CountriesGeoJSON } from "./viewport";

/** Source ID of the Natural Earth GeoJSON source. Public — used by basemap. */
export const COUNTRIES_SOURCE_ID = "ne";
/** Layer ID of the base subdued land fill. */
export const COUNTRIES_FILL_LAYER = "countries-fill";
/** Layer ID of the choropleth lit fill (on top of the base). */
export const COUNTRIES_LIT_LAYER = "countries-fill-lit";
/** Layer ID of the faint always-on country outline. */
export const COUNTRIES_OUTLINE_LAYER = "countries-outline-base";
/** Layer ID of the bold hover-state country outline. */
export const COUNTRIES_HOVER_OUTLINE_LAYER = "countries-outline-hover";

/**
 * Build a MapLibre StyleSpecification that renders the supplied GeoJSON.
 *
 * `promoteId: "ISO_A3_EH"` makes the feature ID equal to the ISO3 code,
 * which lets `setFeatureState({ source, id: iso3 }, ...)` work without a
 * lookup table.
 *
 * @param geojson - Pre-loaded Natural Earth FeatureCollection.
 */
export function buildStyle(geojson: CountriesGeoJSON): StyleSpecification {
  return {
    version: 8,
    name: "rih-tile-free",
    sources: {
      [COUNTRIES_SOURCE_ID]: {
        type: "geojson",
        // MapLibre's GeoJSONSource accepts a FeatureCollection but its types
        // expect a mutable array; our CountriesGeoJSON is readonly, so cast
        // through the source spec type explicitly here.
        data: geojson as unknown as GeoJSONSourceSpecification["data"],
        promoteId: "ISO_A3_EH",
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f5f3ee" },
      },
      {
        id: COUNTRIES_FILL_LAYER,
        type: "fill",
        source: COUNTRIES_SOURCE_ID,
        paint: {
          "fill-color": "#e7e4dc",
          "fill-opacity": 1,
        },
      },
      {
        id: COUNTRIES_LIT_LAYER,
        type: "fill",
        source: COUNTRIES_SOURCE_ID,
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["feature-state", "count"], 0],
            0,
            "#e7e4dc",
            1,
            "#f3c98a",
            5,
            "#e07a3c",
          ],
          "fill-opacity": ["case", [">", ["coalesce", ["feature-state", "count"], 0], 0], 0.9, 0],
        },
      },
      {
        id: COUNTRIES_OUTLINE_LAYER,
        type: "line",
        source: COUNTRIES_SOURCE_ID,
        paint: {
          "line-color": "#c9c3b8",
          "line-width": 0.5,
        },
      },
      {
        id: COUNTRIES_HOVER_OUTLINE_LAYER,
        type: "line",
        source: COUNTRIES_SOURCE_ID,
        paint: {
          "line-color": "#222",
          "line-width": 1.5,
          // feature-state can't be used in `filter`, so gate visibility via
          // line-opacity instead (per MapLibre style spec).
          "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
        },
      },
    ],
  };
}
