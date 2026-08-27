/**
 * Validate an untrusted parsed `.gym.yaml` document into a typed
 * `GymExercise`, throwing a descriptive error on any malformed field.
 * Pure -- no I/O -- so it is testable without the filesystem and reusable
 * by any loader.
 */
import { normalizeForMatch } from "../evaluate/nameResolution.js";
import {
  type CheckGuidance,
  type ConstraintKind,
  type ElementQuery,
  type GymCheck,
  type GymExercise,
  type GymTransition,
  type NameLicence,
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
} from "./types.js";

// Record-typed so the parser's accepted-value lists cannot lag the
// unions in types.ts: a bare `readonly ConstraintKind[]` checks
// membership but not completeness, and the old CHECK_KINDS had no
// type link at all (barwise-869).
const CONSTRAINT_KIND_MEMBERS: Record<ConstraintKind, true> = {
  internal_uniqueness: true,
  mandatory: true,
  value: true,
  frequency: true,
  ring: true,
};
const CONSTRAINT_KINDS = Object.keys(CONSTRAINT_KIND_MEMBERS) as readonly ConstraintKind[];
const CHECK_KIND_MEMBERS: Record<GymCheck["kind"], true> = {
  must_validate: true,
  requires_verbalization: true,
  forbids_population: true,
  requires_element: true,
};
const CHECK_KINDS = Object.keys(CHECK_KIND_MEMBERS) as readonly GymCheck["kind"][];

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

/**
 * The optional `vocabulary` block: licence sets of names that denote
 * one concept each (docs/specs/eval-name-licensing.spec.md).
 *
 * A set needs at least two words -- one word licenses nothing -- and a
 * word may appear in only one set (compared normalized, the same way
 * resolution compares), because sets are symmetric: a shared word would
 * make two rubric names collide through the licence. Exported because
 * promptlab's eval-case loader accepts the identical block; one parser
 * keeps the two formats from drifting.
 */
export function parseVocabulary(v: unknown, where: string): NameLicence | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0) {
    throw new ExerciseParseError(
      `${where}: "vocabulary" must be a non-empty list of name sets when declared`,
    );
  }
  const seen = new Map<string, string>();
  const licence = v.map((set, i) => {
    if (
      !Array.isArray(set) || set.length < 2
      || set.some((w) => typeof w !== "string" || w.length === 0)
    ) {
      throw new ExerciseParseError(
        `${where}: "vocabulary[${i}]" must list at least two non-empty name strings`,
      );
    }
    for (const word of set as string[]) {
      const key = normalizeForMatch(word);
      const clash = seen.get(key);
      if (clash !== undefined) {
        throw new ExerciseParseError(
          `${where}: "vocabulary" licenses "${word}" twice (already declared as "${clash}") `
            + `-- a word may appear in only one set`,
        );
      }
      seen.set(key, word);
    }
    return set as readonly string[];
  });
  return licence;
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
    vocabulary: parseVocabulary(data["vocabulary"], "exercise"),
    checks: rawChecks.map(parseCheck),
  };
}
