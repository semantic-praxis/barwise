/**
 * The severity axis of a diagnostic, in its own module.
 *
 * It lives here rather than in `Diagnostic.ts` because the rule
 * registry needs it (every descriptor declares a default severity) and
 * `Diagnostic` needs the registry (its `ruleId` is typed from it).
 * Declaring severity in either of those files makes the two import each
 * other, which is a cycle `depcruise` rejects -- correctly, even though
 * both edges are type-only and erased at runtime.
 */

/** How loudly a diagnostic speaks. */
export type DiagnosticSeverity = "error" | "warning" | "info";
