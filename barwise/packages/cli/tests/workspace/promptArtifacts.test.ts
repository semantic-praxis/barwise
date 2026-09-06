/**
 * The artifact candidate set, tested at the producer.
 *
 * A consumer test cannot pin this. Both `prompt eval` and
 * `prompt artifact` fall back to the default artifact when nothing
 * resolves, so a candidate set that silently loses the built-ins still
 * yields a plausible run and a plausible printout -- which is exactly
 * how `eval` came to measure the default prompt for months while
 * echoing back the provider and model it had been given.
 *
 * That is the barwise-840 shape again, and the reason optimizer/CLAUDE.md
 * says to mutate the producer of any value a test feeds in by hand.
 *
 * Mutation-checked, four breakages, each caught -- but NOT one-for-one,
 * and the overlap is worth recording rather than tidying away:
 *
 *   return [] when no dir is given          -> ships-the-built-ins, resolves-the-shipped-variant
 *   drop the de-duplication                 -> replaces-the-built-in, takes-the-directory's-copy
 *   dedupe on surface instead of version    -> still-refuses, does-NOT-rank
 *   let the builtin win a collision         -> takes-the-directory's-copy        (alone)
 *
 * Three of four trip a pair, because each pair asserts one fact at two
 * altitudes: the candidate list, and the resolution a caller gets from
 * it. That is deliberate here -- the list is what broke and the
 * resolution is what an operator sees -- but it does mean these tests
 * are not independent, and a future mutation tripping only the lower
 * one has not been shown to matter to anybody.
 */
import { builtinArtifacts, defaultReviewArtifact, resolveArtifact } from "@barwise/llm";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactByVersion, artifactCandidates } from "../../src/workspace/promptArtifacts.js";

const here = dirname(fileURLToPath(import.meta.url));
/** The files the built-ins are generated FROM -- the collision case. */
const PROMPTS = resolve(here, "../../../llm/prompts");

const HAIKU = { surface: "extraction", provider: "anthropic", model: "claude-haiku-4-5" } as const;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-artifacts-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeVariant(version: string, match: string[], marker = "MARKER"): void {
  writeFileSync(
    join(dir, `extraction.${version}.prompt.yaml`),
    [
      "surface: extraction",
      `version: ${version}`,
      "match:",
      ...match.map((m) => `  ${m}`),
      "instructions: |-",
      `  ${marker}`,
      "",
    ].join("\n"),
  );
}

describe("artifactCandidates", () => {
  it("ships the built-in variants even when no directory is given", () => {
    // The defect this exists for: resolution behind `if (opts.artifacts)`,
    // so a run with no --artifacts never saw haiku45-2 at all and sent
    // the default to a model that has a variant.
    const versions = artifactCandidates().map((a) => a.version);

    expect(versions).toContain("haiku45-2");
    expect(versions).toContain("sonnet5-3");
    expect(versions).toHaveLength(builtinArtifacts.length);
  });

  it("resolves the shipped variant for the model the eval suite runs against", () => {
    // The end-to-end consequence, stated as the resolution an operator
    // asks for: `--provider anthropic --model claude-haiku-4-5`.
    expect(resolveArtifact(artifactCandidates(), HAIKU)?.version).toBe("haiku45-2");
  });

  it("lets a directory entry replace the built-in of the same version", () => {
    // Pointing --artifacts at packages/llm/prompts/ loaded every shipped
    // variant a second time and the resolver refused as ambiguous, so
    // the documented way to evaluate a variant was the one way that
    // could not work.
    expect(() => resolveArtifact(artifactCandidates(PROMPTS), HAIKU)).not.toThrow();
    expect(resolveArtifact(artifactCandidates(PROMPTS), HAIKU)?.version).toBe("haiku45-2");
  });

  it("takes the directory's copy, not the built-in, on a version collision", () => {
    // De-duplication alone is not enough: dropping the LOCAL copy would
    // also stop the throw, and would silently ignore the edit under test.
    writeVariant(
      "haiku45-2",
      ["provider: anthropic", "modelPrefix: claude-haiku"],
      "EDITED-LOCALLY",
    );

    const resolved = resolveArtifact(artifactCandidates(dir), HAIKU);

    expect(resolved?.version).toBe("haiku45-2");
    expect(resolved?.instructions).toContain("EDITED-LOCALLY");
  });

  it("still refuses two variants of equal specificity under different versions", () => {
    // The guard has to survive the fix. This is a real question about
    // which of two distinct prompts to send, and only the operator can
    // settle it -- unlike a version collision, which is one prompt
    // loaded twice.
    writeVariant("local-rival-1", ["provider: anthropic", "modelPrefix: claude-haiku"]);

    expect(() => resolveArtifact(artifactCandidates(dir), HAIKU)).toThrow(/Ambiguous/);
  });

  it("leaves a local variant free to win by matching where a built-in cannot", () => {
    // The case --artifacts exists to serve: a variant for a model no
    // shipped artifact claims.
    writeVariant("local-opus-1", ["provider: anthropic", "modelPrefix: claude-opus"]);

    const resolved = resolveArtifact(artifactCandidates(dir), {
      surface: "extraction",
      provider: "anthropic",
      model: "claude-opus-5",
    });

    expect(resolved?.version).toBe("local-opus-1");
  });

  it("ranks a narrower modelPrefix above the shipped broader one (barwise-854)", () => {
    // The shape anyone testing a per-release variant against the
    // shipped per-family one hits first. This used to be pinned as a
    // refusal ("Ambiguous ... narrow the match blocks" -- the one thing
    // the operator had already done); `specificity` now breaks the
    // field tie on prefix length.
    writeVariant("local-narrow-1", ["provider: anthropic", "modelPrefix: claude-haiku-4-5-2026"]);

    const resolved = resolveArtifact(artifactCandidates(dir), {
      surface: "extraction",
      provider: "anthropic",
      model: "claude-haiku-4-5-20261001",
    });
    expect(resolved?.version).toBe("local-narrow-1");
  });

  it("reads an empty directory as no override rather than as no built-ins", () => {
    mkdirSync(join(dir, "empty"));
    expect(artifactCandidates(join(dir, "empty")).map((a) => a.version)).toContain("haiku45-2");
  });
});

describe("artifactByVersion", () => {
  it("resolves 'default' to the review surface's default artifact", () => {
    expect(artifactByVersion([], "review", "default").version).toBe(defaultReviewArtifact.version);
  });

  it("resolves a single exact version match", () => {
    const candidates = artifactCandidates();
    expect(artifactByVersion(candidates, "extraction", "haiku45-2").version).toBe("haiku45-2");
  });

  it("throws naming the available versions when nothing matches", () => {
    expect(() => artifactByVersion(artifactCandidates(), "extraction", "no-such-version"))
      .toThrow(/No extraction artifact has version "no-such-version"\. Available: default,/);
  });

  it("throws when a version is ambiguous across more than one artifact", () => {
    const dup = { surface: "extraction" as const, version: "dup-1", instructions: "x", demos: [] };
    expect(() => artifactByVersion([dup, dup], "extraction", "dup-1"))
      .toThrow(/ambiguous: 2 extraction artifacts carry it/);
  });
});
