/**
 * Country popup.
 *
 * A single floating card anchored to a country's Natural Earth label point
 * (LABEL_X / LABEL_Y) via `map.project`. Two interaction modes share the
 * same DOM: `hover` is auto-hide on mouseleave; `pinned` survives until
 * dismissed by another country, an outside click, or a timeline scrub.
 */

import type { Episode } from "../data/episodes";

import { renderEpisodeCard } from "./episode-card";

/** Lookup payload for a single country. Resolved once at app init. */
export interface CountryAnchor {
  iso3: string;
  name: string;
  lon: number;
  lat: number;
}

/** Constructor options. */
export interface CountryPopupOptions {
  /** The map container element. The popup is appended here so its absolute
   *  positioning is relative to the map. */
  mapContainer: HTMLElement;
  /** Project a [lon, lat] to map-container pixel coordinates. The popup
   *  re-invokes this on `reposition()` so map pan/zoom keeps it pinned to
   *  the country anchor point. */
  project: (lon: number, lat: number) => { x: number; y: number };
  /** Resolve ISO3 → centroid anchor (lon/lat/name). The popup applies a
   *  side-dependent pixel offset of its own to nudge the popup off the
   *  country at low zoom — see SIDE_PIXEL_OFFSET. */
  getAnchor: (iso3: string) => CountryAnchor | null;
  /** Current map zoom. Used to decide whether to apply the off-center
   *  pixel nudge (low zoom only — at high zoom the country fills the view
   *  and a centered popup is fine). */
  getZoom: () => number;
  /** Notified when the popup is dismissed (any reason). */
  onDismiss?: () => void;
}

/** Interaction mode. */
export type PopupMode = "hover" | "pinned";

/** Public API. */
export interface CountryPopup {
  /** Show or update the popup for a country with a pre-filtered episode list. */
  show: (iso3: string, episodes: readonly Episode[], mode: PopupMode) => void;
  /** Re-render the visible popup with a new episode list (e.g. timeline scrub). */
  update: (episodes: readonly Episode[]) => void;
  /** Re-project the anchor onto screen pixels (e.g. map move/zoom). */
  reposition: () => void;
  /** Schedule a hover-mode hide after a short grace period. No-op if pinned. */
  scheduleHide: () => void;
  /** Cancel a pending scheduled hide (e.g. cursor entered the popup). */
  cancelHide: () => void;
  /** Hide immediately and emit onDismiss. */
  hide: () => void;
  /** Current popup state, or null when hidden. */
  current: () => { iso3: string; mode: PopupMode } | null;
}

const HOVER_HIDE_DELAY_MS = 200;
const POPUP_OFFSET_PX = 14; // distance from anchor to the popup edge
const VIEWPORT_GUTTER_PX = 8;
/** At zooms below this threshold the popup is nudged off the country
 *  centroid by SIDE_PIXEL_OFFSET so it doesn't sit on top of the country.
 *  Above this, the country fills the view and a centered popup is fine. */
const ZOOM_OFFCENTER_THRESHOLD = 4.5;
/** Pixel offset applied to the projected centroid in the popup-side
 *  direction at low zoom. Constant in screen pixels = independent of
 *  country shape and zoom, which avoids the bbox-anchor's "popup in the
 *  Adriatic Sea" failure mode for irregular shapes. */
const SIDE_PIXEL_OFFSET = 40;
/** Which side of the anchor the popup is placed on. */
export type Side = "right" | "left" | "below" | "above";

/**
 * Mount a country popup on the map container. Returns an imperative handle.
 */
export function createCountryPopup(opts: CountryPopupOptions): CountryPopup {
  const root = document.createElement("aside");
  root.className = "country-popup";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Country episodes");
  root.style.display = "none";

  const header = document.createElement("header");
  header.className = "country-popup__header";
  const countryEl = document.createElement("p");
  countryEl.className = "country-popup__country";
  const countEl = document.createElement("p");
  countEl.className = "country-popup__count";
  header.appendChild(countryEl);
  header.appendChild(countEl);
  root.appendChild(header);

  const list = document.createElement("div");
  list.className = "country-popup__list";
  list.setAttribute("role", "list");
  root.appendChild(list);

  // The popup is rendered as three positioned siblings:
  //   - root           : the rectangular body (border-radius, content)
  //   - notch          : a triangular fill at one edge of the body; has
  //                      its own backdrop-filter so it matches the body's
  //                      frosted look exactly (the body's backdrop-filter
  //                      is bounded by its layout box, which excludes the
  //                      notch protrusion)
  //   - outline (SVG)  : strokes the combined rect+notch perimeter as a
  //                      single continuous path; hides the seam between
  //                      body and notch
  // All three are kept in sync by repositionInternal.
  const notch = document.createElement("div");
  notch.className = "country-popup__notch";
  notch.style.display = "none";
  opts.mapContainer.appendChild(notch);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const outline = document.createElementNS(SVG_NS, "svg");
  outline.setAttribute("class", "country-popup__outline");
  const outlinePath = document.createElementNS(SVG_NS, "path");
  outline.appendChild(outlinePath);
  outline.style.display = "none";
  opts.mapContainer.appendChild(outline);

  opts.mapContainer.appendChild(root);

  let state: { iso3: string; mode: PopupMode } | null = null;
  let hideTimer: number | null = null;

  // Keep the cursor's presence on the popup itself from triggering an
  // auto-hide — a hover popup the user is reaching toward must not vanish
  // under their cursor.
  root.addEventListener("mouseenter", () => {
    cancelHideTimer();
  });
  root.addEventListener("mouseleave", () => {
    if (state?.mode === "hover") {
      scheduleHideTimer();
    }
  });

  const render = (iso3: string, episodes: readonly Episode[]): void => {
    const anchor = opts.getAnchor(iso3);
    if (anchor === null) {
      hideInternal();
      return;
    }

    countryEl.textContent = anchor.name;
    countEl.textContent =
      episodes.length === 0
        ? "no episodes"
        : episodes.length === 1
          ? "1 episode"
          : `${episodes.length} episodes`;

    list.replaceChildren();
    if (episodes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "country-popup__empty";
      empty.textContent = "No matching episodes in this window.";
      list.appendChild(empty);
    } else {
      const sorted = [...episodes].sort((a, b) => a.year_start - b.year_start);
      for (const ep of sorted) {
        list.appendChild(renderEpisodeCard(ep));
      }
    }

    root.style.display = "";
    root.dataset["iso3"] = iso3;
    root.dataset["count"] = String(episodes.length);
    repositionInternal(iso3);
  };

  const repositionInternal = (iso3: string): void => {
    const anchor = opts.getAnchor(iso3);
    if (anchor === null) {
      hideInternal();
      return;
    }
    const centroid = opts.project(anchor.lon, anchor.lat);
    const containerRect = opts.mapContainer.getBoundingClientRect();
    const cw = containerRect.width;
    const ch = containerRect.height;

    // Reset positioning before measuring so a previous side's offsets
    // don't bias offsetWidth.
    root.style.left = "0px";
    root.style.top = "0px";
    const w = root.offsetWidth;
    const h = root.offsetHeight;

    // Decide side based on the projected centroid + popup dimensions.
    const fitsRight = centroid.x + POPUP_OFFSET_PX + w + VIEWPORT_GUTTER_PX <= cw;
    const fitsLeft = centroid.x - POPUP_OFFSET_PX - w - VIEWPORT_GUTTER_PX >= 0;
    const fitsBelow = centroid.y + POPUP_OFFSET_PX + h + VIEWPORT_GUTTER_PX <= ch;
    const fitsAbove = centroid.y - POPUP_OFFSET_PX - h - VIEWPORT_GUTTER_PX >= 0;
    let side: Side;
    if (fitsRight) side = "right";
    else if (fitsLeft) side = "left";
    else if (fitsBelow) side = "below";
    else if (fitsAbove) side = "above";
    else side = "right"; // clamped fallback

    // Nudge the anchor in pixel-space toward the popup side. Constant
    // offset = consistent visual feel regardless of country shape or
    // zoom, and avoids "popup in the Adriatic" bbox-edge failures. Skip
    // the nudge at high zoom — the country fills the view there.
    let ax = centroid.x;
    let ay = centroid.y;
    if (opts.getZoom() < ZOOM_OFFCENTER_THRESHOLD) {
      if (side === "right") ax += SIDE_PIXEL_OFFSET;
      else if (side === "left") ax -= SIDE_PIXEL_OFFSET;
      else if (side === "below") ay += SIDE_PIXEL_OFFSET;
      else if (side === "above") ay -= SIDE_PIXEL_OFFSET;
    }

    let left: number;
    let top: number;
    if (side === "right") {
      left = ax + POPUP_OFFSET_PX;
      top = ay - h / 2;
    } else if (side === "left") {
      left = ax - POPUP_OFFSET_PX - w;
      top = ay - h / 2;
    } else if (side === "below") {
      left = ax - w / 2;
      top = ay + POPUP_OFFSET_PX;
    } else {
      left = ax - w / 2;
      top = ay - POPUP_OFFSET_PX - h;
    }

    // Clamp to viewport with gutter — never let the popup leave the map.
    left = Math.max(VIEWPORT_GUTTER_PX, Math.min(cw - w - VIEWPORT_GUTTER_PX, left));
    top = Math.max(VIEWPORT_GUTTER_PX, Math.min(ch - h - VIEWPORT_GUTTER_PX, top));

    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
    root.dataset["side"] = side;

    const R = 10; // popup border-radius
    const TRI_DEPTH = 11; // distance the notch protrudes outside popup
    const TRI_SPAN = 18; // length of the notch base

    // Place the notch element flush with the chosen popup edge. Its own
    // background + backdrop-filter make it look identical to the popup
    // body. Position and clip-path vary by side.
    const placeNotch = (
      notchLeft: number,
      notchTop: number,
      notchW: number,
      notchH: number,
      clip: string,
    ): void => {
      notch.style.left = `${Math.round(notchLeft)}px`;
      notch.style.top = `${Math.round(notchTop)}px`;
      notch.style.width = `${notchW}px`;
      notch.style.height = `${notchH}px`;
      notch.style.clipPath = clip;
      notch.style.display = "";
    };

    // Single combined path used by the outline SVG to stroke around both
    // the rectangle and the notch as one continuous border, hiding the
    // seam where the notch attaches to the popup body. Coordinates are
    // relative to the popup's top-left.
    let pathD: string;
    if (side === "right") {
      const arrowMid = Math.max(R + TRI_SPAN / 2 + 4, Math.min(h - R - TRI_SPAN / 2 - 4, ay - top));
      const aTop = arrowMid - TRI_SPAN / 2;
      const aBot = arrowMid + TRI_SPAN / 2;
      placeNotch(
        left - TRI_DEPTH,
        top + aTop,
        TRI_DEPTH,
        TRI_SPAN,
        "polygon(100% 0%, 0% 50%, 100% 100%)",
      );
      pathD =
        `M ${R} 0 ` +
        `L ${w - R} 0 ` +
        `A ${R} ${R} 0 0 1 ${w} ${R} ` +
        `L ${w} ${h - R} ` +
        `A ${R} ${R} 0 0 1 ${w - R} ${h} ` +
        `L ${R} ${h} ` +
        `A ${R} ${R} 0 0 1 0 ${h - R} ` +
        `L 0 ${aBot} ` +
        `L ${-TRI_DEPTH} ${arrowMid} ` +
        `L 0 ${aTop} ` +
        `L 0 ${R} ` +
        `A ${R} ${R} 0 0 1 ${R} 0 Z`;
    } else if (side === "left") {
      const arrowMid = Math.max(R + TRI_SPAN / 2 + 4, Math.min(h - R - TRI_SPAN / 2 - 4, ay - top));
      const aTop = arrowMid - TRI_SPAN / 2;
      const aBot = arrowMid + TRI_SPAN / 2;
      placeNotch(left + w, top + aTop, TRI_DEPTH, TRI_SPAN, "polygon(0% 0%, 100% 50%, 0% 100%)");
      pathD =
        `M ${R} 0 ` +
        `L ${w - R} 0 ` +
        `A ${R} ${R} 0 0 1 ${w} ${R} ` +
        `L ${w} ${aTop} ` +
        `L ${w + TRI_DEPTH} ${arrowMid} ` +
        `L ${w} ${aBot} ` +
        `L ${w} ${h - R} ` +
        `A ${R} ${R} 0 0 1 ${w - R} ${h} ` +
        `L ${R} ${h} ` +
        `A ${R} ${R} 0 0 1 0 ${h - R} ` +
        `L 0 ${R} ` +
        `A ${R} ${R} 0 0 1 ${R} 0 Z`;
    } else if (side === "below") {
      const arrowMid = Math.max(
        R + TRI_SPAN / 2 + 4,
        Math.min(w - R - TRI_SPAN / 2 - 4, ax - left),
      );
      const aLeft = arrowMid - TRI_SPAN / 2;
      const aRight = arrowMid + TRI_SPAN / 2;
      placeNotch(
        left + aLeft,
        top - TRI_DEPTH,
        TRI_SPAN,
        TRI_DEPTH,
        "polygon(0% 100%, 50% 0%, 100% 100%)",
      );
      pathD =
        `M ${R} 0 ` +
        `L ${aLeft} 0 ` +
        `L ${arrowMid} ${-TRI_DEPTH} ` +
        `L ${aRight} 0 ` +
        `L ${w - R} 0 ` +
        `A ${R} ${R} 0 0 1 ${w} ${R} ` +
        `L ${w} ${h - R} ` +
        `A ${R} ${R} 0 0 1 ${w - R} ${h} ` +
        `L ${R} ${h} ` +
        `A ${R} ${R} 0 0 1 0 ${h - R} ` +
        `L 0 ${R} ` +
        `A ${R} ${R} 0 0 1 ${R} 0 Z`;
    } else {
      const arrowMid = Math.max(
        R + TRI_SPAN / 2 + 4,
        Math.min(w - R - TRI_SPAN / 2 - 4, ax - left),
      );
      const aLeft = arrowMid - TRI_SPAN / 2;
      const aRight = arrowMid + TRI_SPAN / 2;
      placeNotch(left + aLeft, top + h, TRI_SPAN, TRI_DEPTH, "polygon(0% 0%, 50% 100%, 100% 0%)");
      pathD =
        `M ${R} 0 ` +
        `L ${w - R} 0 ` +
        `A ${R} ${R} 0 0 1 ${w} ${R} ` +
        `L ${w} ${h - R} ` +
        `A ${R} ${R} 0 0 1 ${w - R} ${h} ` +
        `L ${aRight} ${h} ` +
        `L ${arrowMid} ${h + TRI_DEPTH} ` +
        `L ${aLeft} ${h} ` +
        `L ${R} ${h} ` +
        `A ${R} ${R} 0 0 1 0 ${h - R} ` +
        `L 0 ${R} ` +
        `A ${R} ${R} 0 0 1 ${R} 0 Z`;
    }

    // Outline overlays the popup at the same position; its SVG box is
    // sized to the popup body but overflow:visible lets the notch portion
    // of the path render outside that box.
    outlinePath.setAttribute("d", pathD);
    outline.style.left = `${Math.round(left)}px`;
    outline.style.top = `${Math.round(top)}px`;
    outline.setAttribute("width", String(w));
    outline.setAttribute("height", String(h));
    outline.setAttribute("viewBox", `0 0 ${w} ${h}`);
    outline.style.display = "";
  };

  const scheduleHideTimer = (): void => {
    cancelHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (state?.mode === "hover") hideInternal();
    }, HOVER_HIDE_DELAY_MS);
  };

  const cancelHideTimer = (): void => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hideInternal = (): void => {
    if (state === null) return;
    state = null;
    root.style.display = "none";
    notch.style.display = "none";
    outline.style.display = "none";
    delete root.dataset["iso3"];
    delete root.dataset["count"];
    opts.onDismiss?.();
  };

  return {
    show: (iso3, episodes, mode) => {
      cancelHideTimer();
      state = { iso3, mode };
      render(iso3, episodes);
    },
    update: (episodes) => {
      if (state === null) return;
      render(state.iso3, episodes);
    },
    reposition: () => {
      if (state === null) return;
      repositionInternal(state.iso3);
    },
    scheduleHide: () => {
      if (state?.mode === "hover") scheduleHideTimer();
    },
    cancelHide: cancelHideTimer,
    hide: () => {
      cancelHideTimer();
      hideInternal();
    },
    current: () => (state === null ? null : { ...state }),
  };
}
