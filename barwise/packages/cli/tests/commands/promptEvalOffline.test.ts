/**
 * `barwise prompt eval`, rehearsed without an API key
 * (docs/specs/offline-eval-rehearsal.spec.md, barwise-841).
 *
 * `promptlab/tests/runSuite.test.ts` covers the runner with a fixture
 * client. What it cannot reach is everything the command does around
 * it -- artifact resolution, the warnings an operator reads mid-sweep,
 * `--save-payloads`, the history append -- and every one of those lines
 * had only ever executed with a paid provider behind it.
 *
 * The fake is the *server*, not the client: the command builds its own
 * client from its own flags, so `createLlmClient`, the flag plumbing,
 * the derived budget and the streaming reader are all production code
 * here. The reasoning for that choice, and why an injected mock client
 * would have been the wrong instrument, is in the spec.
 *
 * Mutation-checked: ten breakages, each caught by exactly one test.
 * One-for-one is the result worth recording -- a mutation that trips
 * four tests says they overlap, and one that trips none says the
 * assertion was decorative.
 *
 *   always claim the default artifact          -> the variant test
 *   resolve the artifact, never pass it on     -> the variant test
 *   resolve from the flags, not the client     -> the client-model test
 *   score a failed run 0 instead of excluding  -> the exclusion test
 *   drop `process.exitCode = 1` when incomplete -> the exclusion test
 *   drop the truncation warning                -> the truncation test
 *   make `--save-payloads` write nothing       -> the payload test
 *   append history despite `--no-history`      -> the no-history test
 *   drop the --max-tokens passthrough          -> the request-body test
 *   drop the --context-window passthrough      -> the request-body test
 *
 * The two artifact mutations landing on the same test is the point of
 * that test: the first breaks the stderr line, the second leaves the
 * line intact and sends the wrong prompt. Only reading the system
 * prompt off the wire catches both.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeOllama, fixtureAnswerer, startFakeOllama } from "../workspace/fakeOllama.js";
import { runCli } from "../workspace/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVALS = resolve(here, "../../../promptlab/evals");
const FIXTURES = resolve(here, "../../../promptlab/tests/fixtures/responses");

const TRAIN = [
  "order-management",
  "university-enrollment",
  "clinic-appointments",
  "employee-hierarchy",
  "project-staffing",
  "conference-reviews",
  "freight-corrections",
] as const;

/**
 * The recorded answer-key scores, which this path must reproduce.
 *
 * Exactly 1.000 since barwise-839 removed `orphaned_reference_mode`,
 * the one check that charged these payloads. They ran 0.94-0.98 before
 * it, and the whole spread was that check.
 */
const ANSWER_KEY_MEAN = 1;

let tmp: string;
let suitePath: string;
let fake: FakeOllama | undefined;

beforeEach(() => {
  // The suite's history file lives beside its manifest, so running the
  // packaged suite in place would append to the repository's own
  // recorded score history. A record a test can write to is not one.
  tmp = mkdtempSync(join(tmpdir(), "barwise-eval-"));
  cpSync(EVALS, tmp, { recursive: true });
  suitePath = join(tmp, "suite.yaml");
});

afterEach(async () => {
  await fake?.close();
  fake = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function serve(
  answer: Parameters<typeof startFakeOllama>[0],
): Promise<FakeOllama> {
  fake = await startFakeOllama(answer);
  return fake;
}

function evalArgs(extra: string[] = []): string[] {
  return [
    "prompt",
    "eval",
    "--provider",
    "ollama",
    "--base-url",
    fake!.url,
    "--model",
    "fake-local",
    "--suite",
    suitePath,
    ...extra,
  ];
}

const historyPath = (): string => join(tmp, "history.jsonl");

describe("barwise prompt eval, against a loopback provider", () => {
  it("runs the train split end to end and reports the recorded scores", async () => {
    // The whole path in one assertion: real client, real budget, real
    // streaming reader, real conformance, real scoring. If any of them
    // drifts, the means stop matching the answer keys.
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stdout, exitCode } = await runCli(
      evalArgs(["--split", "train", "--no-history", "--format", "json"]),
    );

    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout) as {
      mean: number;
      worst: number;
      complete: boolean;
      cases: Array<{ caseId: string; }>;
    };
    expect(report.complete).toBe(true);
    expect(report.cases.map((c) => c.caseId)).toEqual([...TRAIN]);
    expect(report.mean).toBeCloseTo(ANSWER_KEY_MEAN, 10);
    expect(report.worst).toBeCloseTo(1, 10);
    expect(fake!.requests).toHaveLength(TRAIN.length);
  });

  it("says which provider and model failed to match when it falls back", async () => {
    // "Using the default prompt artifact." on its own read as a
    // statement about the suite rather than about this configuration,
    // and it printed identically whether no variant existed or the
    // query had been built without a model to match on. Naming the pair
    // is what distinguishes a deliberate default from a resolution that
    // quietly missed.
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stderr } = await runCli(evalArgs(["--split", "train", "--no-history"]));

    expect(stderr).toContain("Using the default prompt artifact");
    expect(stderr).toContain("ollama/fake-local matches no variant");
  });

  it("sends the variant it says it resolved, not just the name of one", async () => {
    // The failure this exists for: believing a comparative round ran the
    // variant when it ran the default. The stderr line alone cannot tell
    // those apart -- only the system prompt on the wire can.
    const artifactsDir = join(tmp, "artifacts");
    mkdirSync(artifactsDir);
    writeFileSync(
      join(artifactsDir, "extraction.fake.prompt.yaml"),
      [
        "surface: extraction",
        "version: rehearsal-1",
        "match:",
        "  provider: ollama",
        "instructions: |-",
        "  UNMISTAKABLE-VARIANT-MARKER",
        "  Extract an ORM model from the transcript.",
        "",
      ].join("\n"),
    );
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stderr } = await runCli(
      evalArgs(["--split", "train", "--no-history", "--artifacts", artifactsDir]),
    );

    expect(stderr).toContain("Using artifact version rehearsal-1");
    const first = fake!.requests[0] as { messages: Array<{ role: string; content: string; }>; };
    const system = first.messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("UNMISTAKABLE-VARIANT-MARKER");
  });

  it("resolves the variant from the client's model, not from the --model flag", async () => {
    // barwise-842. Resolution keyed on `opts.model`, so omitting the flag
    // produced a working client -- every provider resolves its own
    // default model -- and an artifact query with no model at all. A
    // `modelPrefix` cannot match an undefined model, so the run fell
    // through to the default prompt while reporting the provider back.
    //
    // Ollama defaults to `llama3.1`, which the flag never mentions, so
    // only a resolution reading the CLIENT can find this variant.
    const artifactsDir = join(tmp, "artifacts-from-client");
    mkdirSync(artifactsDir);
    writeFileSync(
      join(artifactsDir, "extraction.default-model.prompt.yaml"),
      [
        "surface: extraction",
        "version: client-resolved-1",
        "match:",
        "  provider: ollama",
        "  modelPrefix: llama3",
        "instructions: |-",
        "  RESOLVED-FROM-THE-CLIENT",
        "  Extract an ORM model from the transcript.",
        "",
      ].join("\n"),
    );
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stderr } = await runCli([
      "prompt",
      "eval",
      "--provider",
      "ollama",
      "--base-url",
      fake!.url,
      // deliberately no --model
      "--suite",
      suitePath,
      "--split",
      "train",
      "--no-history",
      "--artifacts",
      artifactsDir,
    ]);

    expect(stderr).toContain("Using artifact version client-resolved-1");
    const first = fake!.requests[0] as { messages: Array<{ role: string; content: string; }>; };
    const system = first.messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("RESOLVED-FROM-THE-CLIENT");
  });

  it("sends the default when --artifact-version says so, even where a variant matches", async () => {
    // barwise-882. The default arm was previously reachable only by
    // shadowing every builtin with match-less copies; an operator who
    // did not know the trick would compare default against variant by
    // changing the MODEL, confounding the two things the comparison
    // exists to separate. The variant here matches the client, so only
    // the flag can explain the default going out on the wire.
    const artifactsDir = join(tmp, "artifacts-forced-default");
    mkdirSync(artifactsDir);
    writeFileSync(
      join(artifactsDir, "extraction.fake.prompt.yaml"),
      [
        "surface: extraction",
        "version: would-have-matched-1",
        "match:",
        "  provider: ollama",
        "instructions: |-",
        "  UNMISTAKABLE-VARIANT-MARKER",
        "  Extract an ORM model from the transcript.",
        "",
      ].join("\n"),
    );
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stderr } = await runCli(evalArgs([
      "--split",
      "train",
      "--no-history",
      "--artifacts",
      artifactsDir,
      "--artifact-version",
      "default",
    ]));

    expect(stderr).toContain("forced by --artifact-version");
    const first = fake!.requests[0] as { messages: Array<{ role: string; content: string; }>; };
    const system = first.messages.find((m) => m.role === "system")!.content;
    expect(system).not.toContain("UNMISTAKABLE-VARIANT-MARKER");
  });

  it("runs the sweep at --concurrency 3 and reports the same answer keys", async () => {
    // The whole concurrent path against a real server: chains overlap
    // on the wire, and the report must come back in manifest order
    // with the same means the serial sweep pins above.
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stdout, exitCode } = await runCli(
      evalArgs(["--split", "train", "--no-history", "--concurrency", "3", "--format", "json"]),
    );

    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout) as {
      mean: number;
      complete: boolean;
      cases: Array<{ caseId: string; }>;
    };
    expect(report.complete).toBe(true);
    expect(report.cases.map((c) => c.caseId)).toEqual([...TRAIN]);
    expect(report.mean).toBeCloseTo(ANSWER_KEY_MEAN, 10);
    expect(fake!.requests).toHaveLength(TRAIN.length);
  });

  it("rejects a nonsense --concurrency before spending a call", async () => {
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stderr, exitCode } = await runCli(
      evalArgs(["--split", "train", "--no-history", "--concurrency", "0"]),
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--concurrency must be a positive integer");
    expect(fake!.requests).toHaveLength(0);
  });

  it("rejects an unknown --artifact-version before spending a call", async () => {
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { stderr, exitCode } = await runCli(
      evalArgs(["--split", "train", "--no-history", "--artifact-version", "bogus"]),
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain('No extraction artifact has version "bogus"');
    // What WOULD have worked is in the message, so the retry needs no
    // second failed run to find a spelling.
    expect(stderr).toContain("haiku45-2");
    expect(fake!.requests).toHaveLength(0);
  });

  it("excludes a failed run from the mean rather than scoring it zero", async () => {
    // Zeroing a call that never returned a payload would record a
    // provider outage as a prompt regression. Only a mixed run can tell
    // the two apart: failing every call leaves a mean of 0 either way,
    // which is what makes "all calls fail" the wrong shape for this.
    const answer = fixtureAnswerer(EVALS, FIXTURES, TRAIN);
    const failed = "employee-hierarchy";
    await serve((user) => {
      const line = readFileSync(join(EVALS, `${failed}.transcript.md`), "utf8").split("\n")[0]!;
      return user.includes(line) ? undefined : answer(user);
    });

    const { stdout, stderr, exitCode } = await runCli(
      evalArgs(["--split", "train", "--no-history", "--format", "json"]),
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("produced no usable payload");
    expect(stderr).toContain("not scored zero");
    const report = JSON.parse(stdout) as { complete: boolean; failures: number; mean: number; };
    expect(report.complete).toBe(false);
    expect(report.failures).toBe(1);
    // The six that answered, over six -- not over seven. Both come to
    // 1.000 now that the answer keys are clean, so the sharp assertion
    // is the failure count above plus `complete: false`; a mean of 0
    // would be the tell if a failed run were scored rather than
    // excluded.
    expect(report.mean).toBeCloseTo(1, 10);
  });

  it("warns that a truncated answer measured the budget, not the prompt", async () => {
    // The failure that looks least like one: it arrives as well-formed
    // JSON holding almost nothing.
    const answer = fixtureAnswerer(EVALS, FIXTURES, TRAIN);
    await serve((user, i) => {
      const found = answer(user);
      if (found === undefined) return undefined;
      return i === 0 ? { ...found, doneReason: "length" } : found;
    });

    const { stderr } = await runCli(evalArgs(["--split", "train", "--no-history"]));

    expect(stderr).toContain("cut off at the output-token");
    expect(stderr).toMatch(/--max-tokens above \d+/);
  });

  it("carries --max-tokens and --context-window all the way into the request", async () => {
    // Asserted on the request body, not the flag list: deleting either
    // passthrough in prompt.ts left every test green (the 2026-08-25
    // assertion audit ran exactly those mutations), because the --help
    // tests pin that the flags parse and nothing pinned that their
    // values reach the provider. An option parsed and then dropped is
    // the built-but-unwired class this repo audits for, and the guard
    // tests alone would keep validating a value that goes nowhere.
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    const { exitCode } = await runCli(
      evalArgs([
        "--split",
        "train",
        "--no-history",
        "--max-tokens",
        "9000",
        "--context-window",
        "32768",
      ]),
    );

    expect(exitCode).toBe(0);
    expect(fake!.requests.length).toBeGreaterThan(0);
    for (const request of fake!.requests) {
      expect(request["options"]).toEqual({ num_ctx: 32768, num_predict: 9000 });
    }
  });

  it("saves the payload of a run that could not be scored", async () => {
    // A rare failure must leave something to read: the run has been
    // paid for, and the payload is the only evidence of what went wrong.
    await serve(() => ({ content: '{"object_types":[],"fact_types":[]}' }));
    const out = join(tmp, "payloads");

    const { stderr } = await runCli(
      evalArgs(["--split", "dev", "--no-history", "--save-payloads", out]),
    );

    expect(stderr).toMatch(/Wrote \d+ payload\(s\)/);
    expect(readdirSync(out).length).toBeGreaterThan(0);
  });

  it("appends one history row carrying provider, model, split and build", async () => {
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    await runCli(evalArgs(["--split", "train"]));

    const rows = readFileSync(historyPath(), "utf8").trim().split("\n");
    expect(rows).toHaveLength(1);
    const row = JSON.parse(rows[0]!) as Record<string, unknown>;
    expect(row).toMatchObject({ provider: "ollama", model: "fake-local", split: "train" });
    expect(row["build"]).toBeDefined();
    expect(row["mean"]).toBeCloseTo(ANSWER_KEY_MEAN, 10);
  });

  it("writes no history row when told not to", async () => {
    await serve(fixtureAnswerer(EVALS, FIXTURES, TRAIN));

    await runCli(evalArgs(["--split", "train", "--no-history"]));

    expect(existsSync(historyPath())).toBe(false);
  });
});
