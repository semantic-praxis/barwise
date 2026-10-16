/**
 * The keys of a JSON Schema `anyOf` of `required` alternatives: any one of
 * them would do. The one reader of that shape, for the range check and the
 * constraint decoder's presence rules; the shape itself is pinned by
 * `constraintDecoder.test.ts`.
 */
export function anyOfKeys(anyOf: unknown): readonly string[] {
  return Array.isArray(anyOf)
    ? anyOf.flatMap((alternative: { required?: readonly string[]; }) => alternative.required ?? [])
    : [];
}
