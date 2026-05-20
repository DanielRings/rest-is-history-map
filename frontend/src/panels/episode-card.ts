/**
 * Episode card renderer.
 *
 * Returns a detached `<article>` element. The sidebar and bottom-sheet
 * both call this; they each handle insertion and ordering.
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

  const header = document.createElement("header");
  header.className = "ep-card__header";

  const title = document.createElement("h3");
  title.className = "ep-card__title";
  title.textContent = ep.title;
  header.appendChild(title);

  if (ep.access === "members") {
    const badge = document.createElement("span");
    badge.innerHTML = CLUB_BADGE_HTML;
    const child = badge.firstElementChild;
    if (child !== null) header.appendChild(child);
  }

  article.appendChild(header);

  const meta = document.createElement("p");
  meta.className = "ep-card__meta";
  meta.textContent = formatYearRange(ep.year_start, ep.year_end);
  article.appendChild(meta);

  if (ep.countries.length > 0) {
    const chips = document.createElement("p");
    chips.className = "ep-card__chips";
    chips.textContent = ep.countries.join(" · ");
    article.appendChild(chips);
  }

  const desc = document.createElement("p");
  desc.className = "ep-card__desc";
  desc.textContent = ep.description;
  article.appendChild(desc);

  const links = document.createElement("p");
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
  if (links.childNodes.length > 0) article.appendChild(links);

  return article;
}
