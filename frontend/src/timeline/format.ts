/**
 * Year and year-range formatting for the BC/AD convention.
 *
 * The schema forbids year 0 (history goes from 1 BC straight to AD 1) but
 * the timeline scale is continuous through 0 — drags can land an integer
 * pixel position there. We collapse 0 to "AD 1" for display so users never
 * see the meaningless "AD 0".
 */

/**
 * Format a signed year as "44 BC", "AD 800", or "2024".
 *
 * Convention: years up to and including 1000 get an explicit "AD" prefix;
 * later years are rendered as bare integers. Negative years get a "BC"
 * suffix, with the sign dropped. Year 0 (which doesn't exist historically)
 * is rendered as "AD 1" for historical consistency.
 */
export function formatYear(year: number): string {
  if (year === 0) return "AD 1";
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

/**
 * Format a year for the timeline tick / handle context, where BC/AD context
 * comes from surrounding ticks. AD prefix appears only on the year-1
 * boundary tick; every later AD year is bare. Year 0 (which doesn't exist
 * historically) collapses to "AD 1" for the same reason as {@link formatYear}.
 */
export function formatYearTick(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  if (year === 0 || year === 1) return "AD 1";
  return String(year);
}
