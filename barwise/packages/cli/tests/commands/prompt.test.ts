/**
 * Tests for the prompt command's LLM-free subcommands: score against
 * the packaged suite, schema export, and history rendering. `prompt
 * eval` needs a live provider and is exercised manually per the
 * tests/live policy.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const responsesDir = resolve(
  __dirname,
  "../../../promptlab/tests/fixtures/responses",
);

describe("barwise prompt score", () => {
  it("scores a recorded payload against its case", async () => {
    const result = await runCli([
      "prompt",
      "score",
      "--case",
      "order-management",
      "--extraction",
      join(responsesDir, "order-management.json"),
    ]);
    expect(result.exitCode).toBe(0);
    const score = JSON.parse(result.stdout);
    expect(score.caseId).toBe("order-management");
    expect(score.rubricPassed).toBe(score.rubricTotal);
    expect(score.score).toBeCloseTo(1, 10);
  });

  it("reports an unknown case id with the available ids", async () => {
    const result = await runCli([
      "prompt",
      "score",
      "--case",
      "nope",
      "--extraction",
      join(responsesDir, "order-management.json"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown case "nope"');
    expect(result.stderr).toContain("order-management");
  });
});

describe("barwise prompt eval", () => {
  it("offers --verbose, and does not turn it on by default", async () => {
    // Opt-in on purpose: the default output is what every script and
    // every recorded run so far has parsed. Asserted on the flag list
    // rather than the description, which commander wraps at the
    // terminal width and would make this a test of formatting.
    const result = await runCli(["prompt", "eval", "--help"]);
    expect(result.stdout).toContain("--verbose");
    expect(result.stdout).not.toContain("--no-verbose");
  });

  it("rejects an unknown split before spending a call", async () => {
    // The guard runs before the client is used, so a typo costs nothing
    // rather than a suite's worth of API calls against the wrong set.
    const result = await runCli(["prompt", "eval", "--split", "trian"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown split "trian"');
    expect(result.stderr).toContain("train");
  });

  it("offers --max-tokens", async () => {
    // Asserted on the flag name alone: commander wraps the description
    // at the terminal width, which would make this a formatting test.
    const result = await runCli(["prompt", "eval", "--help"]);
    expect(result.stdout).toContain("--max-tokens");
  });

  it("offers --context-window, and reaches the client with it", async () => {
    // The flag exists to be reachable: an option parsed and then not
    // passed to the provider is the built-but-unwired class this repo
    // audits for. Asserted here on the flag; the wiring itself is
    // covered by the provider tests reading num_ctx off the request.
    const result = await runCli(["prompt", "eval", "--help"]);
    expect(result.stdout).toContain("--context-window");
  });

  it("rejects a nonsense context window before spending a call", async () => {
    const result = await runCli(["prompt", "eval", "--context-window", "wide"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--context-window must be a positive integer");
  });

  it("rejects a nonsense budget before spending a call", async () => {
    // Same reasoning as the split guard. A budget that reaches the
    // provider as NaN costs a sweep to discover.
    for (const value of ["lots", "0", "-1", "8192.5"]) {
      const result = await runCli(["prompt", "eval", "--max-tokens", value]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--max-tokens must be a positive integer");
    }
  });
});

describe("barwise prompt schema", () => {
  it("prints the extraction structured-output schema", async () => {
    const result = await runCli(["prompt", "schema"]);
    expect(result.exitCode).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(schema.properties).toHaveProperty("object_types");
    expect(schema.properties).toHaveProperty("fact_types");
  });

  it("prints the review structured-output schema", async () => {
    // The previous test here asserted the opposite: it pinned the
    // refusal of `--surface review` as if the refusal were a
    // requirement, when it was a limitation that outlived the review
    // surface gaining a schema (barwise-855, the same shape as PR #338
    // on `prompt artifact`).
    const result = await runCli(["prompt", "schema", "--surface", "review"]);
    expect(result.exitCode).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(schema.properties).toHaveProperty("suggestions");
    expect(schema.properties).toHaveProperty("summary");
    // The extraction schema by mistake would be the silent failure.
    expect(schema.properties).not.toHaveProperty("object_types");
  });

  it("rejects a surface that is not a surface", async () => {
    const result = await runCli(["prompt", "schema", "--surface", "agent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Use "extraction" or "review"');
  });
});

describe("barwise prompt artifact", () => {
  it("prints the default artifact's instructions when no target is given", async () => {
    const { stdout, exitCode } = await runCli(["prompt", "artifact"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Object-Role Modeling");
    expect(stdout.length).toBeGreaterThan(10000);
  });

  it("resolves the variant for a provider and model", async () => {
    const { stdout } = await runCli([
      "prompt",
      "artifact",
      "--provider",
      "anthropic",
      "--model",
      "claude-haiku-4-5",
      "--format",
      "json",
    ]);

    expect((JSON.parse(stdout) as { version: string; }).version).toBe("haiku45-2");
  });

  it("shows the barwise-842 trap rather than requiring a paid run to find it", async () => {
    // Artifact resolution here keys on the (provider, model) pair, so
    // omitting --provider falls back to the default. `prompt eval` no
    // longer behaves this way -- it resolves from the client, which
    // knows its own provider -- but this command deliberately answers a
    // hypothetical about the flags it was given.
    const { stdout, stderr } = await runCli([
      "prompt",
      "artifact",
      "--model",
      "claude-haiku-4-5",
      "--format",
      "json",
    ]);

    expect((JSON.parse(stdout) as { version: string; }).version).not.toBe("haiku45-2");
    // And it must SAY that is what happened. Printing a fallback and a
    // match identically is what let the same silence live in `eval`.
    expect(stderr).toContain("No extraction variant matches");
  });

  it("prints the review surface, which is artifact-driven too", async () => {
    // barwise-847 wired reviewModel to the artifact seam and this
    // command went on refusing the surface, so the one tool whose job
    // is "which prompt would this configuration send" could not answer
    // for the surface that had just started having an answer.
    const { stdout, exitCode } = await runCli([
      "prompt",
      "artifact",
      "--surface",
      "review",
      "--provider",
      "anthropic",
      "--model",
      "claude-haiku-4-5",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("reviewing a conceptual model for semantic quality");
    // Not the extraction prompt, which is what a surface-blind
    // resolution would have printed.
    expect(stdout).not.toContain("extract a structured ORM conceptual model");
  });

  it("rejects a surface that is not a surface", async () => {
    const { stderr, exitCode } = await runCli(["prompt", "artifact", "--surface", "agent"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Use "extraction" or "review"');
  });

  it("takes --artifacts pointed at the directory the built-ins come from", async () => {
    // barwise-851: this is the documented way to evaluate a shipped
    // variant, and it was the one way that could not work -- every
    // variant loaded twice and the resolver refused as ambiguous.
    const prompts = resolve(__dirname, "../../../llm/prompts");
    const { stdout, exitCode } = await runCli([
      "prompt",
      "artifact",
      "--provider",
      "anthropic",
      "--model",
      "claude-haiku-4-5",
      "--artifacts",
      prompts,
      "--format",
      "json",
    ]);

    expect(exitCode).toBe(0);
    expect((JSON.parse(stdout) as { version: string; }).version).toBe("haiku45-2");
  });
});

describe("barwise prompt history", () => {
  it("reports an empty history for a fresh suite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompt-"));
    writeFileSync(join(dir, "t.md"), "Facilitator: hi.\n");
    writeFileSync(
      join(dir, "case.eval.yaml"),
      "id: c\ntranscript: t.md\nchecks:\n  - kind: must_validate\n",
    );
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0.02, validationError: 0.1}\n"
        + "cases: [case.eval.yaml]\n",
    );
    const result = await runCli(["prompt", "history", "--suite", manifest]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No recorded eval runs");
  });

  it("prints an error bar, and a question mark where the run never had one", async () => {
    // The listing is where two runs get compared, so this is the line
    // that decides whether someone subtracts two means without knowing
    // the noise. A row predating the field prints "+/- ?" rather than a
    // bare mean: unknown precision is not the same as tight precision.
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompt-"));
    writeFileSync(join(dir, "t.md"), "Facilitator: hi.\n");
    writeFileSync(
      join(dir, "case.eval.yaml"),
      "id: c\ntranscript: t.md\nchecks:\n  - kind: must_validate\n",
    );
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0.02, validationError: 0.1}\n"
        + "cases: [case.eval.yaml]\n",
    );
    const row = (extra: Record<string, unknown>) =>
      JSON.stringify({
        date: "2026-08-20T00:00:00Z",
        suiteVersion: "1.0.0",
        artifactVersion: "1.0.0",
        repeat: 5,
        mean: 0.916,
        worst: 0.0,
        cases: [],
        ...extra,
      });
    writeFileSync(
      join(dir, "history.jsonl"),
      row({}) + "\n" + row({ standardError: 0.0318 }) + "\n",
    );

    const result = await runCli(["prompt", "history", "--suite", manifest]);
    expect(result.exitCode).toBe(0);
    const [legacy, current] = result.stdout.trim().split("\n");
    expect(legacy).toContain("mean=0.916 +/- ?");
    // 1.96 * 0.0318 = 0.0623
    expect(current).toContain("mean=0.916 +/- 0.062");
  });

  it("shows the prompt hash beside the artifact version, and what built the run", () => {
    // The hash sits next to the version it can contradict: two rows
    // naming one artifact with different hashes ran different prompts,
    // and this listing is the only place that shows.
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompt-"));
    writeFileSync(join(dir, "t.md"), "Facilitator: hi.\n");
    writeFileSync(
      join(dir, "case.eval.yaml"),
      "id: c\ntranscript: t.md\nchecks:\n  - kind: must_validate\n",
    );
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0.02, validationError: 0.1}\n"
        + "cases: [case.eval.yaml]\n",
    );
    const base = {
      date: "2026-08-20T00:00:00Z",
      suiteVersion: "1.0.0",
      artifactVersion: "haiku45-2",
      repeat: 5,
      mean: 0.916,
      worst: 0.0,
      cases: [],
    };
    writeFileSync(
      join(dir, "history.jsonl"),
      JSON.stringify({
        ...base,
        promptHash: "aaaaaaaaaaaa",
        build: { version: "1.7.0", commit: "deadbeefcafe", dirty: false },
      }) + "\n"
        + JSON.stringify({
          ...base,
          promptHash: "bbbbbbbbbbbb",
          build: { version: "1.7.0", commit: "deadbeefcafe", dirty: true },
        }) + "\n",
    );

    return runCli(["prompt", "history", "--suite", manifest]).then((result) => {
      expect(result.exitCode).toBe(0);
      const [first, second] = result.stdout.trim().split("\n");
      // Same artifact version, different prompt: only the hash shows it.
      expect(first).toContain("artifact=haiku45-2@aaaaaaaaaaaa");
      expect(second).toContain("artifact=haiku45-2@bbbbbbbbbbbb");
      expect(first).toContain("1.7.0 (deadbee)");
      expect(second).toContain("1.7.0 (deadbee-dirty)");
    });
  });
});
