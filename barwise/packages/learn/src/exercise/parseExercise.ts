/**
 * Validate an untrusted parsed `.gym.yaml` document into a typed
 * `GymExercise`, throwing a descriptive error on any malformed field.
 * Pure -- no I/O -- so it is testable without the filesystem and reusable
 * by any loader.
 */
import {
  type CheckGuidance,
  type ConstraintKind,
  type ElementQuery,
  type GymCheck,
  type GymExercise,
  type GymTransition,
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
} from "./types.js";

const CONSTRAINT_KINDS: readonly ConstraintKind[] = [
  "internal_uniqueness",
  "mandatory",
  "value",
  "frequency",
  "ring",
];
const CHECK_KINDS = [
  "must_validate",
  "requires_verbalization",
  "forbids_population",
  "requires_element",
] as const;

/** Thrown when a `.gym.yaml` document is structurally invalid. */
export class ExerciseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExerciseParseError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ExerciseParseError(`${where}: "${key}" must be a non-empty string`);
  }
  return v;
}

function optStr(obj: Record<string, unknown>, key: string, where: string): string | undefined {
  if (obj[key] === undefined) return undefined;
  return str(obj, key, where);
}

function parseLevel(v: unknown, where: string): ProficiencyLevel {
  if (typeof v !== "string" || !(PROFICIENCY_LEVELS as readonly string[]).includes(v)) {
    throw new ExerciseParseError(
      `${where} must be one of ${PROFICIENCY_LEVELS.join(", ")}`,
    );
  }
  return v as ProficiencyLevel;
}

/**
 * Learning-design C1 front matter: the transition must move forward on
 * the proficiency scale.
 */
function parseTransition(v: unknown): GymTransition {
  if (!isRecord(v)) {
    throw new ExerciseParseError(
      `exercise: "transition" must be an object with "from" and "to"`,
    );
  }
  const from = parseLevel(v["from"], `exercise: "transition.from"`);
  const to = parseLevel(v["to"], `exercise: "transition.to"`);
  if (PROFICIENCY_LEVELS.indexOf(from) >= PROFICIENCY_LEVELS.indexOf(to)) {
    throw new ExerciseParseError(
      `exercise: "transition" must move forward on the scale (got ${from} -> ${to})`,
    );
  }
  return { from, to };
}

/** The optional C6 guidance fields every check kind may carry. */
function parseGuidance(v: Record<string, unknown>, where: string): CheckGuidance {
  return {
    hint: optStr(v, "hint", where),
    diagnosis: optStr(v, "diagnosis", where),
    reading: optStr(v, "reading", where),
  };
}

function parseElementQuery(v: unknown, where: string): ElementQuery {
  if (!isRecord(v)) throw new ExerciseParseError(`${where}: "element" must be an object`);
  if (typeof v["entity"] === "string") return { entity: v["entity"] };
  const between = v["factTypeBetween"];
  if (
    Array.isArray(between) && between.length === 2
    && typeof between[0] === "string" && typeof between[1] === "string"
  ) {
    return { factTypeBetween: [between[0], between[1]] };
  }
  throw new ExerciseParseError(
    `${where}: "element" must be { entity: string } or { factTypeBetween: [string, string] }`,
  );
}

function parseCheck(v: unknown, i: number): GymCheck {
  const where = `checks[${i}]`;
  if (!isRecord(v)) throw new ExerciseParseError(`${where} must be an object`);
  const kind = v["kind"];
  if (typeof kind !== "string" || !(CHECK_KINDS as readonly string[]).includes(kind)) {
    throw new ExerciseParseError(
      `${where}: "kind" must be one of ${CHECK_KINDS.join(", ")}`,
    );
  }
  const guidance = parseGuidance(v, where);
  switch (kind as (typeof CHECK_KINDS)[number]) {
    case "must_validate":
      return { kind: "must_validate", ...guidance };
    case "requires_verbalization":
      return {
        kind: "requires_verbalization",
        sentence: str(v, "sentence", where),
        ...guidance,
      };
    case "requires_element":
      return {
        kind: "requires_element",
        element: parseElementQuery(v["element"], where),
        ...guidance,
      };
    case "forbids_population": {
      const constraint = v["constraint"];
      if (
        typeof constraint !== "string"
        || !(CONSTRAINT_KINDS as readonly string[]).includes(constraint)
      ) {
        throw new ExerciseParseError(
          `${where}: "constraint" must be one of ${CONSTRAINT_KINDS.join(", ")}`,
        );
      }
      return {
        kind: "forbids_population",
        factType: str(v, "factType", where),
        constraint: constraint as ConstraintKind,
        ...guidance,
      };
    }
  }
}

export function parseExercise(data: unknown): GymExercise {
  if (!isRecord(data)) throw new ExerciseParseError("exercise must be a YAML mapping");

  if (data["difficulty"] !== undefined) {
    throw new ExerciseParseError(
      `exercise: "difficulty" was replaced by the C1 front matter -- declare `
        + `"transition" ({ from, to } on the proficiency scale) and `
        + `"exitPerformance" instead`,
    );
  }

  const rawChecks = data["checks"];
  if (!Array.isArray(rawChecks) || rawChecks.length === 0) {
    throw new ExerciseParseError(`exercise: "checks" must be a non-empty array`);
  }

  return {
    id: str(data, "id", "exercise"),
    title: str(data, "title", "exercise"),
    transition: parseTransition(data["transition"]),
    exitPerformance: str(data, "exitPerformance", "exercise"),
    brief: str(data, "brief", "exercise"),
    reading: optStr(data, "reading", "exercise"),
    starter: optStr(data, "starter", "exercise"),
    reference: optStr(data, "reference", "exercise"),
    checks: rawChecks.map(parseCheck),
  };
}
