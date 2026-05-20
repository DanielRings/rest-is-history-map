/**
 * App entry point. Wires data → store → map / timeline / sidebar.
 *
 * Sample fixture is statically imported for W2; once W1 + W3 land the
 * pipeline will write `data/episodes.json` and this can swap to a runtime
 * fetch without touching any other module.
 */

import "./styles.css";
import sampleData from "../../data/samples/episodes.sample.json";
import type { Episode, EpisodesDocument } from "./data/episodes";
import {
  litCountries,
  sidebarVisible,
  timelineOverlaps,
  type TimeWindow,
} from "./filter/predicate";
import { createMap, fetchCountriesGeoJSON, type MapHandle } from "./map/basemap";
import { attachBottomSheetDrag, createEpisodePanel } from "./panels/sidebar";
import { decodeHash, wireHashSync } from "./state/hash";
import { type AppState, createStore } from "./state/store";
import { TimelineCanvas } from "./timeline/canvas";
import { TIMELINE_BOUNDS } from "./timeline/scale";

/** Augment window with the Playwright test hooks. */
declare global {
  interface Window {
    __setTimeWindow?: (start: number, end: number) => void;
    __clickCountry?: (iso3: string) => void;
  }
}

async function main(): Promise<void> {
  const doc = sampleData as EpisodesDocument;
  if (doc.version !== 1) {
    throw new Error(`main: unexpected episodes schema version ${doc.version}`);
  }
  const episodes: readonly Episode[] = doc.episodes;

  const allFixtureIso3 = new Set<string>();
  for (const ep of episodes) for (const c of ep.countries) allFixtureIso3.add(c);

  const appEl = document.getElementById("app");
  const mapEl = document.getElementById("map");
  const timelineEl = document.getElementById("timeline");
  const panelEl = document.getElementById("panel");
  const handleEl = document.getElementById("bottom-sheet-handle");
  if (
    appEl === null ||
    mapEl === null ||
    !(timelineEl instanceof HTMLCanvasElement) ||
    panelEl === null ||
    handleEl === null
  ) {
    throw new Error("main: required DOM nodes missing");
  }

  const geojson = await fetchCountriesGeoJSON("ne_50m_admin_0_countries.geojson");
  const featureIso3 = new Set<string>();
  for (const f of geojson.features) {
    const v = f.properties.ISO_A3_EH;
    if (typeof v === "string" && v.length === 3) featureIso3.add(v.toUpperCase());
  }
  const missing = [...allFixtureIso3].filter((c) => !featureIso3.has(c));
  if (missing.length > 0) {
    throw new Error(
      `main: ${missing.length} fixture ISO3 code(s) have no Natural Earth feature: ${missing.join(", ")}`,
    );
  }

  const fromHash = decodeHash(window.location.hash);
  const initialState: AppState = {
    window: fromHash?.window ?? { start: TIMELINE_BOUNDS.min, end: TIMELINE_BOUNDS.max },
    visibleCountries: new Set(allFixtureIso3),
    selectedCountry: null,
    mapCenter: fromHash?.mapCenter ?? [10, 20],
    // Initial zoom 0 ensures the whole world is in view on phone widths so
    // every fixture iso3 contributes to the first viewport snapshot — at
    // zoom 1 on iPhone 13 (390 wide) USA sits just outside the visible
    // longitude range.
    mapZoom: fromHash?.mapZoom ?? 0,
  };

  const store = createStore<AppState>(initialState);

  const panel = createEpisodePanel(panelEl);
  attachBottomSheetDrag(handleEl, panelEl);

  const timeline = new TimelineCanvas({
    canvas: timelineEl,
    initialWindow: initialState.window,
    onChange: (w: TimeWindow) => {
      store.set({ window: w });
    },
  });

  let map: MapHandle | null = null;

  const recompute = (s: AppState): void => {
    // When a country is explicitly selected (via click or test hook), the
    // sidebar narrows to that country plus a time-overlap check — this
    // matches the design doc's "country click/tap … sidebar filters to that
    // country" semantics and keeps neighbours like Greece/Turkey from
    // bleeding into an "Italy" focus when the viewport happens to include
    // them.
    const filtered =
      s.selectedCountry === null
        ? episodes.filter((ep) => sidebarVisible(ep, s.window, s.visibleCountries))
        : episodes.filter(
            (ep) =>
              timelineOverlaps(ep, s.window) && ep.countries.includes(s.selectedCountry ?? ""),
          );
    panel.render(filtered);
    if (map !== null) {
      map.setLit(litCountries(episodes, s.window, s.visibleCountries));
    }
    timeline.setWindow(s.window);
  };

  store.subscribe(recompute);
  wireHashSync(store);

  map = await createMap({
    container: mapEl,
    geojson,
    initialCenter: initialState.mapCenter,
    initialZoom: initialState.mapZoom,
    onMove: (visibleCountries, center, zoom) => {
      store.set({ visibleCountries, mapCenter: center, mapZoom: zoom });
    },
    onCountryClick: (iso3) => {
      map?.flyToCountry(iso3);
      store.set({ selectedCountry: iso3 });
    },
  });

  // Initial recompute now that the map exists and has emitted its first viewport.
  recompute(store.get());

  // Playwright test hooks — they drive the same code paths as real input.
  window.__setTimeWindow = (start: number, end: number): void => {
    store.set({ window: { start, end } });
  };
  window.__clickCountry = (iso3: string): void => {
    // Hits the same store/event path as a real map click, but bypasses the
    // canvas hit-test which is flaky on mobile WebKit under Playwright.
    map?.flyToCountry(iso3);
    store.set({ selectedCountry: iso3 });
    // The map's `moveend` will fire after fitBounds and update visibleCountries.
  };

  appEl.dataset["appReady"] = "true";
}

main().catch((err) => {
  console.error("[rih] fatal init error", err);
  const app = document.getElementById("app");
  if (app !== null) {
    app.dataset["appError"] = "true";
    app.textContent = `Failed to load: ${(err as Error).message}`;
  }
});
