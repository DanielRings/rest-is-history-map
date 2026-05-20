/**
 * Map factory. Creates a tile-free MapLibre instance, wires hover/click
 * handlers, and exposes a small imperative handle that the app's main
 * wiring uses to drive the choropleth and country focus.
 */

import maplibregl, { type LngLatLike, type Map as MapLibreMap, Popup } from "maplibre-gl";

import { logDisputedNotes } from "./disputed";
import { COUNTRIES_FILL_LAYER, COUNTRIES_SOURCE_ID, buildStyle } from "./style";
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
}

/** Options for {@link createMap}. */
export interface CreateMapOptions {
  container: HTMLElement;
  geojson: CountriesGeoJSON;
  initialCenter: readonly [number, number];
  initialZoom: number;
  onMove: (visible: ReadonlySet<string>, center: [number, number], zoom: number) => void;
  onCountryClick: (iso3: string) => void;
}

/**
 * Construct a map and return once the style + sources are idle so the
 * first viewport snapshot is meaningful.
 */
export async function createMap(opts: CreateMapOptions): Promise<MapHandle> {
  const geojson = opts.geojson;

  const map = new maplibregl.Map({
    container: opts.container,
    style: buildStyle(geojson),
    center: [opts.initialCenter[0], opts.initialCenter[1]],
    zoom: opts.initialZoom,
    minZoom: 0,
    maxZoom: 5.5,
    attributionControl: { compact: true, customAttribution: "© Natural Earth" },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
  });

  // Keep north up; the design treats the map as a flat overview.
  map.touchZoomRotate.disableRotation();

  await mapReady(map);
  logDisputedNotes();

  const popup = new Popup({ closeButton: false, closeOnClick: false, anchor: "bottom" });
  const supportsHover =
    typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

  let hoveredIso3: string | null = null;
  let lastTappedIso3: string | null = null;
  let lastTapAt = 0;
  const tapWindowMs = 1500;
  const litState = new Map<string, number>();

  const setHover = (iso3: string | null, lngLat: LngLatLike | null, name: string | null): void => {
    if (hoveredIso3 === iso3) {
      if (iso3 !== null && lngLat !== null && name !== null) {
        popup.setLngLat(lngLat).setText(name).addTo(map);
      }
      return;
    }
    if (hoveredIso3 !== null) {
      map.setFeatureState({ source: COUNTRIES_SOURCE_ID, id: hoveredIso3 }, { hover: false });
    }
    hoveredIso3 = iso3;
    if (iso3 !== null) {
      map.setFeatureState({ source: COUNTRIES_SOURCE_ID, id: iso3 }, { hover: true });
      if (lngLat !== null && name !== null) {
        popup.setLngLat(lngLat).setText(name).addTo(map);
      }
    } else {
      popup.remove();
    }
  };

  if (supportsHover) {
    map.on("mousemove", COUNTRIES_FILL_LAYER, (e) => {
      const f = e.features?.[0];
      if (f === undefined) return;
      const iso3 = readIso3(f);
      if (iso3 === null) return;
      const props = f.properties as CountryProperties | null;
      const name = props?.ADMIN ?? props?.NAME ?? iso3;
      setHover(iso3, e.lngLat, name);
    });
    map.on("mouseleave", COUNTRIES_FILL_LAYER, () => setHover(null, null, null));
  }

  map.on("click", COUNTRIES_FILL_LAYER, (e) => {
    const f = e.features?.[0];
    if (f === undefined) return;
    const iso3 = readIso3(f);
    if (iso3 === null) return;

    if (!supportsHover) {
      // Mobile: first tap previews, second tap on same iso3 within the
      // tap window commits.
      const now = performance.now();
      if (lastTappedIso3 !== iso3 || now - lastTapAt > tapWindowMs) {
        lastTappedIso3 = iso3;
        lastTapAt = now;
        const props = f.properties as CountryProperties | null;
        const name = props?.ADMIN ?? props?.NAME ?? iso3;
        setHover(iso3, e.lngLat, `${name} · tap again to focus`);
        return;
      }
      lastTappedIso3 = null;
    }
    opts.onCountryClick(iso3);
  });

  map.on("moveend", () => {
    const visible = computeVisibleCountries(map);
    const c = map.getCenter();
    opts.onMove(visible, [c.lng, c.lat], map.getZoom());
  });

  const handle: MapHandle = {
    raw: map,
    setLit: (counts) => {
      // Diff: clear iso3s present last time but not now, write the rest.
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
      // Build dummy MapGeoJSONFeature shapes from the source geojson —
      // bboxFor only reads `geometry`.
      const bbox = bboxFor(matches as never);
      map.fitBounds(bbox, { padding: 40, maxZoom: 5.5, duration: 600 });
    },
    visibleCountries: () => computeVisibleCountries(map),
  };

  // Emit one initial move so callers get a starting viewport snapshot.
  const c = map.getCenter();
  opts.onMove(computeVisibleCountries(map), [c.lng, c.lat], map.getZoom());

  return handle;
}

/**
 * Fetch and minimally narrow a Natural Earth Admin 0 FeatureCollection.
 *
 * Throws on non-OK response or unexpected shape per the project's no-
 * fallback rule.
 */
export async function fetchCountriesGeoJSON(url: string): Promise<CountriesGeoJSON> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetchCountriesGeoJSON: ${response.status} ${response.statusText} for ${url}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { type: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((body as { features: unknown }).features)
  ) {
    throw new Error(`fetchCountriesGeoJSON: response at ${url} is not a FeatureCollection`);
  }
  return body as CountriesGeoJSON;
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
