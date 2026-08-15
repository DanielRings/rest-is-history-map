/**
 * URL hash sync — shareable Discord links.
 *
 * Format: `#tStart,tEnd/lat,lon,zoom[/f=club,nonhist,narrow]`
 *   tStart, tEnd: integer years
 *   lat:  −90..90, fixed 3 decimals
 *   lon:  −180..180, fixed 3 decimals
 *   zoom: 0..24, fixed 2 decimals
 *   f=…:  comma-separated active filter flags (optional segment)
 *
 * A malformed hash is treated as "no hash present" (decodeHash returns
 * null). URLs are external input; for *internal* validation paths we still
 * throw per the project's no-fallback rule.
 */

import { DEFAULT_FILTERS, type FilterFlags, type TimeWindow } from "../filter/predicate";
import type { AppState, Store } from "./store";

/** Subset of AppState that the URL hash round-trips. */
export type HashFragment = Pick<AppState, "window" | "mapCenter" | "mapZoom" | "filters">;

const FILTER_HASH_KEYS: ReadonlyArray<[keyof FilterFlags, string]> = [
  ["hideClub", "club"],
  ["hideNonHistorical", "nonhist"],
  ["narrowOnly", "narrow"],
];

function encodeFilters(f: FilterFlags): string {
  const on = FILTER_HASH_KEYS.filter(([k]) => f[k]).map(([, label]) => label);
  return on.length === 0 ? "f=none" : `f=${on.join(",")}`;
}

function decodeFilters(seg: string): FilterFlags | null {
  if (!seg.startsWith("f=")) return null;
  const value = seg.slice(2);
  const out: FilterFlags = { hideClub: false, hideNonHistorical: false, narrowOnly: false };
  if (value === "none") return out;
  const labels = new Set(value.split(",").filter(Boolean));
  for (const [k, label] of FILTER_HASH_KEYS) {
    if (labels.has(label)) {
      out[k] = true;
      labels.delete(label);
    }
  }
  if (labels.size > 0) return null; // unknown label — treat hash as malformed
  return out;
}

/**
 * Render a hash fragment into the canonical `#tStart,tEnd/lat,lon,zoom`
 * string. The leading `#` is included so callers can compare against
 * `window.location.hash` verbatim.
 */
export function encodeHash(s: HashFragment): string {
  const t = `${Math.round(s.window.start)},${Math.round(s.window.end)}`;
  const c = `${s.mapCenter[1].toFixed(3)},${s.mapCenter[0].toFixed(3)}`;
  const z = s.mapZoom.toFixed(2);
  // Omit the filter segment entirely when every flag matches the default —
  // keeps the common case's hash short and noise-free.
  const filtersMatchDefault =
    s.filters.hideClub === DEFAULT_FILTERS.hideClub &&
    s.filters.hideNonHistorical === DEFAULT_FILTERS.hideNonHistorical &&
    s.filters.narrowOnly === DEFAULT_FILTERS.narrowOnly;
  const f = filtersMatchDefault ? "" : `/${encodeFilters(s.filters)}`;
  return `#${t}/${c},${z}${f}`;
}

/**
 * Parse a `#tStart,tEnd/lat,lon,zoom` string into a fragment.
 *
 * @returns The decoded fragment, or `null` if the hash is empty, missing,
 *          or malformed.
 */
export function decodeHash(hash: string): HashFragment | null {
  if (hash === "" || hash === "#") return null;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const segs = body.split("/");
  if (segs.length < 2 || segs.length > 3) return null;
  const tPart = segs[0];
  const camPart = segs[1];
  const filterPart = segs[2];
  if (tPart === undefined || camPart === undefined) return null;
  let filters: FilterFlags = { ...DEFAULT_FILTERS };
  if (filterPart !== undefined) {
    const parsed = decodeFilters(filterPart);
    if (parsed === null) return null;
    filters = parsed;
  }
  const tBits = tPart.split(",");
  const camBits = camPart.split(",");
  if (tBits.length !== 2 || camBits.length !== 3) return null;
  const [tStartStr, tEndStr] = tBits;
  const [latStr, lonStr, zoomStr] = camBits;
  if (
    tStartStr === undefined ||
    tEndStr === undefined ||
    latStr === undefined ||
    lonStr === undefined ||
    zoomStr === undefined
  ) {
    return null;
  }
  const tStart = Number.parseInt(tStartStr, 10);
  const tEnd = Number.parseInt(tEndStr, 10);
  const lat = Number.parseFloat(latStr);
  const lon = Number.parseFloat(lonStr);
  const zoom = Number.parseFloat(zoomStr);
  if (
    !Number.isFinite(tStart) ||
    !Number.isFinite(tEnd) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(zoom) ||
    tStart >= tEnd ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    zoom < 0 ||
    zoom > 24
  ) {
    return null;
  }
  const window: TimeWindow = { start: tStart, end: tEnd };
  return { window, mapCenter: [lon, lat], mapZoom: zoom, filters };
}

/**
 * Wire bidirectional sync between the store and `window.location.hash`.
 *
 * Loop avoidance: the writer and reader both cache the last hash they
 * touched and short-circuit when an incoming change matches.
 *
 * @returns Cleanup function that detaches the listener and store sub.
 */
/**
 * Idle period before the URL is rewritten, in ms.
 *
 * The hash exists to be shared, so it only has to be right once things settle
 * — there is no value in tracking a moving playhead or a pan in progress.
 * Debouncing on quiet means continuous motion produces NO writes at all, and
 * exactly one lands when it stops.
 *
 * This also fixes a real bug. Safari rate-limits `history.replaceState` to
 * roughly 100 calls per 30 seconds and THROWS a SecurityError past that
 * rather than failing quietly. Playback updates the store every frame, so
 * writing per-change burned the quota in under two seconds; the throw escaped
 * `store.set()` inside the playback rAF callback and killed the loop while
 * the transport still showed "playing". Worst case here — changes spaced just
 * over the idle period — is ~60 writes per 30s, still inside the budget.
 */
const HASH_WRITE_IDLE_MS = 400;

export function wireHashSync(store: Store<AppState>): () => void {
  let lastWritten = "";
  let idleTimer: number | null = null;
  let pending: AppState | null = null;

  const commit = (s: AppState): void => {
    const fragment: HashFragment = {
      window: s.window,
      mapCenter: s.mapCenter,
      mapZoom: s.mapZoom,
      filters: s.filters,
    };
    const next = encodeHash(fragment);
    if (next === lastWritten) return;
    lastWritten = next;
    history.replaceState(null, "", next);
  };

  // Hold the newest state and restart the clock on every change, so a burst
  // (playback, a pan, a scrub) collapses to a single write when it ends.
  const writeFromState = (s: AppState): void => {
    pending = s;
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = null;
      const latest = pending;
      pending = null;
      if (latest !== null) commit(latest);
    }, HASH_WRITE_IDLE_MS);
  };

  const readFromHash = (): void => {
    const incoming = window.location.hash;
    if (incoming === lastWritten) return;
    const parsed = decodeHash(incoming);
    if (parsed === null) return;
    lastWritten = incoming;
    store.set({
      window: parsed.window,
      mapCenter: parsed.mapCenter,
      mapZoom: parsed.mapZoom,
      filters: parsed.filters,
    });
  };

  const unsub = store.subscribe(writeFromState);
  window.addEventListener("hashchange", readFromHash);
  // Prime hash from current state so the URL is canonical from the first
  // paint. Committed directly rather than debounced: there is nothing in
  // flight to coalesce with, and the URL should be shareable immediately.
  commit(store.get());

  return () => {
    unsub();
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    window.removeEventListener("hashchange", readFromHash);
  };
}
