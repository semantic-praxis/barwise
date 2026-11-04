/**
 * The median of a set of timings, for `measure-comparison.mjs startup`.
 *
 * For an even count it is the mean of the two middle readings. Taking the
 * upper one instead, as the first version did, biased every even-run
 * reading upward -- by up to half the gap between the middle two, which in
 * a shared container can be tens of milliseconds against a 1 s limit.
 * Separate from the script so its test can import it: the script runs its
 * subcommand on import.
 */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
