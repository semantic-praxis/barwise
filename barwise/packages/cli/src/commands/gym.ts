/**
 * barwise gym list
 * barwise gym show <id>
 * barwise gym check <id> <candidate.orm.yaml>
 *
 * The modeling gym: practice-with-feedback over the packaged exercise
 * catalog (modeling-gym spec). `check` closes the learning-design C6
 * loop: failed checks emit miss cards in the Anki deck's import format,
 * a copy and a session-log line land in the learner's state directory
 * (`$XDG_STATE_HOME/barwise/`, fallback `~/.local/state/barwise/`), and
 * a suggested next step is printed. The evaluator and card content are
 * deterministic; the clock appears only in the session log, which is a
 * CLI-owned record.
 */
import {
  buildMissCards,
  type CatalogEntry,
  evaluateCandidate,
  findExercise,
  type GymReport,
  listExercises,
  renderMissCardFile,
} from "@barwise/learn";
import type { Command } from "commander";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadModel } from "../workspace/io.js";

interface GymFormatOptions {
  format: string;
  catalog?: string;
}

interface GymCheckOptions extends GymFormatOptions {
  emitMisses?: string;
  state: boolean;
}

export function registerGymCommand(program: Command): void {
  const gymCmd = program
    .command("gym")
    .description("Modeling gym: practice exercises with deterministic feedback");

  registerList(gymCmd);
  registerShow(gymCmd);
  registerCheck(gymCmd);
}

/** The learner's state directory (session log and miss-card copies). */
function stateDir(): string {
  const base = process.env["XDG_STATE_HOME"] && process.env["XDG_STATE_HOME"] !== ""
    ? process.env["XDG_STATE_HOME"]
    : join(homedir(), ".local", "state");
  return join(base, "barwise");
}

function catalogDir(opts: GymFormatOptions): string | undefined {
  return opts.catalog ? resolve(opts.catalog) : undefined;
}

/** `barwise gym list` */
function registerList(gymCmd: Command): void {
  gymCmd
    .command("list")
    .description("List the available exercises")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--catalog <dir>", "Load exercises from this directory instead of the packaged catalog")
    .action((opts: GymFormatOptions) => {
      try {
        const entries = listExercises(catalogDir(opts));
        if (opts.format === "json") {
          const payload = entries.map(({ loaded }) => ({
            id: loaded.exercise.id,
            title: loaded.exercise.title,
            transition: loaded.exercise.transition,
            exitPerformance: loaded.exercise.exitPerformance,
            checks: loaded.exercise.checks.length,
          }));
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
          return;
        }
        for (const { loaded } of entries) {
          const t = loaded.exercise.transition;
          process.stdout.write(
            `${loaded.exercise.id}  (${t.from} -> ${t.to})  ${loaded.exercise.title}\n`,
          );
        }
      } catch (err) {
        fail(err);
      }
    });
}

/** `barwise gym show <id>` */
function registerShow(gymCmd: Command): void {
  gymCmd
    .command("show")
    .description("Show an exercise's brief and starter")
    .argument("<id>", "Exercise id (see `barwise gym list`)")
    .option("--catalog <dir>", "Load exercises from this directory instead of the packaged catalog")
    .action((id: string, opts: GymFormatOptions) => {
      try {
        const entry = requireExercise(id, opts);
        const ex = entry.loaded.exercise;
        const lines = [
          `${ex.title} (${ex.id})`,
          `Transition: ${ex.transition.from} -> ${ex.transition.to}`,
          `Exit performance: ${ex.exitPerformance}`,
          "",
          ex.brief.trimEnd(),
        ];
        if (ex.reading) {
          lines.push("", `Reading (optional pre-session skim): ${ex.reading}`);
        }
        if (ex.starter) {
          lines.push("", `Starter model: ${resolve(entry.filePath, "..", ex.starter)}`);
        }
        lines.push(
          "",
          `When ready: barwise gym check ${ex.id} <your-model.orm.yaml>`,
        );
        process.stdout.write(lines.join("\n") + "\n");
      } catch (err) {
        fail(err);
      }
    });
}

/** `barwise gym check <id> <candidate>` */
function registerCheck(gymCmd: Command): void {
  gymCmd
    .command("check")
    .description("Evaluate a candidate model against an exercise's rubric")
    .argument("<id>", "Exercise id (see `barwise gym list`)")
    .argument("<candidate>", "Path to the learner's candidate .orm.yaml")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--catalog <dir>", "Load exercises from this directory instead of the packaged catalog")
    .option("--emit-misses <file>", "Also write the miss-card deck file to this path")
    .option("--no-state", "Skip the session log and miss-card copy in the state directory")
    .action((id: string, candidatePath: string, opts: GymCheckOptions) => {
      try {
        const entry = requireExercise(id, opts);
        const { exercise, reference } = entry.loaded;
        const candidate = loadModel(candidatePath);
        const report = evaluateCandidate(candidate, exercise, reference);

        const cards = buildMissCards(exercise, report);
        const missFile = cards.length > 0 ? renderMissCardFile(exercise, cards) : undefined;

        const written: string[] = [];
        if (missFile && opts.emitMisses) {
          writeFileSync(resolve(opts.emitMisses), missFile, "utf-8");
          written.push(resolve(opts.emitMisses));
        }
        if (opts.state) {
          written.push(...recordSession(exercise.id, report, missFile));
        }

        printReport(exercise.id, report, cards.length, written, opts);
        if (!report.passed) process.exitCode = 1;
      } catch (err) {
        fail(err);
      }
    });
}

/**
 * The C6 state record: append a human-readable session-log line and,
 * on failure, copy the miss-card file into the state directory so the
 * complete record lives where the coaching layer can read it.
 */
function recordSession(
  exerciseId: string,
  report: GymReport,
  missFile: string | undefined,
): string[] {
  const written: string[] = [];
  const dir = stateDir();
  mkdirSync(join(dir, "misses"), { recursive: true });

  let missPath: string | undefined;
  if (missFile) {
    missPath = join(dir, "misses", `gym-${exerciseId}.txt`);
    writeFileSync(missPath, missFile, "utf-8");
    written.push(missPath);
  }

  const failed = report.results.filter((r) => !r.passed).map((r) => r.kind);
  const logLine = [
    new Date().toISOString(),
    exerciseId,
    report.passed ? "passed" : "failed",
    failed.length > 0 ? failed.join(",") : "-",
    missPath ?? "-",
  ].join("\t") + "\n";
  const logPath = join(dir, "gym-sessions.log");
  appendFileSync(logPath, logLine, "utf-8");
  written.push(logPath);

  return written;
}

function printReport(
  exerciseId: string,
  report: GymReport,
  cardCount: number,
  written: string[],
  opts: GymCheckOptions,
): void {
  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify({ ...report, missCards: cardCount, written }, null, 2) + "\n",
    );
    return;
  }

  const lines: string[] = [];
  for (const r of report.results) {
    lines.push(`${r.passed ? "PASS" : "FAIL"}  [${r.kind}] ${r.message}`);
    if (!r.passed && r.hint) lines.push(`      Hint: ${r.hint}`);
  }
  lines.push("");
  if (report.passed) {
    lines.push(`${exerciseId}: all ${report.results.length} checks passed.`);
    lines.push("Next: try the next exercise up the scale (`barwise gym list`).");
  } else {
    const failed = report.results.filter((r) => !r.passed).length;
    lines.push(`${exerciseId}: ${failed} of ${report.results.length} checks failed.`);
    if (cardCount > 0) {
      lines.push(
        `Emitted ${cardCount} miss card(s) -- import into Anki (ORM 2::Misses) to schedule the gap.`,
      );
    }
    lines.push("Next: study the reading for the failed checks, revise, and re-check.");
  }
  for (const w of written) lines.push(`Wrote: ${w}`);
  process.stdout.write(lines.join("\n") + "\n");
}

function requireExercise(id: string, opts: GymFormatOptions): CatalogEntry {
  const entry = findExercise(id, catalogDir(opts));
  if (!entry) {
    throw new Error(`no exercise with id "${id}" (see \`barwise gym list\`)`);
  }
  return entry;
}

function fail(err: unknown): void {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
