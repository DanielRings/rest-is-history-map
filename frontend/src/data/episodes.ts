/**
 * Episode types and loading.
 *
 * Mirrors the canonical schema at /schema/episodes.schema.json. The frontend
 * trusts the pipeline to produce schema-valid output (validation runs both in
 * CI and the offline contract test); the type definitions here are not a
 * runtime guard but a TypeScript-level mirror so consumers can navigate the
 * shape with IntelliSense.
 */

/** Listen-out links. All optional; UI shows icons only for keys present. */
export interface EpisodeLinks {
  apple?: string;
  spotify?: string;
  youtube?: string;
}

/** A single tagged episode. Mirror of `$defs/episode` in the schema. */
export interface Episode {
  guid: string;
  title: string;
  description: string;
  pub_date: string;
  access: "public" | "members";
  countries: readonly string[];
  year_start: number;
  year_end: number;
  date_precision: "year" | "decade" | "century" | "era";
  kind: "historical" | "interview" | "live" | "themed" | "meta";
  topics: readonly string[];
  historical_figures: readonly string[];
  series_id?: string;
  series_part?: number;
  series_start?: number;
  series_end?: number;
  /** Sort anchor for this episode. Pipeline injects a default = midpoint
   *  of year_start / year_end (bumped to 1 if midpoint would be 0). */
  year_anchor?: number;
  /** Sort anchor for the whole series. Pipeline injects a default =
   *  midpoint of series_start / series_end. Same value on every part. */
  series_year_anchor?: number;
  links: EpisodeLinks;
}

/** The wrapper document the pipeline emits to `data/episodes.json`. */
export interface EpisodesDocument {
  version: 1;
  generated_at: string;
  episodes: readonly Episode[];
}

/**
 * Fetch and minimally narrow an `episodes.json` document.
 *
 * Treats any shape mismatch as fatal (per CLAUDE.md "no fallback values"
 * rule); the caller should let the error propagate to the top-level error
 * surface.
 *
 * @param url - URL or path resolvable by `fetch`.
 * @returns Parsed and shape-narrowed document.
 * @throws If the response is non-OK, the body is not JSON, the version is
 *         not 1, or `episodes` is not an array.
 */
export async function loadEpisodes(url: string): Promise<EpisodesDocument> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`loadEpisodes: ${response.status} ${response.statusText} for ${url}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("version" in body) ||
    (body as { version: unknown }).version !== 1 ||
    !("episodes" in body) ||
    !Array.isArray((body as { episodes: unknown }).episodes)
  ) {
    throw new Error(`loadEpisodes: response at ${url} is not an EpisodesDocument`);
  }
  return body as EpisodesDocument;
}

/**
 * Build an in-memory index from ISO3 country code to the episodes that
 * mention it. Episodes with no countries are absent from the index.
 *
 * @param eps - All loaded episodes.
 * @returns Map keyed by ISO3 alpha-3 code.
 */
export function indexByCountry(eps: readonly Episode[]): ReadonlyMap<string, readonly Episode[]> {
  const out = new Map<string, Episode[]>();
  for (const ep of eps) {
    for (const iso3 of ep.countries) {
      const existing = out.get(iso3);
      if (existing === undefined) {
        out.set(iso3, [ep]);
      } else {
        existing.push(ep);
      }
    }
  }
  return out;
}
