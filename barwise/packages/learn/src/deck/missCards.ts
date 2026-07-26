/**
 * Miss-card emission: gym failures become scheduled practice
 * (learning-design C6).
 *
 * A failed check maps to one card in the Anki deck's tab-separated
 * import format -- the failed check and its hint on the front, the
 * authored diagnosis and a fine-grained reading reference on the back.
 * Re-importing a recurring failure duplicates the card by design:
 * duplication is the recency mechanism that keeps the misses subdeck
 * tracking the learner's latest gaps.
 *
 * Pure and deterministic: the same exercise and report produce
 * byte-identical output -- no timestamps, no randomness. File writes
 * live at the CLI edge, matching the evaluator's own pure/loader split.
 */
import type { CheckResult, GymReport } from "../evaluate/GymReport.js";
import type { GymCheck, GymExercise } from "../exercise/types.js";

/** One emitted card: front and back, HTML allowed, tab-free. */
export interface MissCard {
  readonly front: string;
  readonly back: string;
}

/** Describe a check compactly for the card front. */
function checkLabel(check: GymCheck): string {
  switch (check.kind) {
    case "must_validate":
      return "the model must validate";
    case "requires_verbalization":
      return `the verbalization must state: "${check.sentence}"`;
    case "requires_element":
      return "entity" in check.element
        ? `the model must contain the object type ${check.element.entity}`
        : `the model must contain a fact type between ${check.element.factTypeBetween[0]} `
          + `and ${check.element.factTypeBetween[1]}`;
    case "forbids_population":
      return `the model must forbid the population ruled out by the `
        + `${check.constraint.replace(/_/g, " ")} on "${check.factType}"`;
  }
}

/** Collapse whitespace and strip tabs/newlines so a field is row-safe. */
function field(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Map a report's failed checks to miss cards, in authored check order.
 * `report.results` is index-aligned with `exercise.checks` (one result
 * per check, authored order), which is what lets the card reach the
 * authored diagnosis and reading.
 */
export function buildMissCards(exercise: GymExercise, report: GymReport): MissCard[] {
  const cards: MissCard[] = [];
  report.results.forEach((result: CheckResult, i) => {
    if (result.passed) return;
    const check = exercise.checks[i];
    if (!check) return;

    const frontParts = [
      `<b>${field(exercise.title)}</b> -- failed check: ${field(checkLabel(check))}.`,
      field(result.message),
    ];
    if (check.hint) frontParts.push(`<i>Hint: ${field(check.hint)}</i>`);

    const backParts: string[] = [];
    if (check.diagnosis) backParts.push(field(check.diagnosis));
    const reading = check.reading ?? exercise.reading;
    if (reading) backParts.push(`<i>Read: ${field(reading)}</i>`);
    if (backParts.length === 0) {
      backParts.push(
        "No authored diagnosis for this check yet -- revisit the exercise brief and reference model.",
      );
    }

    cards.push({
      front: frontParts.join("<br>"),
      back: backParts.join("<br><br>"),
    });
  });
  return cards;
}

/**
 * Render cards as a deck import file under the existing convention:
 * `#separator:tab` headers and a dedicated misses subdeck. Returns the
 * complete file content; empty-cards input renders headers only.
 */
export function renderMissCardFile(exercise: GymExercise, cards: readonly MissCard[]): string {
  const lines = [
    "#separator:tab",
    "#html:true",
    "#notetype:Basic",
    "#deck:ORM 2::Misses",
    `#tags:orm misses gym-${exercise.id}`,
    ...cards.map((c) => `${c.front}\t${c.back}`),
  ];
  return lines.join("\n") + "\n";
}
