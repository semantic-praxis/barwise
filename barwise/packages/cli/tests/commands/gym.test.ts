/**
 * Tests for the gym command: catalog listing, the brief, and the check
 * loop with miss-card emission and the state-directory record
 * (learning-design C6). XDG_STATE_HOME is pointed at a temp directory
 * so the session record is asserted without touching the real home.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures/gym");
const referenceModel = resolve(
  __dirname,
  "../../../learn/exercises/customer-order.reference.orm.yaml",
);

let stateHome: string;

beforeEach(() => {
  stateHome = mkdtempSync(join(tmpdir(), "barwise-gym-"));
  process.env["XDG_STATE_HOME"] = stateHome;
});

afterEach(() => {
  delete process.env["XDG_STATE_HOME"];
  rmSync(stateHome, { recursive: true, force: true });
});

describe("barwise gym list", () => {
  it("lists the packaged catalog with transitions", async () => {
    const result = await runCli(["gym", "list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("customer-order");
    expect(result.stdout).toContain("novice -> initiate");
  });

  it("outputs JSON with --format json", async () => {
    const result = await runCli(["gym", "list", "--format", "json"]);
    const parsed = JSON.parse(result.stdout) as Array<{ id: string; transition: object; }>;
    expect(parsed.some((e) => e.id === "customer-order")).toBe(true);
    expect(parsed[0]).toHaveProperty("exitPerformance");
  });
});

describe("barwise gym show", () => {
  it("prints the brief, transition, and optional reading", async () => {
    const result = await runCli(["gym", "show", "customer-order"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("One customer per order");
    expect(result.stdout).toContain("Transition: novice -> initiate");
    expect(result.stdout).toContain("Exit performance:");
    expect(result.stdout).toContain("Skim");
  });

  it("errors on an unknown id", async () => {
    const result = await runCli(["gym", "show", "no-such"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no exercise");
  });
});

describe("barwise gym check", () => {
  it("passes the reference model and exits 0", async () => {
    const result = await runCli(["gym", "check", "customer-order", referenceModel]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("all 4 checks passed");
    // A passing run appends to the session log but emits no miss cards.
    const log = readFileSync(join(stateHome, "barwise", "gym-sessions.log"), "utf-8");
    expect(log).toContain("customer-order\tpassed");
    expect(existsSync(join(stateHome, "barwise", "misses", "gym-customer-order.txt")))
      .toBe(false);
  });

  it("fails the unconstrained candidate, emits miss cards, and records the session", async () => {
    const result = await runCli([
      "gym",
      "check",
      "customer-order",
      `${fixtures}/unconstrained-candidate.orm.yaml`,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain("miss card");

    const missPath = join(stateHome, "barwise", "misses", "gym-customer-order.txt");
    const miss = readFileSync(missPath, "utf-8");
    expect(miss.startsWith("#separator:tab")).toBe(true);
    expect(miss).toContain("#deck:ORM 2::Misses");
    expect(miss).toContain("internal uniqueness");

    const log = readFileSync(join(stateHome, "barwise", "gym-sessions.log"), "utf-8");
    expect(log).toContain("customer-order\tfailed\tforbids_population");
  });

  it("writes the miss-card file to --emit-misses", async () => {
    const out = join(stateHome, "misses-out.txt");
    const result = await runCli([
      "gym",
      "check",
      "customer-order",
      `${fixtures}/unconstrained-candidate.orm.yaml`,
      "--emit-misses",
      out,
    ]);
    expect(result.exitCode).toBe(1);
    expect(readFileSync(out, "utf-8")).toContain("#deck:ORM 2::Misses");
  });

  it("--no-state skips the state directory entirely", async () => {
    const result = await runCli([
      "gym",
      "check",
      "customer-order",
      `${fixtures}/unconstrained-candidate.orm.yaml`,
      "--no-state",
    ]);
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(stateHome, "barwise"))).toBe(false);
  });

  it("reports JSON with --format json", async () => {
    const result = await runCli([
      "gym",
      "check",
      "customer-order",
      referenceModel,
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout) as { passed: boolean; missCards: number; };
    expect(parsed.passed).toBe(true);
    expect(parsed.missCards).toBe(0);
  });
});
