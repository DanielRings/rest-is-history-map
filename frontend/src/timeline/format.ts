/**
 * Year and year-range formatting for the BC/AD convention.
 *
 * The schema forbids year 0; this module nevertheless renders it (as the
 * meaningless string "AD 0") rather than throwing, because the timeline
 * scale is continuous through zero and the canvas may sample integer pixel
 * positions that round to 0.
 */

/**
 * Format a signed year as "44 BC", "AD 800", or "2024".
 *
 * Convention: years up to and including 1000 get an explicit "AD" prefix;
 * later years are rendered as bare integers. Negative years get a "BC"
 * suffix, with the sign dropped.
 */
export function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  if (year <= 1000) return `AD ${year}`;
  return String(year);
}

/**
 * Format a year range as "44 BC – AD 14" or "1453". Collapses single-year
 * ranges to a single label.
 */
export function formatYearRange(start: number, end: number): string {
  if (start === end) return formatYear(start);
  return `${formatYear(start)} – ${formatYear(end)}`;
}
