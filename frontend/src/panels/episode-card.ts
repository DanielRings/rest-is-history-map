/**
 * Compact episode card for the country popup.
 *
 * Title + year + listen links + optional Club badge. No description, no
 * country chips — those exist on the data but compete for attention in the
 * popup. Iterate when we have a richer surface to render them in.
 */

import type { Episode } from "../data/episodes";
import { formatYearRange } from "../timeline/format";

import { APPLE_ICON, CLUB_BADGE_HTML, SPOTIFY_ICON } from "./icons";

/**
 * Build a DOM article for a single episode.
 *
 * @param ep - Episode data.
 * @returns Detached HTMLElement; the caller appends it where it belongs.
 */
export function renderEpisodeCard(ep: Episode): HTMLElement {
  const article = document.createElement("article");
  article.className = "ep-card";
  article.dataset["guid"] = ep.guid;

  const titleRow = document.createElement("div");
  titleRow.className = "ep-card__title-row";

  const title = document.createElement("h3");
  title.className = "ep-card__title";
  // Split off the trailing series-part marker first ("(Part 3)", "(Ep 1)",
  // "(Episode 4)") so it can render in its own nowrap span — keeps the
  // parenthesized bit from breaking across lines mid-token.
  const markerMatch = /\s*\((?:Ep|Episode|Part)\s+\d+\)\s*$/i.exec(ep.title);
  const rawTitle = markerMatch ? ep.title.slice(0, markerMatch.index) : ep.title;
  // Prefer wrapping at the first colon: split into prefix + rest spans and
  // let flex-wrap decide. "Bonus: A Roman Saturnalia" → two flex children,
  // "Bonus:" and "A Roman Saturnalia". When both fit one line they sit
  // side-by-side; when the line overflows the rest drops to its own line.
  const colonIdx = rawTitle.indexOf(":");
  if (colonIdx > 0 && colonIdx < rawTitle.length - 1) {
    const prefix = document.createElement("span");
    prefix.className = "ep-card__title-prefix";
    prefix.textContent = rawTitle.slice(0, colonIdx + 1);
    title.appendChild(prefix);
    const rest = document.createElement("span");
    rest.className = "ep-card__title-rest";
    rest.textContent = rawTitle.slice(colonIdx + 1).trimStart();
    title.appendChild(rest);
  } else {
    const main = document.createElement("span");
    main.textContent = rawTitle;
    title.appendChild(main);
  }
  if (markerMatch) {
    const marker = document.createElement("span");
    marker.className = "ep-card__title-marker";
    marker.textContent = markerMatch[0].trim();
    title.appendChild(marker);
  }
  titleRow.appendChild(title);

  if (ep.access === "members") {
    const badge = document.createElement("span");
    badge.innerHTML = CLUB_BADGE_HTML;
    const child = badge.firstElementChild;
    if (child !== null) titleRow.appendChild(child);
  }

  article.appendChild(titleRow);

  const metaRow = document.createElement("div");
  metaRow.className = "ep-card__meta-row";

  const meta = document.createElement("span");
  meta.className = "ep-card__meta";
  meta.textContent = formatYearRange(ep.year_start, ep.year_end);
  metaRow.appendChild(meta);

  const links = document.createElement("span");
  links.className = "ep-card__links";
  if (ep.links.apple !== undefined) {
    const a = document.createElement("a");
    a.href = ep.links.apple;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", "Listen on Apple Podcasts");
    a.innerHTML = APPLE_ICON;
    links.appendChild(a);
  }
  if (ep.links.spotify !== undefined) {
    const a = document.createElement("a");
    a.href = ep.links.spotify;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", "Listen on Spotify");
    a.innerHTML = SPOTIFY_ICON;
    links.appendChild(a);
  }
  metaRow.appendChild(links);

  article.appendChild(metaRow);

  return article;
}
