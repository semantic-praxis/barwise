import { OrmYamlSerializer } from "@barwise/core";
import type { GymCheck } from "@barwise/learn";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type {
  EvalCase,
  EvalSuite,
  LoadedEvalCase,
  PromptCheck,
  SuiteSplit,
  SuiteWeights,
} from "./types.js";

/**
 * Checks `@barwise/learn` evaluates against the parsed model.
 * Record-typed over the imported GymCheck union so a fifth check kind
 * added in learn is a compile error here instead of promptlab
 * silently rejecting every suite case that uses it (barwise-869; this
 * was a third, cross-package copy of the list).
 */
const GYM_CHECK_KIND_MEMBERS: Record<GymCheck["kind"], true> = {
  must_validate: true,
  requires_verbalization: true,
  forbids_population: true,
  requires_element: true,
};
const GYM_CHECK_KINDS = Object.keys(GYM_CHECK_KIND_MEMBERS) as readonly GymCheck["kind"][];

/** Checks promptlab evaluates against the extraction payload. */
const PROMPT_CHECK_KINDS = ["requires_ambiguity"] as const;

const CHECK_KINDS = [...GYM_CHECK_KINDS, ...PROMPT_CHECK_KINDS] as const;

/** The packaged seed suite's manifest path. */
export function defaultSuitePath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../evals/suite.yaml",
  );
}

/**
 * Load a suite manifest and every case it declares. Cases are loaded in
 * manifest order -- declared, not discovered.
 */
export function loadSuite(manifestPath: string): EvalSuite {
  const absManifest = resolve(manifestPath);
  const doc = parseMapping(readFileSync(absManifest, "utf8"), absManifest);

  const version = doc["version"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`${absManifest}: "version" must be a non-empty string.`);
  }

  const weights = validateWeights(doc["weights"], absManifest);
  const collapseFloor = validateCollapseFloor(doc["collapseFloor"], absManifest);

  const casePaths = doc["cases"];
  if (!Array.isArray(casePaths) || casePaths.length === 0) {
    throw new Error(`${absManifest}: "cases" must be a non-empty list of file paths.`);
  }

  const suiteDir = dirname(absManifest);
  const cases = casePaths.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`${absManifest}: every entry in "cases" must be a path string.`);
    }
    return loadEvalCase(resolve(suiteDir, entry));
  });

  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.evalCase.id)) {
      throw new Error(`${absManifest}: duplicate case id "${c.evalCase.id}".`);
    }
    ids.add(c.evalCase.id);
  }

  const splits = validateSplits(doc["splits"], ids, absManifest);
  const withSplits = splits === undefined
    ? cases
    : cases.map((c) => ({ ...c, split: splits.get(c.evalCase.id)! }));

  return {
    version,
    weights,
    ...(collapseFloor !== undefined ? { collapseFloor } : {}),
    cases: withSplits,
    manifestPath: absManifest,
  };
}

/** Load and validate a single `.eval.yaml` case with its transcript and reference. */
export function loadEvalCase(filePath: string): LoadedEvalCase {
  const absPath = resolve(filePath);
  const doc = parseMapping(readFileSync(absPath, "utf8"), absPath);

  const id = doc["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${absPath}: "id" must be a non-empty string.`);
  }

  const transcriptPath = doc["transcript"];
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) {
    throw new Error(`${absPath}: "transcript" must be a file path.`);
  }

  const referencePath = doc["reference"];
  if (referencePath !== undefined && typeof referencePath !== "string") {
    throw new Error(`${absPath}: "reference" must be a file path.`);
  }

  const ambiguityBudget = doc["ambiguityBudget"];
  if (
    ambiguityBudget !== undefined
    && (typeof ambiguityBudget !== "number"
      || !Number.isInteger(ambiguityBudget)
      || ambiguityBudget < 0)
  ) {
    throw new Error(`${absPath}: "ambiguityBudget" must be a non-negative integer.`);
  }

  const checks = validateChecks(doc["checks"], absPath);

  const caseDir = dirname(absPath);
  const transcript = readFileSync(resolve(caseDir, transcriptPath), "utf8");

  let reference;
  if (referencePath !== undefined) {
    reference = new OrmYamlSerializer().deserialize(
      readFileSync(resolve(caseDir, referencePath), "utf8"),
    );
  }

  if (
    reference === undefined
    && checks.some((c) => c.kind === "forbids_population")
  ) {
    throw new Error(
      `${absPath}: a "forbids_population" check requires a "reference" model.`,
    );
  }

  const evalCase: EvalCase = {
    id,
    transcript: transcriptPath,
    ...(referencePath !== undefined ? { reference: referencePath } : {}),
    ...(ambiguityBudget !== undefined ? { ambiguityBudget } : {}),
    checks,
  };
  return {
    evalCase,
    transcript,
    ...(reference !== undefined ? { reference } : {}),
    filePath: absPath,
  };
}

function parseMapping(raw: string, filePath: string): Record<string, unknown> {
  const doc: unknown = parse(raw);
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error(`${filePath}: must be a YAML mapping.`);
  }
  return doc as Record<string, unknown>;
}

/**
 * The train/dev assignment, when declared.
 *
 * Every declared case must appear in exactly one split. The alternative
 * -- defaulting unlisted cases to train -- silently swallows the
 * commonest mistake, which is adding a case and forgetting to place it,
 * and a case that quietly joins the training set is a case that can no
 * longer detect overfitting (eval-metric-readiness spec).
 */
function validateSplits(
  value: unknown,
  ids: ReadonlySet<string>,
  manifestPath: string,
): Map<string, SuiteSplit> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath}: "splits" must be a mapping of split name to case ids.`);
  }
  const obj = value as Record<string, unknown>;
  const assigned = new Map<string, SuiteSplit>();
  for (const name of ["train", "dev"] as const) {
    const listed = obj[name] ?? [];
    if (!Array.isArray(listed)) {
      throw new Error(`${manifestPath}: "splits.${name}" must be a list of case ids.`);
    }
    for (const id of listed) {
      if (typeof id !== "string") {
        throw new Error(`${manifestPath}: "splits.${name}" must list case ids as strings.`);
      }
      if (!ids.has(id)) {
        throw new Error(`${manifestPath}: "splits.${name}" names unknown case "${id}".`);
      }
      if (assigned.has(id)) {
        throw new Error(`${manifestPath}: case "${id}" appears in more than one split.`);
      }
      assigned.set(id, name);
    }
  }
  const unassigned = [...ids].filter((id) => !assigned.has(id));
  if (unassigned.length > 0) {
    throw new Error(
      `${manifestPath}: every case must be assigned to a split when "splits" is declared;`
        + ` missing: ${unassigned.join(", ")}.`,
    );
  }
  return assigned;
}

/**
 * The collapse floor, when declared. Bounded to [0, 1) because a floor
 * of 1 would call every imperfect sample a collapse, which is not a
 * split but a different metric wearing the same name.
 */
function validateCollapseFloor(value: unknown, manifestPath: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !(value >= 0) || value >= 1) {
    throw new Error(
      `${manifestPath}: "collapseFloor" must be a number in [0, 1) when declared.`,
    );
  }
  return value;
}

function validateWeights(value: unknown, manifestPath: string): SuiteWeights {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${manifestPath}: "weights" must be a mapping.`);
  }
  const obj = value as Record<string, unknown>;
  const conformanceCorrection = obj["conformanceCorrection"];
  const validationError = obj["validationError"];
  // The defaults track the 2.0.0 manifest rather than 0, and that is
  // deliberate. Rating the penalties changed what a weight *means*
  // without changing its type, so nothing a compiler can see separates
  // a count-era manifest from a rate-era one; a manifest that omits a
  // weight would otherwise inherit a number fitted to the old scale and
  // score on a third scale that is neither
  // (docs/specs/eval-split-stratification.spec.md).
  const validationWarning = obj["validationWarning"] ?? 0.4;
  const ambiguityExcess = obj["ambiguityExcess"] ?? 0.02;
  if (
    typeof conformanceCorrection !== "number"
    || typeof validationError !== "number"
    || typeof validationWarning !== "number"
    || typeof ambiguityExcess !== "number"
    || conformanceCorrection < 0
    || validationError < 0
    || validationWarning < 0
    || ambiguityExcess < 0
  ) {
    throw new Error(
      `${manifestPath}: weights need non-negative numbers`
        + ` "conformanceCorrection" and "validationError"`
        + ` (and, when declared, "validationWarning" and "ambiguityExcess").`,
    );
  }
  return { conformanceCorrection, validationError, validationWarning, ambiguityExcess };
}

function validateChecks(value: unknown, filePath: string): (GymCheck | PromptCheck)[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${filePath}: "checks" must be a non-empty list.`);
  }
  return value.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${filePath}: checks[${i}] must be a mapping.`);
    }
    const check = entry as Record<string, unknown>;
    const kind = check["kind"];
    if (typeof kind !== "string" || !CHECK_KINDS.includes(kind as (typeof CHECK_KINDS)[number])) {
      throw new Error(
        `${filePath}: checks[${i}].kind must be one of ${CHECK_KINDS.join(", ")}.`,
      );
    }
    switch (kind) {
      case "requires_verbalization":
        if (typeof check["sentence"] !== "string") {
          throw new Error(`${filePath}: checks[${i}] needs a string "sentence".`);
        }
        break;
      case "forbids_population":
        if (typeof check["factType"] !== "string" || typeof check["constraint"] !== "string") {
          throw new Error(
            `${filePath}: checks[${i}] needs string "factType" and "constraint".`,
          );
        }
        break;
      case "requires_element":
        if (typeof check["element"] !== "object" || check["element"] === null) {
          throw new Error(`${filePath}: checks[${i}] needs an "element" query.`);
        }
        break;
      case "requires_ambiguity": {
        const matches = check["matches"];
        if (
          !Array.isArray(matches)
          || matches.length === 0
          || matches.some((m) => typeof m !== "string" || m.length === 0)
        ) {
          throw new Error(
            `${filePath}: checks[${i}] needs a non-empty "matches" list of non-empty strings.`,
          );
        }
        break;
      }
      case "must_validate":
        break;
    }
    return entry as GymCheck | PromptCheck;
  });
}
