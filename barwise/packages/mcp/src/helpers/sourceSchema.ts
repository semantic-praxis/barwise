/**
 * Shared zod schema for a tool `source` (or `base`/`incoming`) input.
 *
 * A `source` is either a string -- a file path or inline YAML, disambiguated
 * by a heuristic -- or an explicit file object. The object form lets a caller
 * state intent instead of relying on the guess: `{ path }` reads from disk,
 * `{ content }` is inline YAML, and `{ path, content }` parses `content` while
 * using `path` as the file's location (spill/lineage output, project
 * detection) -- the unsaved-editor-buffer case.
 */

import { z } from "zod";

/** Appended to every `source` description so the object form is discoverable. */
const OBJECT_FORM_NOTE =
  " May also be an object: { path } reads from disk, { content } is inline "
  + "YAML, { path, content } parses content located at path (e.g. an unsaved "
  + "editor buffer).";

/**
 * Build the `source` (or `base`/`incoming`) union schema with a tool-specific
 * description. The shared object-form note is appended automatically.
 */
export function sourceInputSchema(description: string) {
  return z
    .union([
      z.string(),
      z
        .object({
          path: z.string().optional(),
          content: z.string().optional(),
        })
        .refine((o) => Boolean(o.path) || Boolean(o.content), {
          message: "provide `path`, `content`, or both",
        }),
    ])
    .describe(description + OBJECT_FORM_NOTE);
}
