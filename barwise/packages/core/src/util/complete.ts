/**
 * Every key of `T`, required, each with the value type `T` declares.
 *
 * The completeness idiom `RING_TYPE_MEMBERS: Record<RingType, true>`
 * (barwise-869) for object literals that must list every member of a
 * type: a literal typed as `T` itself accepts a missing optional key,
 * so a projection of a config type could silently omit a field added
 * later -- the defect barwise-927 closed at six call sites and would
 * otherwise have reopened at the one helper that replaced them. Typing
 * the literal as `Complete<T>` makes an unlisted key a compile error,
 * while an optional field may still be `undefined`, because `T[K]` for
 * an optional property already includes it.
 *
 * `keyof T & string`, not `keyof T` with `-?`: the intersection makes
 * the mapped type non-homomorphic, so no optional modifiers are copied
 * and every key is required. The `-?` form is homomorphic, and
 * TypeScript strips `undefined` from a property it un-optionalises even
 * when the template adds it back, which rejected every optional field.
 * Config keys are all strings, so the intersection loses nothing.
 */
export type Complete<T> = { [K in keyof T & string]: T[K]; };
