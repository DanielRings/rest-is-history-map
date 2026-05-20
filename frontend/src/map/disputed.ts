/**
 * Disputed-border representations to spot-check after the W4 first real run.
 *
 * Natural Earth's choices are documented here, not blockers. The render
 * code reads this list at init and console-logs a single info line so the
 * notes are visible while spot-checking in a browser devtools session.
 */

/** One disputed-territory note for spot-check. */
export interface DisputedNote {
  /** ISO3 the territory most commonly resolves to in the Natural Earth feed. */
  iso3: string;
  /** Free-text describing how Natural Earth currently renders it. */
  note: string;
}

/**
 * Spot-check list. Each entry corresponds to a region flagged in the
 * project design doc. TODO: revisit after W4 first run with live data.
 */
export const DISPUTED_TODOS: readonly DisputedNote[] = [
  // TODO(W4): Western Sahara. Natural Earth renders it as separate from Morocco.
  { iso3: "ESH", note: "Western Sahara — NE renders as separate from Morocco." },
  // TODO(W4): Crimea. NE includes a Crimea feature; we accept NE's default.
  { iso3: "UKR", note: "Crimea — NE includes a feature overlapping Ukraine." },
  // TODO(W4): Taiwan. NE renders Taiwan as separate with ISO_A3_EH=TWN.
  { iso3: "TWN", note: "Taiwan — NE renders as separate; ISO_A3_EH = TWN." },
  // TODO(W4): Kashmir. NE has Indian-/Pakistan-administered subfeatures.
  { iso3: "IND", note: "Kashmir — NE has Indian-/Pakistan-administered subfeatures." },
  // TODO(W4): Israel/Palestine. NE renders ISR and PSE as separate; fixture uses PSE.
  { iso3: "PSE", note: "Israel/Palestine — NE renders ISR and PSE separately." },
];

/** Log the spot-check list once at app init. Visible in devtools only. */
export function logDisputedNotes(): void {
  console.info(
    "[rih] disputed-border spot-checks (TODO W4):",
    DISPUTED_TODOS.map((d) => `${d.iso3}: ${d.note}`).join("; "),
  );
}
