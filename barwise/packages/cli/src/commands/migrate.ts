/**
 * barwise migrate <files...>
 *
 * Rewrites each .orm.yaml file in place to the current format, and says
 * what reading it changed beyond the format: the 2.0 `is_preferred` flags
 * the model could not carry as written (orm-format-3 WS4b-iii, Open
 * decision 5). A current file whose ids the load mints, because it gives
 * an element none, has those ids written in (iri-identity decision 17).
 * Given a `.orm-project.yaml`, it migrates every domain in one write, so
 * a shadow names the id its owner's domain gives (iri-identity WS6). One
 * of the two CLI commands that modify their inputs, with `rename`; that is
 * its whole job, and the capability matrix records it.
 */

import {
  CURRENT_ORM_VERSION,
  type MigrationNote,
  type MigrationResult,
  ProjectSerializer,
  type ReplayOptions,
  storeIds,
} from "@barwise/core";
import type { Command } from "commander";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFile, serializer } from "../workspace/io.js";
import {
  type FileWrite,
  PartialWriteError,
  writeFilesAtomically,
} from "../workspace/stagedWrite.js";

interface MigrateOptions {
  check?: boolean;
  format: string;
}

/** One file's outcome. */
type FileOutcome =
  | { file: string; status: "current"; }
  | {
    file: string;
    status: "migrated" | "would-migrate";
    from: string;
    notes: readonly MigrationNote[];
    /** For a current file: the ids written into it. */
    stored?: readonly string[];
  }
  | { file: string; status: "error"; error: string; };

/** A file's outcome, and the text to write when it has one. */
interface Planned {
  readonly outcome: FileOutcome;
  readonly write?: FileWrite;
}

export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description(
      `Rewrite .orm.yaml files in place as format ${CURRENT_ORM_VERSION}, `
        + "or every domain of a .orm-project.yaml",
    )
    .argument("<files...>", "Paths to .orm.yaml files or .orm-project.yaml manifests")
    .option("--check", "Write nothing; exit 1 if any file would be rewritten")
    .option("--format <format>", "Output format (text or json)", "text")
    .action((files: string[], opts: MigrateOptions) => {
      if (opts.format !== "text" && opts.format !== "json") {
        process.stderr.write(`Error: unknown --format "${opts.format}"; use text or json.\n`);
        process.exitCode = 2;
        return;
      }
      const check = opts.check === true;
      // A file that is a domain of a manifest named in the same run is
      // migrated through that manifest only: alone first, its shadows would
      // be written under ids the project then keeps as 4.0.
      const throughProject = new Set(
        files.filter(isManifest).flatMap((m) => {
          try {
            return projectDomains(m).map((d) => realPath(d.file));
          } catch {
            return []; // reported when the manifest itself is migrated
          }
        }),
      );
      const outcomes = files.flatMap((file) => {
        if (isManifest(file)) return migrateProject(file, check);
        if (throughProject.has(realPath(file))) return [];
        return write([planFile(file)], check);
      });
      process.stdout.write(
        opts.format === "json"
          ? `${JSON.stringify(outcomes, null, 2)}\n`
          : outcomes.map(describe).join(""),
      );
      // 2 when a file could not be answered for, which a caller must not
      // read as "needs migrating" (the gate contract, root CLAUDE.md); 1
      // when --check found a file to rewrite.
      if (outcomes.some((o) => o.status === "error")) process.exitCode = 2;
      else if (outcomes.some((o) => o.status === "would-migrate")) process.exitCode = 1;
    });
}

/** What migrating one file on its own would do, writing nothing. */
function planFile(file: string): Planned {
  try {
    const raw = readFile(file);
    return planRead(file, raw, read(raw));
  } catch (err) {
    return { outcome: { file, status: "error", error: (err as Error).message } };
  }
}

/**
 * Leniently, as `barwise validate` loads: a format rewrite carries a
 * dangling reference across for validation to report, rather than
 * refusing a fragment that names elements it does not define.
 */
function read(raw: string, ownerId?: ReplayOptions["ownerId"]): MigrationResult {
  return serializer.migrate(raw, { lenient: true, ...(ownerId ? { ownerId } : {}) });
}

/** What migrating one file, read as `result`, would do. */
function planRead(file: string, raw: string, result: MigrationResult): Planned {
  try {
    if (result.from === CURRENT_ORM_VERSION) return planCurrent(file, raw);
    const unplaceable = result.notes.find((n) => n.kind === "flags-unplaceable");
    if (unplaceable) return refused(file, note(unplaceable));
    return planRewrite(file, result);
  } catch (err) {
    return { outcome: { file, status: "error", error: (err as Error).message } };
  }
}

/**
 * A current file is written only to store the ids its load mints (decision
 * 17), into its own text, so its comments and layout stay.
 */
function planCurrent(file: string, raw: string): Planned {
  const { text, stored } = storeIds(raw);
  if (stored.length === 0) return { outcome: { file, status: "current" } };
  // A guard on the splice, which no test reaches: `storeIds` inserts text
  // the YAML parser could read differently than meant (a flow scalar it
  // ends early, a line at the wrong indentation), and writing that would
  // turn a file that loads into one that does not, or still mints.
  const unstored = serializer.deserialize(text, { lenient: true }).unstoredIds;
  if (unstored.length > 0) {
    return refused(file, `its ids could not all be stored (${unstored.join(", ")} still are not)`);
  }
  return {
    outcome: {
      file,
      status: "migrated",
      from: CURRENT_ORM_VERSION,
      notes: [],
      stored: stored.map((s) => s.id),
    },
    write: { path: file, text },
  };
}

function planRewrite(file: string, result: MigrationResult): Planned {
  const text = serializer.serialize(result.model);
  // A 2.0 file can hold what 3.0 refuses (two constraints sharing an id):
  // rewriting it would turn a file that loads into one that does not.
  try {
    serializer.deserialize(text, { lenient: true });
  } catch (err) {
    return refused(
      file,
      `its ${CURRENT_ORM_VERSION} form would not load: ${(err as Error).message}`,
    );
  }
  return {
    outcome: { file, status: "migrated", from: result.from, notes: result.notes },
    write: { path: file, text },
  };
}

function refused(file: string, why: string): Planned {
  return { outcome: { file, status: "error", error: `not migrated: ${why}` } };
}

/**
 * Write the planned files in one staged write, or under `--check` none.
 * One write per call: a project's domains go together or not at all.
 */
function write(planned: readonly Planned[], check: boolean): FileOutcome[] {
  const outcomes = planned.map((p) => p.outcome);
  const writes = planned.flatMap((p) => (p.write ? [p.write] : []));
  if (check) {
    return outcomes.map((o) => (o.status === "migrated" ? { ...o, status: "would-migrate" } : o));
  }
  if (writes.length === 0) return outcomes;
  try {
    writeFilesAtomically(writes, ".migrating");
    return outcomes;
  } catch (err) {
    // A rename that failed part-way replaced some files; those are migrated.
    const replaced = new Set(err instanceof PartialWriteError ? err.replaced : []);
    const why = (err as Error).message;
    return outcomes.map((o) =>
      o.status === "migrated" && !replaced.has(o.file)
        ? { file: o.file, status: "error", error: why }
        : o
    );
  }
}

/**
 * Every domain of a project, in one write (iri-identity WS6). A file alone
 * cannot see an owner whose local name took a suffix, so each domain is
 * replayed once on its own, which gives every owned object type its id,
 * and then again told those ids, so each shadow names its owner. A domain
 * that does not load refuses the whole project: writing the rest would
 * leave shadows naming ids nobody checked.
 */
function migrateProject(manifest: string, check: boolean): FileOutcome[] {
  let files: readonly { context: string; file: string; }[];
  try {
    files = projectDomains(manifest);
  } catch (err) {
    return [{ file: manifest, status: "error", error: (err as Error).message }];
  }

  // Each file read once; a domain that does not read is refused below.
  const first = files.map(({ context, file }) => {
    try {
      return { context, file, raw: readFile(file) };
    } catch (err) {
      return { context, file, error: (err as Error).message };
    }
  });
  const owners = new Map<string, ReadonlyMap<string, string>>();
  const ownerId = (context: string, name: string) => owners.get(context)?.get(name);
  const results = new Map<number, MigrationResult>();
  const failed = new Map<number, string>();
  const replay = (i: number, withOwners: boolean) => {
    try {
      const result = read(first[i]!.raw!, withOwners ? ownerId : undefined);
      results.set(i, result);
      failed.delete(i);
      owners.set(
        first[i]!.context,
        new Map(
          result.model.objectTypes
            .filter((ot) => ot.sourceContext === undefined)
            .map((ot) => [ot.name, ot.id] as const),
        ),
      );
      return true;
    } catch (err) {
      failed.set(i, (err as Error).message);
      return false;
    }
  };
  first.forEach((d, i) => {
    if (d.raw !== undefined) replay(i, false);
  });
  // A domain can fail alone only because two shadows take one id there,
  // which is the suffixed owner the project settles: retry each with the
  // owners known, again while a retry adds an owner another may need.
  let progress = true;
  while (progress && failed.size > 0) {
    progress = false;
    for (const i of [...failed.keys()]) progress = replay(i, true) || progress;
  }

  // Replayed again only where it can change something: a domain before
  // 4.0 that holds a shadow.
  const planned = first.map((d, i): Planned => {
    const result = results.get(i);
    if (d.raw === undefined || result === undefined) {
      return { outcome: { file: d.file, status: "error", error: d.error ?? failed.get(i)! } };
    }
    const replayAgain = result.from !== CURRENT_ORM_VERSION
      && result.model.objectTypes.some((ot) => ot.sourceContext !== undefined);
    try {
      return planRead(d.file, d.raw, replayAgain ? read(d.raw, ownerId) : result);
    } catch (err) {
      return { outcome: { file: d.file, status: "error", error: (err as Error).message } };
    }
  });
  if (planned.some((p) => p.outcome.status === "error")) {
    // A domain with nothing to write stays as it is reported.
    return planned.map(({ outcome }) =>
      outcome.status === "error" || outcome.status === "current" ? outcome : {
        file: outcome.file,
        status: "error",
        error: "not migrated: another domain of the project was refused, and a project "
          + "migrates whole",
      }
    );
  }
  return write(planned, check);
}

function isManifest(file: string): boolean {
  return file.endsWith(".orm-project.yaml");
}

/** Each domain a manifest names, by its context and its path from here. */
function projectDomains(manifest: string): { context: string; file: string; }[] {
  const { domains } = new ProjectSerializer().deserialize(readFile(manifest));
  return domains.map((d) => ({ context: d.context, file: join(dirname(manifest), d.path) }));
}

/** The file a path names, for telling two spellings of one file apart. */
function realPath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

function describe(o: FileOutcome): string {
  switch (o.status) {
    case "current":
      return `${o.file}: already ${CURRENT_ORM_VERSION}\n`;
    case "error":
      return `${o.file}: ${o.error}\n`;
    default: {
      const verb = o.status === "migrated" ? "->" : "would migrate to";
      const stored = o.stored === undefined
        ? ""
        : `  ${o.status === "migrated" ? "stored" : "would store"} ${
          o.stored.map((id) => `"${id}"`).join(", ")
        }, which the file did not state\n`;
      return `${o.file}: ${o.from} ${verb} ${CURRENT_ORM_VERSION}\n${stored}${
        o.notes.map((n) => `  ${note(n)}\n`).join("")
      }`;
    }
  }
}

function note(n: MigrationNote): string {
  switch (n.kind) {
    case "flag-dropped":
      return `dropped the is_preferred flag on constraint "${n.constraintId}" in "${n.factType}": it identifies no entity type`;
    case "flags-unplaceable":
      return `it names elements it does not define (${
        n.missing.map((id) => `"${id}"`).join(", ")
      }) and carries is_preferred flags, which cannot be placed without them; migrate it as part of the whole model`;
    case "identifier-chosen":
      return `"${n.entity}" was named by ${
        n.others.length + 1
      } preferred identifiers; kept "${n.kept}", and ${
        n.others.map((id) => `"${id}"`).join(", ")
      } ${n.others.length === 1 ? "is" : "are"} no longer preferred`;
  }
}
