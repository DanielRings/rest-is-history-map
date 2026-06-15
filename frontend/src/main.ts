/**
 * App entry point. Wires data → store → map / timeline / country popup.
 *
 * Non-geographic episodes (countries == []) are dropped at the data-load
 * boundary. They'll be reintroduced through a different affordance later.
 */

import "./styles.css";
import { type Episode, type EpisodesDocument, loadEpisodes } from "./data/episodes";
import {
  DEFAULT_FILTERS,
  type FilterFlags,
  litCountries,
  passesFilters,
  timelineOverlaps,
  type TimeWindow,
} from "./filter/predicate";
import { createMap, fetchCountriesGeoJSON, type MapHandle } from "./map/basemap";
import { ANTIQUE_ATLAS_PALETTE } from "./map/style";
import { createCountryPopup } from "./panels/country-popup";
import { decodeHash, wireHashSync } from "./state/hash";
import { type AppState, createStore } from "./state/store";
import { TimelineCanvas } from "./timeline/canvas";
import { TIMELINE_BOUNDS, pxToYear, yearToPx } from "./timeline/scale";

declare global {
  interface Window {
    __setTimeWindow?: (start: number, end: number) => void;
    __hoverCountry?: (iso3: string | null) => void;
    __clickCountry?: (iso3: string) => void;
  }
}

async function main(): Promise<void> {
  const doc: EpisodesDocument = await loadEpisodes(`${import.meta.env.BASE_URL}data/episodes.json`);
  // Drop non-geographic episodes — they have nowhere to live in the
  // map-first UI for now. To be reintroduced later through a different
  // affordance.
  const episodes: readonly Episode[] = doc.episodes.filter((ep) => ep.countries.length > 0);

  const allFixtureIso3 = new Set<string>();
  for (const ep of episodes) for (const c of ep.countries) allFixtureIso3.add(c);

  const appEl = document.getElementById("app");
  const mapEl = document.getElementById("map");
  const timelineEl = document.getElementById("timeline");
  if (appEl === null || mapEl === null || !(timelineEl instanceof HTMLCanvasElement)) {
    throw new Error("main: required DOM nodes missing");
  }

  const geojson = await fetchCountriesGeoJSON("ne_50m_admin_0_countries.geojson");
  const featureIso3 = new Set<string>();
  /** Natural Earth label anchor (the designer-chosen visual centroid) and
   *  display name per ISO3. The popup module applies its own pixel-space
   *  nudge so we don't need bbox data here. */
  interface CountryInfo {
    name: string;
    labelLon: number;
    labelLat: number;
  }
  const countryInfo = new Map<string, CountryInfo>();
  for (const f of geojson.features) {
    const props = f.properties;
    const raw = props.ISO_A3_EH;
    if (typeof raw !== "string" || raw.length !== 3) continue;
    const iso3 = raw.toUpperCase();
    featureIso3.add(iso3);
    if (typeof props.LABEL_X !== "number" || typeof props.LABEL_Y !== "number") continue;
    countryInfo.set(iso3, {
      name: props.ADMIN ?? props.NAME ?? iso3,
      labelLon: props.LABEL_X,
      labelLat: props.LABEL_Y,
    });
  }
  const missing = [...allFixtureIso3].filter((c) => !featureIso3.has(c));
  if (missing.length > 0) {
    throw new Error(
      `main: ${missing.length} fixture ISO3 code(s) have no Natural Earth feature: ${missing.join(", ")}`,
    );
  }

  // Pre-index episodes by ISO3 so popup hydration is O(matches) not O(N).
  const episodesByIso3 = new Map<string, Episode[]>();
  for (const ep of episodes) {
    for (const iso3 of ep.countries) {
      const bucket = episodesByIso3.get(iso3) ?? [];
      bucket.push(ep);
      episodesByIso3.set(iso3, bucket);
    }
  }

  const fromHash = decodeHash(window.location.hash);
  const initialState: AppState = {
    window: fromHash?.window ?? { start: TIMELINE_BOUNDS.min, end: TIMELINE_BOUNDS.max },
    visibleCountries: new Set(allFixtureIso3),
    selectedCountry: null,
    mapCenter: fromHash?.mapCenter ?? [10, 20],
    mapZoom: fromHash?.mapZoom ?? 0,
    filters: fromHash?.filters ?? { ...DEFAULT_FILTERS },
  };

  const store = createStore<AppState>(initialState);

  const timeline = new TimelineCanvas({
    canvas: timelineEl,
    initialWindow: initialState.window,
    onChange: (w: TimeWindow) => {
      store.set({ window: w });
    },
  });

  let map: MapHandle | null = null;
  /** Most recent lit-country map; popup uses this to decide if a country
   *  should open the rich popup vs. just a name label. */
  let currentLit: ReadonlyMap<string, number> = new Map();

  /**
   * Episodes for a country whose timeline overlaps the current window and
   * pass the active user filters. Single source of truth for the popup body.
   */
  const episodesForCountry = (
    iso3: string,
    w: TimeWindow,
    f: FilterFlags,
  ): readonly Episode[] => {
    const bucket = episodesByIso3.get(iso3) ?? [];
    return bucket.filter((ep) => passesFilters(ep, f) && timelineOverlaps(ep, w));
  };

  // Lazy reference: the popup is created before the map (map's onMove
  // callback needs `popup.reposition`); project() is invoked only after the
  // map is up and the first interaction fires.
  let mapHandleRef: MapHandle | null = null;
  const popup = createCountryPopup({
    mapContainer: mapEl,
    project: (lon, lat) => mapHandleRef?.project([lon, lat]) ?? { x: 0, y: 0 },
    getAnchor: (iso3) => {
      const info = countryInfo.get(iso3);
      if (info === undefined) return null;
      return { iso3, name: info.name, lon: info.labelLon, lat: info.labelLat };
    },
    getZoom: () => mapHandleRef?.raw.getZoom() ?? 0,
    onDismiss: () => {
      store.set({ selectedCountry: null });
    },
  });

  const recompute = (s: AppState): void => {
    currentLit = litCountries(episodes, s.window, s.visibleCountries, s.filters);
    if (map !== null) map.setLit(currentLit);
    timeline.setWindow(s.window);
    // Keep popup contents fresh if it's open and the window/viewport changed.
    const cur = popup.current();
    if (cur !== null) {
      popup.update(episodesForCountry(cur.iso3, s.window, s.filters));
    }
  };

  store.subscribe(recompute);
  wireHashSync(store);

  // Zoom-locked paper texture. A PNG of procedural noise is generated
  // once via canvas; resize/pan only stretches the pre-rasterized image
  // (GPU-cheap). Source resolution is large enough that the grain stays
  // close to 1:1 with screen pixels even at max zoom.
  //
  // Seamless tiling: the right edge column is forced equal to the left
  // edge column, and the bottom row to the top row. With per-pixel
  // uncorrelated noise this hides what would otherwise be a visible
  // discontinuity at tile boundaries when the noise is heavily upscaled.
  const TEXTURE_TILE_PX = 48; // base on-screen tile size at zoom 0 (fine grain)
  const textureEl = document.getElementById("map-texture");
  const applyNoiseTexture = (target: HTMLElement): void => {
    // Two procedural layers, no discrete features:
    //   Layer 1: low-frequency mottling — a small random-alpha tile
    //            bilinear-scaled up. Broad soft tonal variation, no
    //            visible features. Alpha cap ~2%.
    //   Layer 2: fine per-pixel grain — random alpha per pixel at full
    //            resolution, additively blended on top of layer 1.
    //            Provides paper-surface micro-texture. Alpha cap ~8%.
    // Strokes and splotches read as drawn marks rather than paper
    // character, so neither is used.
    const size = 2048;
    const lowFreqSize = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    if (ctx === null) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Layer 1: low-frequency mottling. Tiny canvas of random alpha,
    // edge-wrapped for seamless tiling, then scaled up with bilinear
    // interpolation.
    const mottle = document.createElement("canvas");
    mottle.width = mottle.height = lowFreqSize;
    const mctx = mottle.getContext("2d");
    if (mctx === null) return;
    const mimg = mctx.createImageData(lowFreqSize, lowFreqSize);
    const md = mimg.data;
    for (let i = 0; i < md.length; i += 4) {
      md[i] = 70;
      md[i + 1] = 55;
      md[i + 2] = 35;
      // Cubic falloff biases alpha toward near-zero (cap 5/255 ≈ 2%) so
      // the mottling reads as ambient variation rather than dark blobs.
      const a = Math.random();
      md[i + 3] = Math.floor(a * a * a * 5);
    }
    for (let y = 0; y < lowFreqSize; y++) {
      md[(y * lowFreqSize + lowFreqSize - 1) * 4 + 3] = md[y * lowFreqSize * 4 + 3] ?? 0;
    }
    for (let x = 0; x < lowFreqSize; x++) {
      md[((lowFreqSize - 1) * lowFreqSize + x) * 4 + 3] = md[x * 4 + 3] ?? 0;
    }
    mctx.putImageData(mimg, 0, 0);
    ctx.drawImage(mottle, 0, 0, size, size);

    // Layer 2: per-pixel fine grain. Additively blends on top of the
    // already-present mottling alpha.
    const img = ctx.getImageData(0, 0, size, size);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 70;
      data[i + 1] = 55;
      data[i + 2] = 35;
      const cur = data[i + 3] ?? 0;
      const a = Math.random();
      data[i + 3] = Math.min(255, cur + Math.floor(a * a * 20)); // cap ~20/255 ≈ 8%
    }
    // Edge wrap so adjacent tile copies seam invisibly.
    for (let y = 0; y < size; y++) {
      data[(y * size + size - 1) * 4 + 3] = data[y * size * 4 + 3] ?? 0;
    }
    for (let x = 0; x < size; x++) {
      data[((size - 1) * size + x) * 4 + 3] = data[x * 4 + 3] ?? 0;
    }
    ctx.putImageData(img, 0, 0);

    c.toBlob((blob) => {
      if (blob === null) return;
      const url = URL.createObjectURL(blob);
      target.style.backgroundImage = `url(${url})`;
    }, "image/png");
  };
  if (textureEl !== null) {
    applyNoiseTexture(textureEl);
  }
  let lastTextureZoom = Number.NaN;
  const syncMapTexture = (): void => {
    if (textureEl === null || mapHandleRef === null) return;
    const zoom = mapHandleRef.raw.getZoom();
    // Skip background-size write on pure pans (zoom unchanged) — it's the
    // expensive path. background-position is cheap and updates every frame.
    if (zoom !== lastTextureZoom) {
      const tile = TEXTURE_TILE_PX * Math.pow(2, zoom);
      textureEl.style.backgroundSize = `${tile}px ${tile}px`;
      lastTextureZoom = zoom;
    }
    const origin = mapHandleRef.project([0, 0]);
    textureEl.style.backgroundPosition = `${origin.x}px ${origin.y}px`;
  };

  map = await createMap({
    container: mapEl,
    geojson,
    palette: ANTIQUE_ATLAS_PALETTE,
    initialCenter: initialState.mapCenter,
    initialZoom: initialState.mapZoom,
    onMove: (visibleCountries, center, zoom) => {
      popup.reposition();
      syncMapTexture();
      store.set({ visibleCountries, mapCenter: center, mapZoom: zoom });
    },
    onCountryHover: (info) => {
      if (info === null) {
        popup.scheduleHide();
        map?.hideLabel();
        return;
      }
      const isLit = currentLit.has(info.iso3);
      if (!isLit) {
        map?.showLabel(info.lngLat, info.name);
        popup.scheduleHide();
        return;
      }
      map?.hideLabel();
      const eps = episodesForCountry(info.iso3, store.get().window, store.get().filters);
      popup.show(info.iso3, eps, "hover");
    },
    onCountryClick: (info) => {
      const isLit = currentLit.has(info.iso3);
      if (!isLit) {
        // Unlit click: no popup, no zoom — keeps interactions predictable.
        return;
      }
      const cur = popup.current();
      const eps = episodesForCountry(info.iso3, store.get().window, store.get().filters);
      if (cur?.iso3 === info.iso3) {
        // Same country tapped again → commit-zoom; popup stays pinned.
        map?.flyToCountry(info.iso3);
        popup.show(info.iso3, eps, "pinned");
        store.set({ selectedCountry: info.iso3 });
        return;
      }
      // Different country → just open popup (no zoom on first tap).
      popup.show(info.iso3, eps, "pinned");
      store.set({ selectedCountry: info.iso3 });
    },
    onMapClick: () => {
      popup.hide();
    },
  });

  mapHandleRef = map;

  // Bind texture sync to MapLibre's continuous "move" event so the grain
  // tracks pan/zoom in real time (the createMap onMove callback only fires
  // on moveend). Initial call too so the texture is positioned before any
  // user interaction.
  map.raw.on("move", syncMapTexture);
  syncMapTexture();

  // Initial recompute now that the map exists and has emitted its first viewport.
  recompute(store.get());

  // ---------------------------------------------------------------------
  // Playback controls (speed pill + play/pause button)
  // ---------------------------------------------------------------------
  // 1× = 20 pixels/second across the timeline rail. The rail uses a
  // piecewise-linear scale, so a constant pixel velocity means years tick
  // faster through sparse eras (BC) and slower through dense ones (modern)
  // — visually even motion, regardless of calendar density.
  const SPEED_CYCLE = [0.5, 1, 1.5, 2, 4] as const;
  // Playback window width in years. 1 = single-year window (start === end);
  // 5/10/25/50/100 = symmetric span around the playhead so the user can
  // watch "what was happening in the 1410s in Europe" instead of a single
  // year at a time.
  const RANGE_CYCLE = [1, 5, 10, 25, 50, 100] as const;
  const PIX_PER_SEC_BASE = 20;
  const TIMELINE_PAD_PX = 26; // HANDLE_RADIUS (22) + 4, matches TimelineCanvas
  let speedIdx = 1; // start at 1×
  let rangeIdx = 0; // start at 1y
  let playing = false;
  let rafId: number | null = null;
  let lastFrameMs = 0;
  let playheadPx = 0; // current playhead position in rail px (sub-pixel ok)

  const speedPill = document.getElementById("speed-pill");
  const rangePill = document.getElementById("range-pill");
  const playBtn = document.getElementById("play-button");

  /** Convert a playhead year + selected range to a clamped TimeWindow. */
  const windowForYear = (year: number): TimeWindow => {
    const span = RANGE_CYCLE[rangeIdx] ?? 1;
    const halfBefore = Math.floor(span / 2);
    const halfAfter = span - 1 - halfBefore;
    let start = year - halfBefore;
    let end = year + halfAfter;
    if (start < TIMELINE_BOUNDS.min) {
      end += TIMELINE_BOUNDS.min - start;
      start = TIMELINE_BOUNDS.min;
    }
    if (end > TIMELINE_BOUNDS.max) {
      start -= end - TIMELINE_BOUNDS.max;
      end = TIMELINE_BOUNDS.max;
    }
    return { start, end };
  };

  const railWidthPx = (): number => {
    const rect = timelineEl.getBoundingClientRect();
    return Math.max(1, rect.width - TIMELINE_PAD_PX * 2);
  };

  const setPlayState = (next: boolean): void => {
    playing = next;
    if (playBtn !== null) {
      // CSS keys icon crossfade off data-state.
      playBtn.dataset["state"] = next ? "playing" : "paused";
      playBtn.setAttribute("aria-label", next ? "Pause" : "Play");
    }
  };

  const stopPlayback = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    setPlayState(false);
  };

  const tick = (now: number): void => {
    if (!playing) return;
    const dt = (now - lastFrameMs) / 1000;
    lastFrameMs = now;
    const speed = SPEED_CYCLE[speedIdx] ?? 1;
    playheadPx += PIX_PER_SEC_BASE * speed * dt;
    const railW = railWidthPx();
    if (playheadPx >= railW) {
      // End of timeline: snap to max, stop.
      const last = windowForYear(TIMELINE_BOUNDS.max);
      store.set({ window: last });
      stopPlayback();
      return;
    }
    const newYear = Math.round(pxToYear(playheadPx, railW));
    const cur = store.get().window;
    const next = windowForYear(newYear);
    if (next.start !== cur.start || next.end !== cur.end) {
      store.set({ window: next });
    }
    rafId = requestAnimationFrame(tick);
  };

  const startPlayback = (): void => {
    // Close any open popup — episode list would flicker as years tick.
    popup.hide();
    const cur = store.get().window;
    // Anchor playback at the center of whatever window is currently
    // selected, then size the window from the active range pill.
    const center = Math.round((cur.start + cur.end) / 2);
    store.set({ window: windowForYear(center) });
    playheadPx = yearToPx(center, railWidthPx());
    setPlayState(true);
    lastFrameMs = performance.now();
    rafId = requestAnimationFrame(tick);
  };

  playBtn?.addEventListener("click", () => {
    if (playing) stopPlayback();
    else startPlayback();
  });

  // Two overlaid text spans inside the speed pill. On every cycle, the
  // active one fades+shrinks out and the other gets the new label and
  // fades+grows in. Same easing as the play/pause icon morph for
  // consistency.
  const speedSlots = speedPill?.querySelectorAll<HTMLElement>(".speed-text") ?? null;
  let activeSpeedSlot = 0;
  speedPill?.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % SPEED_CYCLE.length;
    const next = SPEED_CYCLE[speedIdx] ?? 1;
    if (speedSlots !== null && speedSlots.length === 2) {
      const nextSlot = 1 - activeSpeedSlot;
      const nextEl = speedSlots[nextSlot];
      const prevEl = speedSlots[activeSpeedSlot];
      if (nextEl !== undefined && prevEl !== undefined) {
        nextEl.textContent = `${next}×`;
        nextEl.classList.add("speed-text--active");
        prevEl.classList.remove("speed-text--active");
        activeSpeedSlot = nextSlot;
      }
    }
  });

  // Range pill: same crossfade pattern. Clicking advances through the
  // RANGE_CYCLE and immediately resizes the current window so the user
  // sees the effect without having to press play.
  const rangeSlots = rangePill?.querySelectorAll<HTMLElement>(".range-text") ?? null;
  let activeRangeSlot = 0;
  rangePill?.addEventListener("click", () => {
    rangeIdx = (rangeIdx + 1) % RANGE_CYCLE.length;
    const next = RANGE_CYCLE[rangeIdx] ?? 1;
    if (rangeSlots !== null && rangeSlots.length === 2) {
      const nextSlot = 1 - activeRangeSlot;
      const nextEl = rangeSlots[nextSlot];
      const prevEl = rangeSlots[activeRangeSlot];
      if (nextEl !== undefined && prevEl !== undefined) {
        nextEl.textContent = `${next}y`;
        nextEl.classList.add("range-text--active");
        prevEl.classList.remove("range-text--active");
        activeRangeSlot = nextSlot;
      }
    }
    const cur = store.get().window;
    const center = Math.round((cur.start + cur.end) / 2);
    store.set({ window: windowForYear(center) });
  });

  // Playwright test hooks — same code paths as real input.
  window.__setTimeWindow = (start: number, end: number): void => {
    store.set({ window: { start, end } });
  };
  window.__hoverCountry = (iso3: string | null): void => {
    if (iso3 === null) {
      popup.scheduleHide();
      return;
    }
    const info = countryInfo.get(iso3);
    if (info === undefined) return;
    const isLit = currentLit.has(iso3);
    if (!isLit) {
      map?.showLabel([info.labelLon, info.labelLat], info.name);
      return;
    }
    map?.hideLabel();
    popup.show(
      iso3,
      episodesForCountry(iso3, store.get().window, store.get().filters),
      "hover",
    );
  };
  window.__clickCountry = (iso3: string): void => {
    if (countryInfo.get(iso3) === undefined) return;
    if (!currentLit.has(iso3)) return;
    const cur = popup.current();
    const eps = episodesForCountry(iso3, store.get().window, store.get().filters);
    popup.show(iso3, eps, "pinned");
    if (cur?.iso3 === iso3) {
      // Same country tapped again → commit-zoom.
      map?.flyToCountry(iso3);
    }
    store.set({ selectedCountry: iso3 });
  };

  // ---------------------------------------------------------------------
  // Filter chips
  // ---------------------------------------------------------------------
  const filterChips = document.querySelectorAll<HTMLButtonElement>(".filter-chip");
  const syncChips = (f: FilterFlags): void => {
    for (const chip of filterChips) {
      const key = chip.dataset["filter"] as keyof FilterFlags | undefined;
      if (key === undefined) continue;
      chip.setAttribute("aria-pressed", f[key] ? "true" : "false");
    }
  };
  syncChips(initialState.filters);
  for (const chip of filterChips) {
    const key = chip.dataset["filter"] as keyof FilterFlags | undefined;
    if (key === undefined) continue;
    chip.addEventListener("click", () => {
      const cur = store.get().filters;
      const next: FilterFlags = { ...cur, [key]: !cur[key] };
      store.set({ filters: next });
    });
  }
  store.subscribe((s) => syncChips(s.filters));

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
