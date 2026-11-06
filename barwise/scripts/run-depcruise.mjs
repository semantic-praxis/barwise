#!/usr/bin/env node
/**
 * run-depcruise -- `npm run depcruise`, with the gate contract's three
 * results (docs/adr/gate-refusal-contract.md; barwise-vt2;
 * gate-contract-enforced WS1).
 *
 * dependency-cruiser's err reporter sets the process exit code to the
 * number of error-severity violations (v18.4.0, src/report/error.mjs),
 * and the operating system keeps only its low 8 bits. Two violations
 * exited 2, which ci:local reads as a refusal, and 256 exited 0, a pass.
 * No reader can recover a count the OS has already truncated, so the
 * count is read here instead, from the JSON summary, and the human report
 * is printed through the tool's own formatter.
 *
 * Exit 0 no error-severity violation, 1 at least one, 2 could not answer
 * (the binary will not run, or it printed no JSON summary).
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The exit code for a cruise result: the error-severity count from its
 * summary, never the tool's own exit code. A summary with no count is
 * one this gate cannot read, so it is a refusal.
 */
export function exitFor(result) {
  const errors = result?.summary?.error;
  if (typeof errors !== "number" || !Number.isInteger(errors) || errors < 0) return 2;
  return errors > 0 ? 1 : 0;
}

async function main() {
  const refuse = (why) => {
    console.error(`depcruise: cannot answer -- ${why}`);
    process.exit(2);
  };
  // The package's own entry script, run by this node: no shell, no PATH,
  // no .bin shim (which on Windows is a .cmd that spawnSync cannot run).
  const bin = join(root, "node_modules", "dependency-cruiser", "bin", "dependency-cruiser.mjs");
  const run = spawnSync(
    process.execPath,
    [bin, "packages", "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (run.error?.code === "ENOBUFS") {
    refuse("its JSON output is larger than the 256 MiB buffer; raise maxBuffer here");
  }
  if (run.error) refuse(`dependency-cruiser did not start (${run.error.message}); npm ci`);
  let result;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    refuse(
      `dependency-cruiser printed no JSON summary (exit ${run.status}): ${
        (run.stderr ?? "").trim().split("\n")[0]
      }`,
    );
  }
  // The count decides; read it before anything else can throw.
  const code = exitFor(result);
  if (code === 2) refuse("its JSON summary has no error-severity count");
  let report;
  try {
    const { format } = await import("dependency-cruiser");
    report = await format(result, { outputType: "err" });
  } catch (err) {
    refuse(`its result could not be formatted (${err instanceof Error ? err.message : err})`);
  }
  process.stdout.write(report.output);
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
