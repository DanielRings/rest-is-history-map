/**
 * Map factory. Creates a tile-free MapLibre instance, wires hover/click
 * handlers, and exposes a small imperative handle that the app's main
 * wiring uses to drive the choropleth and country focus.
 *
 * Hover and click semantics are emitted as bare events; the caller (main.ts)
 * decides whether a country is "lit" and whether to surface the episode
 * popup or just a name label.
 */

import maplibregl, { type LngLatLike, type Map as MapLibreMap, Popup } from "maplibre-gl";

import { logDisputedNotes } from "./disputed";
import { COUNTRIES_FILL_LAYER, COUNTRIES_SOURCE_ID, type MapPalette, buildStyle } from "./style";
import {
  type CountriesGeoJSON,
  type CountryProperties,
  bboxFor,
  computeVisibleCountries,
  readIso3,
} from "./viewport";

/** Imperative handle returned by {@link createMap}. */
export interface MapHandle {
  /** The underlying MapLibre instance. Exposed for the test-hook code path. */
  readonly raw: MapLibreMap;
  /**
   * Update the choropleth fills. Only iso3s whose count changed since the
   * last call write to feature state.
   */
  setLit: (counts: ReadonlyMap<string, number>) => void;
  /** Fly to and frame a single country by ISO3. */
  flyToCountry: (iso3: string) => void;
  /** Compute the current viewport-visible countries. */
  visibleCountries: () => ReadonlySet<string>;
  /** Project a [lon, lat] to map-container pixel coordinates. */
  project: (lngLat: readonly [number, number]) => { x: number; y: number };
  /** Show the small country-name label popup (used for unlit hovers). */
  showLabel: (lngLat: LngLatLike, text: string) => void;
  /** Hide the small country-name label popup. */
  hideLabel: () => void;
}

/** Country-name label to render in the tiny MapLibre popup for unlit hovers. */
export interface HoverInfo {
  iso3: string;
  lngLat: { lng: number; lat: number };
  name: string;
}

/** Options for {@link createMap}. */
export interface CreateMapOptions {
  container: HTMLElement;
  geojson: CountriesGeoJSON;
  palette: MapPalette;
  initialCenter: readonly [number, number];
  initialZoom: number;
  onMove: (visible: ReadonlySet<string>, center: [number, number], zoom: number) => void;
  /** Pointer entered or left a country (desktop hover only; null = left). */
  onCountryHover: (info: HoverInfo | null) => void;
  /** Click on a country (desktop) or commit-tap on mobile. */
  onCountryClick: (info: HoverInfo) => void;
  /** Click on the map background (not on any country). */
  onMapClick: () => void;
}

/**
 * Construct a map and return once the style + sources are idle so the
 * first viewport snapshot is meaningful.
 */
export async function createMap(opts: CreateMapOptions): Promise<MapHandle> {
  const geojson = opts.geojson;

  const map = new maplibregl.Map({
    container: opts.container,
    style: buildStyle(geojson, opts.palette),
    center: [opts.initialCenter[0], opts.initialCenter[1]],
    zoom: opts.initialZoom,
    // minZoom 1.0 = one world copy is 512px wide. On a 1440 viewport at
    // min zoom you see ~3 copies side-by-side; at zoom 2 it's ~1.5 copies
    // (clean wrap experience). Adjust higher if the multiple-copy view at
    // minimum zoom feels too noisy.
    minZoom: 1.0,
    maxZoom: 5.5,
    attributionControl: { compact: true, customAttribution: "© Natural Earth" },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // Wraps east-west: panning continues seamlessly across the antimeridian
    // by drawing additional world copies.
    renderWorldCopies: true,
  });

  map.touchZoomRotate.disableRotation();

  await mapReady(map);
  logDisputedNotes();

  // Small label popup, used for unlit-country hovers (and the in-between
  // first-tap state on mobile). The rich episode popup is a separate DOM
  // structure created by `country-popup.ts`.
  const labelPopup = new Popup({ closeButton: false, closeOnClick: false, anchor: "bottom" });
  const supportsHover =
    typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

  let hoveredIso3: string | null = null;
  const litState = new Map<string, number>();

  const setHoverOutline = (iso3: string | null): void => {
    if (hoveredIso3 === iso3) return;
    if (hoveredIso3 !== null) {
      map.setFeatureState({ source: COUNTRIES_SOURCE_ID, id: hoveredIso3 }, { hover: false });
    }
    hoveredIso3 = iso3;
    if (iso3 !== null) {
      map.setFeatureState({ source: COUNTRIES_SOURCE_ID, id: iso3 }, { hover: true });
    }
  };

  /** Show the tiny MapLibre name-label popup. Public alias on the handle. */
  const showLabel = (lngLat: LngLatLike, name: string): void => {
    labelPopup.setLngLat(lngLat).setText(name).addTo(map);
  };
  const hideLabel = (): void => {
    labelPopup.remove();
  };

  if (supportsHover) {
    map.on("mousemove", COUNTRIES_FILL_LAYER, (e) => {
      const f = e.features?.[0];
      if (f === undefined) return;
      const iso3 = readIso3(f);
      if (iso3 === null) return;
      const props = f.properties as CountryProperties | null;
      const name = props?.ADMIN ?? props?.NAME ?? iso3;
      setHoverOutline(iso3);
      opts.onCountryHover({ iso3, lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat }, name });
    });
    map.on("mouseleave", COUNTRIES_FILL_LAYER, () => {
      setHoverOutline(null);
      opts.onCountryHover(null);
    });
  }

  // Single click handler covering both layer hits and map-background clicks.
  // Layer-filtered handlers fire first; we use a flag to suppress the
  // background handler when a layer hit already handled the click.
  let lastClickHandled = false;
  map.on("click", COUNTRIES_FILL_LAYER, (e) => {
    const f = e.features?.[0];
    if (f === undefined) return;
    const iso3 = readIso3(f);
    if (iso3 === null) return;
    const props = f.properties as CountryProperties | null;
    const name = props?.ADMIN ?? props?.NAME ?? iso3;
    lastClickHandled = true;
    opts.onCountryClick({ iso3, lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat }, name });
  });
  map.on("click", () => {
    if (lastClickHandled) {
      lastClickHandled = false;
      return;
    }
    opts.onMapClick();
  });

  map.on("moveend", () => {
    const visible = computeVisibleCountries(map);
    const c = map.getCenter();
    opts.onMove(visible, [c.lng, c.lat], map.getZoom());
  });

  const handle: MapHandle = {
    raw: map,
    setLit: (counts) => {
      for (const iso3 of litState.keys()) {
        if (!counts.has(iso3)) {
          map.setFeatureState({ source: COUNTRIES_SOURCE_ID, id: iso3 }, { count: 0 });
        }
      }
      for (const [iso3, count] of counts) {
        if (litState.get(iso3) !== count) {
          map.setFeatureState({ source: COUNTRIES_SOURCE_ID, id: iso3 }, { count });
        }
      }
      litState.clear();
      for (const [k, v] of counts) litState.set(k, v);
    },
    flyToCountry: (iso3) => {
      const matches = geojson.features.filter(
        (f) => f.properties.ISO_A3_EH?.toUpperCase() === iso3,
      );
      if (matches.length === 0) {
        throw new Error(`flyToCountry: no Natural Earth feature for ISO3 ${iso3}`);
      }
      const bbox = bboxFor(matches as never);
      map.fitBounds(bbox, { padding: 40, maxZoom: 5.5, duration: 600 });
    },
    visibleCountries: () => computeVisibleCountries(map),
    project: (lngLat) => {
      const p = map.project([lngLat[0], lngLat[1]]);
      return { x: p.x, y: p.y };
    },
    showLabel,
    hideLabel,
  };

  // Emit one initial move so callers get a starting viewport snapshot.
  const c = map.getCenter();
  opts.onMove(computeVisibleCountries(map), [c.lng, c.lat], map.getZoom());

  return handle;
}

function mapReady(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    if (map.loaded() && map.isStyleLoaded()) {
      resolve();
      return;
    }
    map.once("idle", () => resolve());
  });
}
