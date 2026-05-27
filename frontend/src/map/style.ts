/**
 * Tile-free MapLibre style.
 *
 * No external tile provider, no glyphs, no sprites, no symbol layers. The
 * Natural Earth Admin 0 GeoJSON is the only source; choropleth fills are
 * driven by feature-state so per-frame updates touch only the iso3s whose
 * count changed.
 */

import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  StyleSpecification,
} from "maplibre-gl";

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

/** Color palette for the MapLibre style. MapLibre styles can't read CSS
 *  custom properties, so the palette is plain JS. */
export interface MapPalette {
  background: string;
  landBase: string;
  /** Four-stop choropleth ramp: [count=0, count=1, count=3, count=5]. */
  litStops: readonly [string, string, string, string];
  /** Always-on country outline. */
  baseOutline: string;
  baseOutlineWidth: number;
  /** Hover outline color + width. */
  hoverOutline: string;
  hoverOutlineWidth: number;
  /** Fixed gold color the hovered country's fill snaps to (replaces the
   *  country's choropleth fill on hover for both lit and unlit countries). */
  goldFill: string;
}

/** Club-gold reference color. Mirrors the Rest Is History Club album-
 *  art gold. The hovered country's fill snaps to this. */
const CLUB_GOLD = "#dba81f";

/** Single map palette. Hovered country renders a flat CLUB_GOLD fill
 *  (both lit and unlit countries) with a matching gold outline. */
export const ANTIQUE_ATLAS_PALETTE: MapPalette = {
  background: "#b1c4d8",
  landBase: "#c8d4b8",
  litStops: ["#c8d4b8", "#a64f38", "#842e1f", "#6a1d12"],
  baseOutline: "#9ca992",
  baseOutlineWidth: 0.5,
  hoverOutline: CLUB_GOLD,
  hoverOutlineWidth: 1.4,
  goldFill: CLUB_GOLD,
};

/**
 * Build a MapLibre StyleSpecification with the supplied palette.
 *
 * `promoteId: "ISO_A3_EH"` makes the feature ID equal to the ISO3 code,
 * which lets `setFeatureState({ source, id: iso3 }, ...)` work without a
 * lookup table.
 *
 * Hover behavior: the hovered country's fill snaps to `palette.goldFill`
 * (covering both lit and unlit countries) at full opacity, with the
 * outline switching to `palette.hoverOutline`.
 */
export function buildStyle(geojson: CountriesGeoJSON, palette: MapPalette): StyleSpecification {
  // MapLibre's style types are tightly typed via nested tuple discriminators;
  // we build expressions as plain arrays and cast to ExpressionSpecification.
  const hoverCond = ["boolean", ["feature-state", "hover"], false] as ExpressionSpecification;
  const ramp = (stops: readonly [string, string, string, string]): ExpressionSpecification =>
    [
      "interpolate",
      ["linear"],
      ["coalesce", ["feature-state", "count"], 0],
      0,
      stops[0],
      1,
      stops[1],
      3,
      stops[2],
      5,
      stops[3],
    ] as ExpressionSpecification;

  // Choropleth fill-color: oxblood ramp normally, flat gold when hovered.
  const litColor = [
    "case",
    hoverCond,
    palette.goldFill,
    ramp(palette.litStops),
  ] as ExpressionSpecification;
  // fill-opacity: 1 when hovered (gold matches outline at full opacity),
  // 0.9 when lit-but-not-hovered (the red ramp was tuned at 0.9), else 0.
  const litOpacity = [
    "case",
    hoverCond,
    1,
    [">", ["coalesce", ["feature-state", "count"], 0], 0],
    0.9,
    0,
  ] as ExpressionSpecification;

  const layers: StyleSpecification["layers"] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": palette.background },
    },
    {
      id: COUNTRIES_FILL_LAYER,
      type: "fill",
      source: COUNTRIES_SOURCE_ID,
      paint: {
        "fill-color": palette.landBase,
        "fill-opacity": 1,
      },
    },
    {
      id: COUNTRIES_LIT_LAYER,
      type: "fill",
      source: COUNTRIES_SOURCE_ID,
      paint: {
        "fill-color": litColor,
        "fill-opacity": litOpacity,
      },
    },
    {
      id: COUNTRIES_OUTLINE_LAYER,
      type: "line",
      source: COUNTRIES_SOURCE_ID,
      paint: {
        "line-color": palette.baseOutline,
        "line-width": palette.baseOutlineWidth,
      },
    },
    {
      id: COUNTRIES_HOVER_OUTLINE_LAYER,
      type: "line",
      source: COUNTRIES_SOURCE_ID,
      paint: {
        "line-color": palette.hoverOutline,
        "line-width": palette.hoverOutlineWidth,
        "line-opacity": ["case", hoverCond, 1, 0],
      },
    },
  ];

  return {
    version: 8,
    name: "rih-tile-free",
    sources: {
      [COUNTRIES_SOURCE_ID]: {
        type: "geojson",
        data: geojson as unknown as GeoJSONSourceSpecification["data"],
        promoteId: "ISO_A3_EH",
      },
    },
    layers,
  };
}
