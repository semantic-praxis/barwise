/**
 * S1 of docs/specs/effect-adoption.spec.md, as section 1r restates it: what
 * a head's loader makes of every tracked model, written so two heads'
 * listings can be compared line by line.
 *
 * Read on one head, a loader agrees with itself: a decoder that dropped a
 * field would load a file, write it without the field, and read that back
 * the same. So the listing is taken on `main` and on the spike head, and
 * the two are compared; the loader is a parameter so the listing's own
 * test can hand it a loader that drops a field and see the line change.
 *
 * A file's line holds a hash of the 3.0 bytes its model writes, or
 * "refused". Refusal wording is not compared: that is S4's to read, and
 * the spike changes it on purpose.
 */
import { createHash } from "node:crypto";

/** The two ways a surface loads a file: strict, and `lenient` (`barwise validate`). */
export const MODES = ["strict", "lenient"];

/**
 * One line per file and mode: `<file>\t<mode>\t<sha256 of the 3.0 bytes>`,
 * or `refused` in place of the hash. `texts` maps each file's path to its
 * text; `loader` has the shape of `OrmYamlSerializer`. `written`, when
 * given, receives each strict load's 3.0 text by path, for `--write`.
 */
export function corpusListing(texts, loader, written) {
  const lines = [];
  for (const [file, text] of texts) {
    for (const mode of MODES) {
      let out;
      try {
        out = loader.serialize(loader.deserialize(text, { lenient: mode === "lenient" }));
      } catch {
        lines.push(`${file}\t${mode}\trefused`);
        continue;
      }
      if (mode === "strict" && written) written.set(file, out);
      lines.push(`${file}\t${mode}\t${createHash("sha256").update(out).digest("hex")}`);
    }
  }
  return lines;
}
