/**
 * Inline SVG icon strings used by the episode card.
 *
 * Strings, not DOM nodes, so callers can interpolate them into the card's
 * innerHTML in a single pass.
 */

/** Apple Podcasts glyph; 16px square, currentColor fill. */
export const APPLE_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 1.6a6.4 6.4 0 0 0-1.06 12.71v-4.55H5.4V8h1.54V6.66c0-1.52.9-2.36 2.28-2.36.66 0 1.36.12 1.36.12v1.5h-.77c-.75 0-.98.47-.98.94V8h1.67l-.27 1.76H8.83v4.55A6.4 6.4 0 0 0 8 1.6Z"/></svg>';

/** Spotify glyph; 16px square, currentColor fill. */
export const SPOTIFY_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 1.6A6.4 6.4 0 1 0 14.4 8 6.4 6.4 0 0 0 8 1.6Zm2.93 9.25a.4.4 0 0 1-.55.13c-1.5-.92-3.4-1.13-5.62-.62a.4.4 0 1 1-.18-.78c2.43-.55 4.52-.31 6.21.72.19.12.25.36.14.55Zm.78-1.74a.5.5 0 0 1-.69.16c-1.72-1.06-4.34-1.36-6.37-.74a.5.5 0 0 1-.29-.96c2.33-.7 5.22-.37 7.2.85.24.14.31.45.15.69Zm.07-1.82c-2.06-1.22-5.46-1.34-7.43-.74a.6.6 0 0 1-.35-1.15c2.26-.69 6.01-.55 8.4.86a.6.6 0 1 1-.62 1.03Z"/></svg>';

/** "Club" badge string for Supporting Cast Club-only episodes. */
export const CLUB_BADGE_HTML =
  '<span class="club-badge" aria-label="Club-only episode">Club</span>';
