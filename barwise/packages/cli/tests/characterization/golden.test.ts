/**
 * Characterization tests: pin the current CLI output for a fixed set of
 * example models, so any behavior change during the architecture refactor
 * fails loudly. Golden files (not inline snapshots) match the repo's
 * existing practice; regenerate them intentionally with
 * `UPDATE_GOLDEN=1 npx vitest run characterization` and review the diff.
 *
 * Diagram output is layout-sensitive, so it is checked by structural
 * invariant (well-formed SVG) rather than a brittle golden.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";
import {
  CHECKED_FORMATS,
  type CheckedFormat,
  claimedFormat,
  formatDefects,
} from "./formatDefects.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const goldenDir = join(here, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

// Absolute paths leak into some output (validate prints the source path),
// so normalize the repo root to a stable token; goldens stay machine-
// independent across local and CI checkouts.
function normalize(text: string): string {
  return text.split(repoRoot).join("<REPO>");
}

/**
 * A golden is checked against the LAST run's bytes and, where its name
 * claims a format, against that format.
 *
 * The two halves catch different things and the second was missing for
 * as long as the goldens existed: three were invalid documents and the
 * diff was green on every one, because a diff cannot tell a valid file
 * from an identical invalid one (barwise-961). See formatDefects.ts.
 *
 * The check runs on the UPDATE path as well, because regeneration is
 * how the three invalid files came to be recorded in the first place.
 * `UPDATE_GOLDEN=1` writing something no run can parse is not a refresh.
 */
function checkFormat(name: string, format: CheckedFormat, text: string): void {
  expect(
    formatDefects(format, text),
    `${name} is not a valid ${format} document`,
  ).toEqual([]);
}

function checkGolden(name: string, actual: string): void {
  const path = join(goldenDir, name);
  const normalized = normalize(actual);
  const format = claimedFormat(name);
  if (format !== undefined) checkFormat(name, format, normalized);
  if (UPDATE) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(path, normalized, "utf-8");
    return;
  }
  const expected = existsSync(path) ? readFileSync(path, "utf-8") : "<missing golden>";
  // The recorded file is checked BEFORE the diff, not after. A golden
  // that is an invalid document fails as one; left until after the
  // comparison it would only ever report as a mismatch, which sends the
  // reader to the exporter for a defect that is in the file.
  if (format !== undefined && existsSync(path)) checkFormat(`recorded ${name}`, format, expected);
  expect(normalized, `golden mismatch for ${name}; run UPDATE_GOLDEN=1 to refresh`).toBe(expected);
}

interface ModelFixture {
  readonly id: string;
  readonly path: string;
}

const MODELS: readonly ModelFixture[] = [
  {
    id: "clinic-appointments",
    path: resolve(repoRoot, "examples/transcripts/clinic-appointments.orm.yaml"),
  },
  {
    id: "constraints-showcase",
    path: resolve(repoRoot, "test-plan/fixtures/constraints-showcase.orm.yaml"),
  },
  {
    id: "external-uniqueness",
    path: resolve(repoRoot, "test-plan/fixtures/external-uniqueness.orm.yaml"),
  },
];

// Derived from the same list the validators switch over, so a format
// added here with no validator is a compile error rather than a golden
// that is silently never checked.
const EXPORT_FORMATS = CHECKED_FORMATS;

describe("characterization: stable CLI output over example models", () => {
  for (const m of MODELS) {
    it(`${m.id}: verbalize`, async () => {
      const r = await runCli(["verbalize", m.path]);
      expect(r.exitCode).toBe(0);
      checkGolden(`${m.id}.verbalize.txt`, r.stdout);
    });

    it(`${m.id}: validate`, async () => {
      const r = await runCli(["validate", m.path]);
      checkGolden(`${m.id}.validate.txt`, r.stdout);
    });

    for (const fmt of EXPORT_FORMATS) {
      it(`${m.id}: export ${fmt}`, async () => {
        const r = await runCli(["export", m.path, "--format", fmt]);
        expect(r.exitCode).toBe(0);
        checkGolden(`${m.id}.${fmt}.txt`, r.stdout);
      });
    }

    it(`${m.id}: diagram is well-formed SVG`, async () => {
      const r = await runCli(["diagram", m.path]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("<svg");
      expect(r.stdout.trimEnd().endsWith("</svg>")).toBe(true);
    });
  }
});
