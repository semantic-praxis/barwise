/**
 * The one place the element-naming rule lives: a name is required, and it
 * is stored trimmed.
 *
 * The class hierarchy (`ModelElement`, and every element still built from
 * it) calls it. The object type decoder states the same rule in schema
 * terms (`NameSchema` in `objectTypeSchema.ts`), because it reports a blank
 * name as one problem among several rather than throwing; that copy is
 * checked against this function by a property test in
 * `tests/model/objectTypeDecoder.test.ts`, so a change here that the decoder
 * does not follow fails there.
 */
export function requireName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new Error("Model element name must be a non-empty string.");
  }
  return trimmed;
}
