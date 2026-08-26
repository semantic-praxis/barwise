/**
 * `hashPrompt` moved to `@barwise/llm` so `withCallLog` can record the
 * prompt a production call sent
 * (docs/specs/artifact-resolution-parity.spec.md, workstream 2).
 *
 * Re-exported rather than copied: the score history and the call log
 * must agree about what identifies a prompt, and two implementations
 * of one hash is how they would stop agreeing.
 */
export { hashPrompt } from "@barwise/llm";
