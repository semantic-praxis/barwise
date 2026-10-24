/**
 * `--flag value` for the gates' fixture overrides, or `fallback` when the
 * flag is absent. A flag given with no value refuses: falling back would
 * answer about the live repository when a fixture was asked about. One
 * copy, so every gate that takes overrides refuses the same way.
 */
export function opt(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}
