import type { RuleId } from "./ruleId.js";
/**
 * Severity level for a validation diagnostic.
 */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A diagnostic produced by the validation engine.
 *
 * The type parameter is what lets a surface extend the identifier set
 * without core knowing anything about that surface: core produces
 * `Diagnostic<RuleId>` (the default), and a surface that mints
 * identifiers of its own declares its own registry and widens locally,
 * as `Diagnostic<RuleId | CliRuleId>`. Core knows only that some
 * extension may exist, never which. A global registry (declaration
 * merging) would have avoided the parameter, but it widens
 * unconditionally -- every package would see every other's ids -- and
 * it makes an exhaustive switch over `RuleId` impossible the moment
 * anyone augments (`docs/specs/closed-sets-as-unions.spec.md`, WS2).
 *
 * A consumer should name what it reads rather than widen this: a
 * formatter that touches only `severity` and `message` should ask for
 * those, not for a `Diagnostic<string>`.
 *
 * Each diagnostic identifies a specific problem (or informational note)
 * about the model, including which element is affected and which rule
 * produced it.
 */
export interface Diagnostic<R extends string = RuleId> {
  /** The severity of the diagnostic. */
  readonly severity: DiagnosticSeverity;
  /** Human-readable description of the problem. */
  readonly message: string;
  /** The id of the model element this diagnostic applies to. */
  readonly elementId: string;
  /** The rule identifier that produced this diagnostic. */
  readonly ruleId: R;
}
