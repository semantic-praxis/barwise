/**
 * `barwise prompt run`, against a loopback provider
 * (docs/specs/artifact-resolution-parity.spec.md, workstream 3).
 *
 * This command is the whole of the answer to fault B: the candidate
 * override stays in the `prompt` lane instead of going onto `barwise
 * review` and `barwise import transcript`, because production resolving
 * over `builtinArtifacts` alone is what keeps a recorded prompt hash
 * resolvable to a shipped artifact. So the assertions that matter are
 * the two ends of that claim -- this command really does send an
 * unshipped candidate, and the production commands really do not.
 *
 * The fake is the server, not the client, following
 * `promptEvalOffline.test.ts`: the command builds its own client from
 * its own flags, so resolution, the flag plumbing and the streaming
 * reader are all production code here. Reading the system prompt off
 * the wire is the only assertion that catches a command which prints
 * the right artifact name and sends a different prompt.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeOllama, startFakeOllama } from "../workspace/fakeOllama.js";
import { runCli } from "../workspace/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures");
const modelFile = join(fixtures, "simple.orm.yaml");

const EMPTY_EXTRACTION = JSON.stringify({
  object_types: [],
  fact_types: [],
  inferred_constraints: [],
  ambiguities: [],
});

const ONE_SUGGESTION = JSON.stringify({
  suggestions: [
    {
      category: "definition",
      severity: "warning",
      element: "Name",
      description: "Name has no definition.",
      rationale: "A value type without a definition is ambiguous to a reader.",
    },
  ],
  summary: "One definition gap.",
});

let tmp: string;
let fake: FakeOllama | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "barwise-prompt-run-"));
});

afterEach(async () => {
  await fake?.close();
  fake = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

/** A marker no shipped prompt carries, so "did the candidate run" is decidable. */
const MARKER = "CANDIDATE-UNDER-TEST";

function writeCandidate(surface: "extraction" | "review"): string {
  const dir = mkdtempSync(join(tmpdir(), "barwise-variants-"));
  // Matched on the provider these tests run against. Copying a shipped
  // variant's match block instead would target anthropic, so nothing
  // would resolve and the run would silently fall back to the default
  // -- which is what the first draft of this file did, and the
  // read-it-off-the-wire assertion is what caught it.
  writeFileSync(
    join(dir, "candidate.prompt.yaml"),
    [
      `surface: ${surface}`,
      `version: ${surface}-candidate-1`,
      "match:",
      "  provider: ollama",
      "instructions: |-",
      `  ${MARKER} ${
        surface === "review"
          ? "Review this ORM model and answer with suggestions."
          : "Extract an ORM model from this transcript."
      }`,
      "demos: []",
      "",
    ].join("\n"),
  );
  return dir;
}

async function serve(content: string): Promise<FakeOllama> {
  fake = await startFakeOllama(() => ({ content }));
  return fake;
}

function providerArgs(): string[] {
  return ["--provider", "ollama", "--base-url", fake!.url, "--model", "fake-local"];
}

/** The system prompt the provider actually received. */
function systemPromptSent(): string {
  const messages = fake!.requests[0]!["messages"] as Array<{ role: string; content: string; }>;
  return messages.find((m) => m.role === "system")?.content ?? "";
}

/** The model the provider was actually asked for. */
function modelSent(): unknown {
  return fake!.requests[0]!["model"];
}

describe("barwise prompt run", () => {
  it("sends an unshipped extraction candidate, not the shipped artifact", async () => {
    // The reason this command exists. Reading the prompt off the wire
    // rather than trusting the stderr line: a command that named the
    // candidate and sent the built-in would pass any weaker assertion.
    await serve(EMPTY_EXTRACTION);
    const dir = writeCandidate("extraction");
    const transcript = join(tmp, "t.md");
    writeFileSync(transcript, "Facilitator: tell me about orders.\n");

    const { stdout, stderr, exitCode } = await runCli([
      "prompt",
      "run",
      transcript,
      "--artifacts",
      dir,
      ...providerArgs(),
    ]);

    expect(exitCode).toBe(0);
    expect(systemPromptSent()).toContain(MARKER);
    expect(stderr).toMatch(/Sending extraction artifact \S+@[0-9a-f]{12}/);
    // The raw payload, because that is what an extraction author judges.
    expect(JSON.parse(stdout)).toHaveProperty("object_types");
    // The flag observed at the far end, not merely parsed. Dropping the
    // --model passthrough left every other assertion here green, and it
    // is not a cosmetic gap: artifact resolution keys on `client.model`
    // (barwise-842), so a --model that never reaches the client
    // silently changes which prompt is measured.
    expect(modelSent()).toBe("fake-local");
  });

  it("sends an unshipped review candidate and prints the prose", async () => {
    // Review is the surface that needs this most: the eval metric
    // refuses to grade prose by design, so reading the advice is the
    // only way to judge a review prompt.
    await serve(ONE_SUGGESTION);
    const dir = writeCandidate("review");

    const { stdout, stderr, exitCode } = await runCli([
      "prompt",
      "run",
      modelFile,
      "--surface",
      "review",
      "--artifacts",
      dir,
      ...providerArgs(),
    ]);

    expect(exitCode).toBe(0);
    expect(systemPromptSent()).toContain(MARKER);
    expect(stderr).toContain("Sending review artifact review-candidate-1@");
    expect(stdout).toContain("Name has no definition.");
    expect(stdout).toContain("[warning]");
  });

  it("sends the shipped artifact when given no candidate directory", async () => {
    await serve(EMPTY_EXTRACTION);
    const transcript = join(tmp, "t.md");
    writeFileSync(transcript, "Facilitator: tell me about orders.\n");

    const { exitCode } = await runCli(["prompt", "run", transcript, ...providerArgs()]);

    expect(exitCode).toBe(0);
    expect(systemPromptSent()).not.toContain(MARKER);
    expect(systemPromptSent()).toContain("Object-Role Modeling");
  });

  it("rejects a surface that is not a surface", async () => {
    // The probe is nonsense on purpose. "agent" would be the obvious
    // choice and is the wrong one: the harness spec's workstream 6
    // plans an agent surface, so a test using it would start defending
    // a refusal the day PromptSurface grows -- which is barwise-855
    // exactly. Named for why the input is invalid, not for what is
    // currently built.
    const { stderr, exitCode } = await runCli([
      "prompt",
      "run",
      modelFile,
      "--surface",
      "not-a-surface",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Use "extraction" or "review"');
  });

  it("refuses an empty transcript before spending a call", async () => {
    await serve(EMPTY_EXTRACTION);
    const empty = join(tmp, "empty.md");
    writeFileSync(empty, "   \n");

    const { stderr, exitCode } = await runCli([
      "prompt",
      "run",
      empty,
      ...providerArgs(),
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Transcript file is empty.");
    expect(fake!.requests).toHaveLength(0);
  });
});

describe("the production surfaces stay narrow", () => {
  // The other half of the fault B decision, and the half a future
  // change is most likely to undo quietly: `prompt run` exists SO THAT
  // these two do not need `--artifacts`. If one of them ever grows the
  // flag, the recorded prompt hash stops resolving to a shipped
  // artifact and this decision has been reversed without anyone saying
  // so (docs/specs/artifact-resolution-parity.spec.md, open decision 1).
  it("barwise review has no --artifacts", async () => {
    const { stdout } = await runCli(["review", "--help"]);
    expect(stdout).not.toContain("--artifacts");
  });

  it("barwise import transcript has no --artifacts", async () => {
    const { stdout } = await runCli(["import", "transcript", "--help"]);
    expect(stdout).not.toContain("--artifacts");
  });

  it("barwise prompt run does", async () => {
    // The complement, so the pair cannot both pass by the flag simply
    // never existing anywhere.
    const { stdout } = await runCli(["prompt", "run", "--help"]);
    expect(stdout).toContain("--artifacts");
  });
});
