/**
 * Episode panel renderer.
 *
 * One implementation drives both the desktop sidebar and the mobile bottom
 * sheet — the active layout is selected by CSS container query. The mobile
 * variant additionally hooks a drag-to-resize gesture; see
 * {@link attachBottomSheetDrag}.
 */

import type { Episode } from "../data/episodes";

import { renderEpisodeCard } from "./episode-card";

/** Public API of the panel. */
export interface EpisodePanel {
  /** Replace the list with the provided episodes (already filtered). */
  render: (eps: readonly Episode[]) => void;
  /** Detach event listeners (used by hot-reload / tests). */
  dispose: () => void;
}

/**
 * Mount an episode panel on a host element. Cards are sorted by
 * `year_start` ascending and diffed by `guid` so a re-render does not
 * reset scroll position.
 */
export function createEpisodePanel(host: HTMLElement): EpisodePanel {
  host.classList.add("ep-panel");

  const list = document.createElement("div");
  list.className = "ep-panel__list";
  list.setAttribute("role", "list");
  host.appendChild(list);

  const cards = new Map<string, HTMLElement>();

  const render = (eps: readonly Episode[]): void => {
    const sorted = [...eps].sort((a, b) => a.year_start - b.year_start);
    const wantedGuids = new Set(sorted.map((e) => e.guid));

    for (const [guid, node] of cards) {
      if (!wantedGuids.has(guid)) {
        node.remove();
        cards.delete(guid);
      }
    }

    let cursor: ChildNode | null = list.firstChild;
    for (const ep of sorted) {
      const existing = cards.get(ep.guid);
      if (existing !== undefined) {
        if (existing !== cursor) {
          list.insertBefore(existing, cursor);
        }
        cursor = existing.nextSibling;
      } else {
        const node = renderEpisodeCard(ep);
        cards.set(ep.guid, node);
        list.insertBefore(node, cursor);
      }
    }

    list.dataset["count"] = String(sorted.length);
    host.dataset["count"] = String(sorted.length);
  };

  return {
    render,
    dispose: () => {
      cards.clear();
      list.replaceChildren();
    },
  };
}

/**
 * Attach drag-to-resize behavior to the bottom sheet (mobile layout only).
 *
 * The handle is a small grabber inside the panel; dragging it sets a CSS
 * variable that the stylesheet honors as the panel's height. The handler
 * is no-op outside container-query mobile mode because the desktop CSS
 * ignores the variable.
 */
export function attachBottomSheetDrag(handle: HTMLElement, host: HTMLElement): () => void {
  let startY = 0;
  let startHeight = 0;
  let active = false;

  const onDown = (e: PointerEvent): void => {
    active = true;
    startY = e.clientY;
    startHeight = host.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    if (!active) return;
    const dy = startY - e.clientY;
    const min = Math.round(window.innerHeight * 0.15);
    const max = Math.round(window.innerHeight * 0.9);
    const next = Math.max(min, Math.min(max, startHeight + dy));
    host.style.setProperty("--panel-height", `${next}px`);
  };
  const onUp = (e: PointerEvent): void => {
    if (!active) return;
    active = false;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);

  return () => {
    handle.removeEventListener("pointerdown", onDown);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
  };
}
