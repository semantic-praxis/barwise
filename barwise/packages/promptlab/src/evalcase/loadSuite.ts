import { OrmYamlSerializer } from "@barwise/core";
import type { GymCheck } from "@barwise/learn";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { EvalCase, EvalSuite, LoadedEvalCase, SuiteWeights } from "./types.js";

const CHECK_KINDS = [
  "must_validate",
  "requires_verbalization",
  "forbids_population",
  "requires_element",
] as const;

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

  return {
    version,
    weights,
    cases,
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

function validateWeights(value: unknown, manifestPath: string): SuiteWeights {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${manifestPath}: "weights" must be a mapping.`);
  }
  const obj = value as Record<string, unknown>;
  const conformanceCorrection = obj["conformanceCorrection"];
  const validationError = obj["validationError"];
  if (
    typeof conformanceCorrection !== "number"
    || typeof validationError !== "number"
    || conformanceCorrection < 0
    || validationError < 0
  ) {
    throw new Error(
      `${manifestPath}: weights need non-negative numbers`
        + ` "conformanceCorrection" and "validationError".`,
    );
  }
  return { conformanceCorrection, validationError };
}

function validateChecks(value: unknown, filePath: string): GymCheck[] {
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
      case "must_validate":
        break;
    }
    return entry as GymCheck;
  });
}
