import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type {
  PromptArtifact,
  PromptArtifactMatch,
  PromptDemo,
  PromptProvenance,
  PromptSurface,
} from "./PromptArtifact.js";

const SURFACES: readonly PromptSurface[] = ["extraction", "review"];

/** Load and validate a single `.prompt.yaml` artifact file. */
export function loadArtifact(filePath: string): PromptArtifact {
  const raw = readFileSync(filePath, "utf8");
  const doc: unknown = parse(raw);
  return validateArtifact(doc, filePath);
}

/**
 * Load every `.prompt.yaml` file in a directory, sorted by filename so
 * the result is stable across platforms.
 */
export function loadArtifactsFromDir(dir: string): PromptArtifact[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".prompt.yaml"))
    .sort()
    .map((name) => loadArtifact(join(dir, name)));
}

function validateArtifact(doc: unknown, filePath: string): PromptArtifact {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error(`${filePath}: artifact must be a YAML mapping.`);
  }
  const obj = doc as Record<string, unknown>;

  const surface = obj["surface"];
  if (typeof surface !== "string" || !SURFACES.includes(surface as PromptSurface)) {
    throw new Error(
      `${filePath}: "surface" must be one of ${SURFACES.join(", ")}.`,
    );
  }

  const version = obj["version"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`${filePath}: "version" must be a non-empty string.`);
  }

  const instructions = obj["instructions"];
  if (typeof instructions !== "string" || instructions.length === 0) {
    throw new Error(`${filePath}: "instructions" must be a non-empty string.`);
  }

  return {
    surface: surface as PromptSurface,
    version,
    instructions,
    demos: validateDemos(obj["demos"], filePath),
    ...(obj["match"] !== undefined
      ? { match: validateMatch(obj["match"], filePath) }
      : {}),
    ...(obj["provenance"] !== undefined
      ? { provenance: validateProvenance(obj["provenance"], filePath) }
      : {}),
  };
}

function validateDemos(value: unknown, filePath: string): PromptDemo[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${filePath}: "demos" must be a list.`);
  }
  return value.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${filePath}: demos[${i}] must be a mapping.`);
    }
    const demo = entry as Record<string, unknown>;
    const transcriptExcerpt = demo["transcriptExcerpt"];
    const extraction = demo["extraction"];
    if (typeof transcriptExcerpt !== "string" || typeof extraction !== "string") {
      throw new Error(
        `${filePath}: demos[${i}] needs string "transcriptExcerpt" and "extraction".`,
      );
    }
    return { transcriptExcerpt, extraction };
  });
}

function validateMatch(value: unknown, filePath: string): PromptArtifactMatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${filePath}: "match" must be a mapping.`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of ["provider", "modelPrefix"]) {
    if (obj[key] !== undefined && typeof obj[key] !== "string") {
      throw new Error(`${filePath}: match.${key} must be a string.`);
    }
  }
  return {
    ...(obj["provider"] !== undefined ? { provider: obj["provider"] as string } : {}),
    ...(obj["modelPrefix"] !== undefined
      ? { modelPrefix: obj["modelPrefix"] as string }
      : {}),
  };
}

function validateProvenance(value: unknown, filePath: string): PromptProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${filePath}: "provenance" must be a mapping.`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of ["optimizer", "proposerModel", "scoredAgainst", "suiteVersion", "date"]) {
    if (obj[key] !== undefined && typeof obj[key] !== "string") {
      throw new Error(`${filePath}: provenance.${key} must be a string.`);
    }
  }
  if (obj["score"] !== undefined && typeof obj["score"] !== "number") {
    throw new Error(`${filePath}: provenance.score must be a number.`);
  }
  return {
    ...(obj["optimizer"] !== undefined ? { optimizer: obj["optimizer"] as string } : {}),
    ...(obj["proposerModel"] !== undefined
      ? { proposerModel: obj["proposerModel"] as string }
      : {}),
    ...(obj["scoredAgainst"] !== undefined
      ? { scoredAgainst: obj["scoredAgainst"] as string }
      : {}),
    ...(obj["suiteVersion"] !== undefined
      ? { suiteVersion: obj["suiteVersion"] as string }
      : {}),
    ...(obj["score"] !== undefined ? { score: obj["score"] as number } : {}),
    ...(obj["date"] !== undefined ? { date: obj["date"] as string } : {}),
  };
}
