/**
 * Validate an untrusted parsed `.tutorial.yaml` document into a typed
 * `TutorialDef`, throwing a descriptive error on any malformed field.
 * Pure -- no I/O -- mirroring the gym's `parseExercise`.
 */
import type { TutorialDef, TutorialMotivation, TutorialStepDef } from "./types.js";

/** Thrown when a `.tutorial.yaml` document is structurally invalid. */
export class TutorialParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TutorialParseError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new TutorialParseError(`${where}: "${key}" must be a non-empty string`);
  }
  return v;
}

function optStr(obj: Record<string, unknown>, key: string, where: string): string | undefined {
  if (obj[key] === undefined) return undefined;
  return str(obj, key, where);
}

function strList(obj: Record<string, unknown>, key: string, where: string): string[] {
  const v = obj[key] ?? [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length === 0)) {
    throw new TutorialParseError(`${where}: "${key}" must be a list of non-empty strings`);
  }
  return v as string[];
}

function parseMotivation(v: unknown, where: string): TutorialMotivation {
  if (!isRecord(v)) {
    throw new TutorialParseError(`${where}: "motivation" must be an object`);
  }
  const kind = str(v, "kind", where);
  if (kind === "counterexample") {
    return { kind, constraintId: str(v, "constraintId", where) };
  }
  if (kind === "prose") {
    return { kind, text: str(v, "text", where) };
  }
  throw new TutorialParseError(
    `${where}: motivation kind must be "counterexample" or "prose", got "${kind}"`,
  );
}

function parseStep(v: unknown, index: number): TutorialStepDef {
  const where = `step ${index + 1}`;
  if (!isRecord(v)) throw new TutorialParseError(`${where}: must be an object`);

  const csdpStep = v["csdpStep"];
  if (typeof csdpStep !== "number" || !Number.isInteger(csdpStep) || csdpStep < 1 || csdpStep > 7) {
    throw new TutorialParseError(`${where}: "csdpStep" must be an integer 1-7`);
  }

  return {
    id: str(v, "id", where),
    csdpStep: csdpStep as TutorialStepDef["csdpStep"],
    title: str(v, "title", where),
    model: str(v, "model", where),
    motivation: parseMotivation(v["motivation"], where),
    concept: str(v, "concept", where),
    buildsOn: strList(v, "buildsOn", where),
    unlocks: strList(v, "unlocks", where),
    deck: optStr(v, "deck", where),
    gym: optStr(v, "gym", where),
  };
}

/** Parse and validate a raw `.tutorial.yaml` document. */
export function parseTutorial(raw: unknown): TutorialDef {
  if (!isRecord(raw)) {
    throw new TutorialParseError("tutorial: document must be a mapping");
  }

  const transitionRaw = raw["transition"];
  if (!isRecord(transitionRaw)) {
    throw new TutorialParseError('tutorial: "transition" must be an object with from/to');
  }

  const stepsRaw = raw["steps"];
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    throw new TutorialParseError('tutorial: "steps" must be a non-empty list');
  }
  const steps = stepsRaw.map(parseStep);

  // Referential integrity of the step graph.
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new TutorialParseError(`tutorial: duplicate step id "${step.id}"`);
    }
    ids.add(step.id);
  }
  for (const step of steps) {
    for (const ref of [...step.buildsOn, ...step.unlocks]) {
      if (!ids.has(ref)) {
        throw new TutorialParseError(
          `step "${step.id}": link references unknown step "${ref}"`,
        );
      }
    }
  }

  return {
    id: str(raw, "id", "tutorial"),
    title: str(raw, "title", "tutorial"),
    transition: {
      from: str(transitionRaw, "from", "tutorial.transition"),
      to: str(transitionRaw, "to", "tutorial.transition"),
    },
    exitPerformance: str(raw, "exitPerformance", "tutorial"),
    intro: str(raw, "intro", "tutorial"),
    steps,
  };
}
