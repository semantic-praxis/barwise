/**
 * The one owner of a saved payload's filename
 * (docs/specs/recorded-evidence-commands.spec.md).
 *
 * The convention used to live only in the CLI writer, as an inline
 * template literal. Reading a recorded round back means parsing that
 * name, and a parser in this package plus a builder in the CLI would be
 * a must-agree copy across a package boundary -- rename the writer and
 * the reader stops finding payloads, or worse, attributes them to the
 * wrong case and reports a re-score that quietly covers fewer files than
 * it claims. Both halves live here instead, so there is no copy to keep
 * honest and no drift test to write.
 *
 * The index is one-based because that is what the recorded rounds on
 * disk already use; changing it would orphan them.
 */

/** The name `run` number `index` of `caseId` is written under. */
export function payloadFileName(caseId: string, index: number): string {
  return `${caseId}-run${index + 1}.json`;
}

/**
 * The case and zero-based run index a payload filename encodes, or
 * undefined when the name does not follow the convention.
 *
 * Case ids may themselves contain hyphens (`clinic-appointments`), so the
 * split is anchored on the LAST `-run<digits>.json`, not the first
 * hyphen.
 */
export function parsePayloadFileName(
  name: string,
): { readonly caseId: string; readonly index: number; } | undefined {
  const match = /^(.+)-run(\d+)\.json$/.exec(name);
  if (!match) return undefined;
  const caseId = match[1]!;
  const runNumber = Number(match[2]);
  if (!Number.isInteger(runNumber) || runNumber < 1) return undefined;
  return { caseId, index: runNumber - 1 };
}
