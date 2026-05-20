/**
 * URL hash sync — shareable Discord links.
 *
 * Format: `#tStart,tEnd/lat,lon,zoom`
 *   tStart, tEnd: integer years
 *   lat:  −90..90, fixed 3 decimals
 *   lon:  −180..180, fixed 3 decimals
 *   zoom: 0..24, fixed 2 decimals
 *
 * A malformed hash is treated as "no hash present" (decodeHash returns
 * null). URLs are external input; for *internal* validation paths we still
 * throw per the project's no-fallback rule.
 */

import type { TimeWindow } from "../filter/predicate";
import type { AppState, Store } from "./store";

/** Subset of AppState that the URL hash round-trips. */
export type HashFragment = Pick<AppState, "window" | "mapCenter" | "mapZoom">;

/**
 * Render a hash fragment into the canonical `#tStart,tEnd/lat,lon,zoom`
 * string. The leading `#` is included so callers can compare against
 * `window.location.hash` verbatim.
 */
export function encodeHash(s: HashFragment): string {
  const t = `${Math.round(s.window.start)},${Math.round(s.window.end)}`;
  const c = `${s.mapCenter[1].toFixed(3)},${s.mapCenter[0].toFixed(3)}`;
  const z = s.mapZoom.toFixed(2);
  return `#${t}/${c},${z}`;
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
  const slash = body.indexOf("/");
  if (slash === -1) return null;
  const tPart = body.slice(0, slash);
  const camPart = body.slice(slash + 1);
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
  return { window, mapCenter: [lon, lat], mapZoom: zoom };
}

/**
 * Wire bidirectional sync between the store and `window.location.hash`.
 *
 * Loop avoidance: the writer and reader both cache the last hash they
 * touched and short-circuit when an incoming change matches.
 *
 * @returns Cleanup function that detaches the listener and store sub.
 */
export function wireHashSync(store: Store<AppState>): () => void {
  let lastWritten = "";

  const writeFromState = (s: AppState): void => {
    const fragment: HashFragment = {
      window: s.window,
      mapCenter: s.mapCenter,
      mapZoom: s.mapZoom,
    };
    const next = encodeHash(fragment);
    if (next === lastWritten) return;
    lastWritten = next;
    history.replaceState(null, "", next);
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
    });
  };

  const unsub = store.subscribe(writeFromState);
  window.addEventListener("hashchange", readFromHash);
  // Prime hash from current state so the URL is canonical from the first paint.
  writeFromState(store.get());

  return () => {
    unsub();
    window.removeEventListener("hashchange", readFromHash);
  };
}
