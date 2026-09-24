/**
 * The oracles: each turns a command result plus ground truth into one
 * graded outcome. Every function here is pure over its inputs so the
 * lane's tests can hand it a known-bad artifact and require a failure
 * (an oracle that cannot fail is the defect class this repo keeps
 * finding, and the tests in ../tests/ plant one per oracle).
 *
 * Outcome: { status, severity?, detail, evidence? }
 *   status: pass | refused | fail | could_not_answer
 *   severity (fail only): S1 silent wrong output, S2 crash or hang,
 *     S3 unnamed refusal, S5 ergonomics
 *   refused: the product declined and said why (a documented
 *     limitation, S4 in the spec's table; a roadmap row, not a bug)
 */
import { crashed } from "../exec.mjs";

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every normalised form of a name with zero or more whole leading
 * segments dropped, where segments are separated by anything that is not
 * a letter or digit: "sales.customer_order" gives salescustomerorder,
 * customerorder and order. "SuperUser" is one segment, so it gives only
 * superuser.
 */
export function prefixStripped(raw) {
  const segs = String(raw ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return new Set(segs.map((_, i) => norm(segs.slice(i).join(""))));
}

const NAMED_REFUSAL =
  /not supported|unsupported|no importer|unknown format|unknown dialect|is not a registered|cannot (?:read|parse|import)|not (?:a )?(?:valid|recognized)/i;

export function gradeImport(result, manifest, expect, modelSummary) {
  if (result.timedOut) {
    return { status: "fail", severity: "S2", detail: `hung past ${result.ms} ms` };
  }
  if (crashed(result)) {
    return {
      status: "fail",
      severity: "S2",
      detail: `stack trace on stderr: ${firstLine(result.stderr)}`,
    };
  }
  const named = NAMED_REFUSAL.test(result.stderr) || NAMED_REFUSAL.test(result.stdout);
  const produced = modelSummary?.objectTypes ?? 0;
  if (expect === "refusal") {
    if (result.exit !== 0 && named) return { status: "refused", detail: firstLine(result.stderr) };
    if (result.exit !== 0) {
      return {
        status: "fail",
        severity: "S3",
        detail: `exit ${result.exit} without naming what is unsupported: ${
          firstLine(result.stderr)
        }`,
      };
    }
    if (produced === 0) {
      return {
        status: "fail",
        severity: "S3",
        detail: `exit 0 and an empty model for a format barwise does not read (${
          manifest.dialect ?? manifest.generator
        }); the refusal is invisible`,
      };
    }
    return {
      status: "fail",
      severity: "S1",
      detail: `exit 0 and ${produced} object types from a ${
        manifest.dialect ?? manifest.generator
      } artifact barwise does not support; nothing says which statements were understood`,
    };
  }
  if (result.exit !== 0) {
    return named
      ? { status: "refused", detail: firstLine(result.stderr) }
      : {
        status: "fail",
        severity: "S3",
        detail: `exit ${result.exit}: ${firstLine(result.stderr) || "(no message)"}`,
      };
  }
  const expected = expectedNames(manifest);
  if (produced === 0 && expected.length > 0) {
    const warned = result.stderr.split("\n").filter((l) => /^\s+- /.test(l)).map((l) => l.trim())
      .slice(0, 2).join("; ");
    return {
      status: "fail",
      severity: "S3",
      detail:
        `exit 0 and an empty model from an artifact with ${expected.length} expected names; the only signal is ${
          countWarnings(result.stderr)
        } warning(s): ${warned || "(none)"}`,
      evidence: { expected: expected.length, imported: 0 },
    };
  }
  const gotRaw = modelSummary?.names ?? [];
  const got = new Set(gotRaw.map(norm));
  // A schema or layer prefix is tolerated only at an identifier boundary:
  // `dbo.User` and `stg_user` satisfy `User`, `SuperUser` does not. The
  // first version compared normalised strings with endsWith, so a model
  // holding only SuperUser passed an import that dropped User.
  const missing = expected.filter((n) =>
    !got.has(n.norm)
    && !gotRaw.some((g) =>
      prefixStripped(g).has(n.norm) || prefixStripped(n.raw).has(norm(g)) && norm(g).length > 3
    )
  );
  const stderr = result.stderr;
  const missingNamed = missing.filter((n) => stderr.toLowerCase().includes(n.raw.toLowerCase()));
  const evidence = {
    expected: expected.length,
    imported: got.size,
    missing: missing.slice(0, 15).map((n) => n.raw),
    missingCount: missing.length,
    warnings: countWarnings(stderr),
  };
  if (missing.length === 0) {
    return { status: "pass", detail: `${expected.length} expected names all present`, evidence };
  }
  if (missingNamed.length === missing.length) {
    return {
      status: "refused",
      detail: `${missing.length} of ${expected.length} skipped and each named on stderr`,
      evidence,
    };
  }
  const share = missing.length / expected.length;
  return {
    status: "fail",
    severity: "S1",
    detail:
      `exit 0 but ${missing.length} of ${expected.length} expected names are absent from the model and ${
        missing.length - missingNamed.length
      } of them are not mentioned on stderr (${Math.round(share * 100)}% silently dropped)`,
    evidence,
  };
}

function expectedNames(manifest) {
  const raws = [];
  switch (manifest.generator) {
    case "ddl":
      for (const t of manifest.tables) if (t.importable && t.kind !== "lookup") raws.push(t.name);
      break;
    case "openapi":
      for (const s of manifest.schemas) {
        if (!manifest.polymorphic.includes(s.name)) raws.push(s.name);
      }
      break;
    case "dbt":
      for (const m of manifest.models) if (!m.keyless) raws.push(m.name.replace(/^stg_/, ""));
      break;
    case "code":
      for (const c of manifest.classes) raws.push(c.name);
      break;
    case "norma":
      for (const n of manifest.objectTypes) raws.push(n);
      break;
    default:
      break;
  }
  return raws.map((raw) => ({ raw, norm: norm(raw) }));
}

/**
 * `expectedNonZero` is the documented non-zero outcome for this caller --
 * "query path found no path", "lineage status has no manifest yet" -- given
 * as a pattern the output must match. It replaces an `allowNonZero` boolean
 * that skipped the exit check entirely, so any error exiting 1 without a
 * stack trace was recorded as a pass; the caller declares WHICH non-zero
 * result it expects, and everything else is still a finding.
 */
export function gradeCommand(result, { budgetMs, expectedNonZero = null } = {}) {
  if (result.timedOut) {
    return { status: "fail", severity: "S2", detail: `did not finish within ${budgetMs} ms` };
  }
  if (crashed(result)) {
    return { status: "fail", severity: "S2", detail: `stack trace: ${firstLine(result.stderr)}` };
  }
  if (result.exit !== 0) {
    if (expectedNonZero?.test(`${result.stderr}\n${result.stdout}`)) {
      return {
        status: "refused",
        detail: firstLine(result.stderr) || firstLine(result.stdout)
          || `exit ${result.exit}, the documented outcome`,
      };
    }
    return NAMED_REFUSAL.test(result.stderr)
      ? { status: "refused", detail: firstLine(result.stderr) }
      : {
        status: "fail",
        severity: "S3",
        detail: `exit ${result.exit}: ${firstLine(result.stderr) || "(no message)"}`,
      };
  }
  if (budgetMs && result.ms > budgetMs) {
    return {
      status: "fail",
      severity: "S2",
      detail: `finished in ${result.ms} ms, over the ${budgetMs} ms budget`,
    };
  }
  return { status: "pass", detail: `exit ${result.exit} in ${result.ms} ms` };
}

/**
 * An import that exits 0 must also have written the model it was asked
 * for. This check was written by hand at one read-back site and missed at
 * the other three, where an exit-0 importer that wrote nothing recorded a
 * pass and skipped the validation after it. One place, so a new
 * read-back path cannot forget it.
 */
export function gradeWroteOutput(
  commandOutcome,
  wrote,
  importer,
  { tool = `${importer} importer`, output = "model to read back" } = {},
) {
  if (commandOutcome.status !== "pass" || wrote) return commandOutcome;
  return {
    status: "fail",
    severity: "S1",
    detail: `the ${tool} exited 0 but wrote no ${output}`,
  };
}

/**
 * A read-back that wrote a model with nothing in it. Structural validation
 * passes an empty model -- there is nothing in it to be invalid -- so the
 * read-back steps certified an importer that exits 0 and writes an empty
 * file. Partial models are graded where a loss set says what may go:
 * sprint 1's model round trip, and the per-dialect SQL read-back diff.
 */
export function gradeReadBackNotEmpty(commandOutcome, backSummary, sourceSummary, importer) {
  if (commandOutcome.status !== "pass") return commandOutcome;
  if (!backSummary || backSummary.unreadable) {
    return {
      status: "could_not_answer",
      detail: `the read-back model could not be read: ${backSummary?.unreadable ?? "no file"}`,
    };
  }
  if (backSummary.objectTypes === 0 && (sourceSummary?.objectTypes ?? 0) > 0) {
    return {
      status: "fail",
      severity: "S1",
      detail:
        `the ${importer} importer exited 0 and wrote an empty model from an export of ${sourceSummary.objectTypes} object types`,
    };
  }
  return commandOutcome;
}

/**
 * `lineage impact --format json` is { changedElement, affectedArtifacts }.
 * The late requirement's element is rendered in the DDL exported a moment
 * earlier, so an empty list is a wrong answer, not an absent one. This
 * step graded the exit code alone, and every impact check passed while
 * the manifest recorded no sources at all (barwise-ofb).
 */
export function gradeImpact(result, report, element) {
  if (crashed(result)) {
    return {
      status: "fail",
      severity: "S2",
      detail: `lineage impact crashed: ${firstLine(result.stderr)}`,
    };
  }
  if (
    !report || typeof report.changedElement !== "string" || !Array.isArray(report.affectedArtifacts)
  ) {
    return {
      status: "could_not_answer",
      detail: `lineage impact returned no { changedElement, affectedArtifacts } to read: ${
        String(result.stdout).slice(0, 160)
      }`,
    };
  }
  if (report.affectedArtifacts.length === 0) {
    return {
      status: "fail",
      severity: "S1",
      detail:
        `lineage impact reports no affected artifacts for ${element}, which the DDL exported before the change renders`,
    };
  }
  return {
    status: "pass",
    detail: `${report.affectedArtifacts.length} artifact(s) affected by ${element}`,
  };
}

/** Validation of a model the product itself produced: errors are its own defect. */
export function gradeProducedModelValidation(result, diagnostics) {
  if (crashed(result)) {
    return {
      status: "fail",
      severity: "S2",
      detail: `validate crashed: ${firstLine(result.stderr)}`,
    };
  }
  if (!Array.isArray(diagnostics)) {
    return {
      status: "could_not_answer",
      detail: `validate exited ${result.exit} but produced no diagnostics array to read`,
    };
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  // validate exits non-zero only when it reports errors or cannot run at
  // all, and a warnings-only model exits 0. So a non-zero exit with no
  // errors in the list means the command failed without saying why --
  // not a clean model.
  if (errors.length === 0 && result.exit !== 0) {
    return {
      status: "could_not_answer",
      detail: `validate exited ${result.exit} but reported no errors to explain it`,
    };
  }
  if (errors.length === 0) {
    return {
      status: "pass",
      detail: `no structural errors (${diagnostics.length} warnings)`,
    };
  }
  const rules = [...new Set(errors.map((e) => e.rule ?? e.ruleId ?? e.code ?? "?"))];
  return {
    status: "fail",
    severity: "S1",
    detail: `the model the importer wrote has ${errors.length} structural error(s): ${
      rules.slice(0, 5).join(", ")
    }`,
    evidence: { errors: errors.slice(0, 5) },
  };
}

/** import -> export -> import must be a fixed point up to the format's declared loss set. */
export function gradeRoundTrip(diff, lossSet) {
  // An error object, or any payload without a deltas array, is not a diff
  // with nothing in it. Reading it as an empty delta list certified the
  // round trip on the strength of output the oracle never understood.
  if (!diff || !Array.isArray(diff.deltas)) {
    return {
      status: "could_not_answer",
      detail: `diff returned no deltas array to read: ${
        JSON.stringify(diff ?? null).slice(0, 160)
      }`,
    };
  }
  const deltas = diff.deltas.filter((d) => d.kind !== "unchanged");
  const allowed = (d) =>
    (lossSet?.allowed ?? []).some((a) =>
      (a.elementType === "*" || a.elementType === d.elementType)
      && (a.kind === "*" || a.kind === d.kind)
    );
  const outside = deltas.filter((d) => !allowed(d));
  if (outside.length === 0) {
    return {
      status: "pass",
      detail: `${deltas.length} delta(s), all inside the loss set`,
      evidence: { inside: deltas.length },
    };
  }
  const sample = outside.slice(0, 8).map((d) => `${d.kind} ${d.elementType} ${d.name}`);
  return {
    status: "fail",
    severity: "S1",
    detail: `${outside.length} delta(s) outside the declared loss set: ${sample.join("; ")}`,
    evidence: { outside: outside.length, inside: deltas.length - outside.length, sample },
  };
}

/**
 * A split is lossless when every object type still has a home and every
 * type living in more than one domain is DECLARED in a context mapping.
 *
 * The first version of this oracle required "exactly one domain", which is
 * not what the product does: `project split` deliberately replicates a type
 * across a seam and emits a context mapping naming its owner (docs/CLI.md,
 * "suggested context mappings for any object type shared across a seam").
 * Requiring exactly one domain reported 12 customers' correct splits as S1
 * losses. The property worth holding is the one CLAUDE.md states -- cross-
 * domain references go through declared context mappings -- so an
 * undeclared shared type is the finding, and a declared one is the design.
 */
export function gradeSplit(monolithNames, domainNameLists, stderr, mappedNames = null) {
  const seen = new Map();
  for (const [domain, names] of Object.entries(domainNameLists)) {
    for (const n of names) seen.set(n, [...(seen.get(n) ?? []), domain]);
  }
  const missing = monolithNames.filter((n) => !seen.has(n));
  const dropped = (stderr.match(/Dropped a .*? constraint/g) ?? []).length;
  const shared = [...seen.entries()].filter(([, ds]) => ds.length > 1);
  // Only the missing half of the invariant used to be checked. A shared
  // type is expected; a shared type no mapping declares is a silent seam.
  const undeclared = mappedNames
    ? shared.filter(([n]) => !mappedNames.has(n))
    : [];
  if (undeclared.length) {
    return {
      status: "fail",
      severity: "S1",
      detail:
        `${undeclared.length} object type(s) live in more than one domain with no context mapping declaring the seam: ${
          undeclared.slice(0, 6).map(([n, ds]) => `${n} (${ds.join(", ")})`).join("; ")
        }`,
      evidence: {
        undeclared: undeclared.slice(0, 6).map(([n, ds]) => ({ name: n, domains: ds })),
        shared: shared.length,
        dropped,
      },
    };
  }
  if (missing.length) {
    return {
      status: "fail",
      severity: "S1",
      detail: `${missing.length} object type(s) in no domain after the split: ${
        missing.slice(0, 6).join(", ")
      }`,
      evidence: { missing, dropped },
    };
  }
  const sharedNote = shared.length
    ? `; ${shared.length} shared across a seam, each declared in a mapping`
    : "";
  return {
    status: dropped ? "refused" : "pass",
    detail: dropped
      ? `lossless on object types${sharedNote}; ${dropped} cross-domain constraint(s) dropped, each warned`
      : `lossless${sharedNote}`,
    evidence: { dropped, shared: shared.length },
  };
}

/** Each history step's diff must show what the change was. */
export function gradeHistoryStep(expect, diff) {
  // Same rule as gradeRoundTrip: an unreadable payload is not a diff that
  // found nothing. Without this, "the change is invisible to diff" was the
  // verdict whenever the oracle could not read the diff at all.
  if (!diff || !Array.isArray(diff.deltas)) {
    return {
      status: "could_not_answer",
      detail: `diff returned no deltas array to read: ${
        JSON.stringify(diff ?? null).slice(0, 160)
      }`,
    };
  }
  const deltas = diff.deltas;
  const synonyms = diff.synonymCandidates ?? [];
  const has = (kind, elementType, name) =>
    deltas.some((d) => d.kind === kind && d.elementType === elementType && d.name === name);
  if (expect.renamed) {
    const { from, to } = expect.renamed;
    // A synonym candidate names its pair as removedName and addedName
    // (barwise diff --format json). Matched on the serialised candidate as a
    // substring, an object-type rename passed on the strength of a
    // fact-type candidate that merely mentions both names.
    const asRename = synonyms.some((s) =>
      s.elementType === "object_type" && s.removedName === from && s.addedName === to
    );
    if (asRename) {
      return { status: "pass", detail: `rename ${from} -> ${to} reported as a synonym candidate` };
    }
    if (has("removed", "object_type", from) && has("added", "object_type", to)) {
      return {
        status: "fail",
        severity: "S5",
        detail:
          `rename ${from} -> ${to} reported as a removal plus an addition with no synonym candidate`,
      };
    }
    return {
      status: "fail",
      severity: "S1",
      detail: `rename ${from} -> ${to} not visible in the diff at all`,
    };
  }
  if (expect.addedFactType) {
    return has("added", "fact_type", expect.addedFactType)
      ? { status: "pass", detail: "addition reported" }
      : {
        status: "fail",
        severity: "S1",
        detail: `added fact type ${expect.addedFactType} missing from the diff`,
      };
  }
  if (expect.removedObjectType) {
    return has("removed", "object_type", expect.removedObjectType)
      ? { status: "pass", detail: "removal reported" }
      : {
        status: "fail",
        severity: "S1",
        detail: `removed object type ${expect.removedObjectType} missing from the diff`,
      };
  }
  if (expect.modifiedObjectType) {
    return deltas.some((d) => d.kind === "modified" && d.name === expect.modifiedObjectType)
      ? { status: "pass", detail: "modification reported" }
      : {
        status: "fail",
        severity: "S1",
        detail: `modified object type ${expect.modifiedObjectType} missing from the diff`,
      };
  }
  if (expect.modifiedFactType) {
    return deltas.some((d) => d.kind === "modified" && d.name === expect.modifiedFactType)
      ? { status: "pass", detail: "modification reported" }
      : {
        status: "fail",
        severity: "S1",
        detail:
          `modified fact type ${expect.modifiedFactType} missing from the diff (a constraint change invisible to diff)`,
      };
  }
  if (expect.addedSubtype) {
    // The CLI's JSON carries a subtype delta's endpoints only inside its
    // `name`, which core's `elementName` spells "X is a subtype of Y"
    // (diff/deltas.ts). Two earlier versions of this matcher were built on
    // shapes the CLI never emits: first an invented "X < Y" name matched
    // by substring -- which let the expected supertype "User" be satisfied
    // by the subtype's own name "VerifiedUser" -- then core's in-memory
    // `subtype.name` / `supertype.name`, which the CLI serializer drops,
    // so every add_subtype step failed. The name is compared whole, and
    // the test that pins it runs the real CLI (tests/history.test.mjs).
    const { subtype, supertype } = expect.addedSubtype;
    const want = `${subtype} is a subtype of ${supertype}`;
    return deltas.some((d) =>
        d.kind === "added" && d.elementType === "subtype_fact" && d.name === want
      )
      ? { status: "pass", detail: `subtype ${subtype} < ${supertype} reported` }
      : {
        status: "fail",
        severity: "S1",
        detail:
          `added subtype ${expect.addedSubtype.subtype} < ${expect.addedSubtype.supertype} missing from the diff`,
      };
  }
  if (expect.renamedFactType) {
    const { from, to } = expect.renamedFactType;
    const asRename = synonyms.some((s) =>
      s.elementType === "fact_type" && s.removedName === from && s.addedName === to
    );
    return asRename
      ? { status: "pass", detail: "fact-type rename reported as a synonym candidate" }
      : {
        status: "fail",
        severity: "S5",
        detail: `fact-type rename ${from} -> ${to} not reported as a synonym candidate`,
      };
  }
  return { status: "could_not_answer", detail: "no expectation for this change kind" };
}

/** An export the customer's own tools reject is a finding. */
export function gradeConsumer(report) {
  if (report.unavailable) return { status: "could_not_answer", detail: report.unavailable };
  if (report.failures?.length) {
    return {
      status: "fail",
      severity: "S1",
      detail: `${report.failures.length} of ${
        report.statements ?? report.total
      } item(s) rejected by the consumer: ${report.failures[0].error}`,
      evidence: { failures: report.failures.slice(0, 5) },
    };
  }
  return {
    status: "pass",
    detail: `${report.parsed ?? report.total} item(s) accepted by the consumer`,
  };
}

/**
 * A persona's rubric over the model barwise produced. Failed checks are
 * the edit distance to acceptance (S5): the draft needs work before this
 * person signs off. The exception is must_validate: an importer that
 * wrote a structurally invalid model is silent wrong output (S1).
 */
/**
 * After a late requirement lands, the artifacts exported before it are
 * wrong. The property is that barwise SAYS SO: a team that has to
 * notice staleness by eye will ship the stale artifact. `lineage status`
 * exits 1 when anything is stale, which is the signal a CI gate would
 * key on, so a clean report after a real model change is the finding.
 */
export function gradeStaleness(result, report) {
  if (crashed(result)) {
    return {
      status: "fail",
      severity: "S2",
      detail: `lineage status crashed: ${firstLine(result.stderr)}`,
    };
  }
  const text = `${result.stdout}${result.stderr}`;
  if (/no manifest|not found|run .*export/i.test(text)) {
    return {
      status: "fail",
      severity: "S1",
      detail:
        "lineage status found no manifest even though this model was exported a moment ago, so nothing tracks what the late requirement invalidated",
    };
  }
  // The field is `staleArtifacts`, and reading it wrong is not a
  // hypothetical: the first version of this oracle looked for `stale`
  // and fell back to a /\bstale\b/ regex, which does not match
  // "staleArtifacts" because the word boundary fails on the capital A.
  // It graded a correct lineage report as a silent-staleness S1 against
  // the product. Hence the explicit refusal below when the payload is
  // not the shape this oracle knows: a grader that cannot read its input
  // must not render a verdict about the thing it was measuring.
  if (!report || !Array.isArray(report.staleArtifacts)) {
    return {
      status: "could_not_answer",
      detail: `lineage status returned no staleArtifacts array to read: ${text.slice(0, 160)}`,
    };
  }
  // The same rule one field further in: the JSON form of "no manifest" is
  // `manifestFound: false` with both artifact lists empty, which satisfies
  // the shape check above and then reads as a product that tracked nothing.
  // A harness with no manifest to read cannot answer the staleness question.
  // Only an explicit manifestFound: true licenses a verdict. The check used
  // to refuse only on an explicit false, so a payload missing the field --
  // which the product never emits, and the fixtures here once did -- was
  // graded as a real report.
  if (report.manifestFound !== true) {
    return {
      status: "could_not_answer",
      detail: `lineage status reports manifestFound: ${
        JSON.stringify(report.manifestFound)
      }, so there is no manifest to read staleness from`,
    };
  }
  if (report.staleArtifacts.length > 0) {
    return {
      status: "pass",
      detail:
        `${report.staleArtifacts.length} artifact(s) reported stale after the requirement landed`,
    };
  }
  return {
    status: "fail",
    severity: "S1",
    detail:
      "the model changed and lineage status reports nothing stale, so an export made before the requirement still reads as current",
  };
}

export function gradeAcceptance(result, report) {
  if (crashed(result)) {
    return {
      status: "fail",
      severity: "S2",
      detail: `gym check crashed: ${firstLine(result.stderr)}`,
    };
  }
  // An exit-0 run whose report is missing or malformed read as zero checks,
  // zero failures, and therefore acceptance -- certified without a single
  // check having been graded.
  if (!report || !Array.isArray(report.results)) {
    return {
      status: "could_not_answer",
      detail: `gym check exited ${result.exit} but returned no results array to read`,
    };
  }
  const results = report.results;
  const failed = results.filter((r) => !r.passed);
  if (result.exit === 0 && failed.length === 0) {
    if (results.length === 0) {
      return {
        status: "could_not_answer",
        detail: "gym check reported zero persona checks, so acceptance was never exercised",
      };
    }
    return { status: "pass", detail: `${results.length} persona checks pass` };
  }
  const invalid = failed.some((f) => f.kind === "must_validate");
  return {
    status: "fail",
    severity: invalid ? "S1" : "S5",
    detail: `${failed.length} of ${results.length} persona checks fail: ${
      failed.slice(0, 4).map((f) => f.message ?? f.kind).join("; ")
    }`,
    evidence: { failed: failed.slice(0, 6) },
  };
}

/**
 * Validation parity compares error and warning counts, and it can only
 * do that over payloads it read. Both sides used to be summarised first
 * and compared after, so two unreadable payloads became the same
 * `{ unreadable: true }` and passed as agreement, and a payload of the
 * wrong shape summarised to zero errors -- the shape of a clean model.
 * The shapes are the products' own: `barwise validate --format json`
 * prints an array of diagnostics; the MCP `validate_model` tool returns
 * `{ errors: [...], warnings: [...] }` for a single model
 * (packages/mcp/src/tools/validate.ts).
 */
export function gradeValidationParity(cliStdout, mcpText) {
  const read = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  const cli = read(cliStdout);
  const mcp = read(mcpText);
  const cliOk = Array.isArray(cli);
  const mcpOk = Array.isArray(mcp?.errors) && Array.isArray(mcp?.warnings);
  if (!cliOk || !mcpOk) {
    const side = !cliOk && !mcpOk ? "neither side's" : !cliOk ? "the CLI's" : "the MCP tool's";
    return {
      status: "could_not_answer",
      detail:
        `validate: ${side} payload is not the validation shape, so there are no counts to compare`,
    };
  }
  const count = (list, severity) => list.filter((d) => d.severity === severity).length;
  const summary = (list) =>
    JSON.stringify({ errors: count(list, "error"), warnings: count(list, "warning") });
  return gradeParity(summary(cli), summary([...mcp.errors, ...mcp.warnings]), "validate");
}

export function gradeParity(cliText, mcpText, label) {
  const a = normalizeOutput(cliText);
  const b = normalizeOutput(mcpText);
  if (a === b) return { status: "pass", detail: `${label}: CLI and MCP agree` };
  const firstDiff = firstDifference(a, b);
  return {
    status: "fail",
    severity: "S1",
    detail:
      `${label}: CLI and MCP differ at character ${firstDiff.index}: cli "${firstDiff.a}" vs mcp "${firstDiff.b}"`,
  };
}

function normalizeOutput(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(
    /\/[^\s"']*\/(generated|kernel)[^\s"']*/g,
    "<path>",
  ).replace(/\s+$/gm, "").trim();
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return {
    index: i,
    a: a.slice(Math.max(0, i - 20), i + 40),
    b: b.slice(Math.max(0, i - 20), i + 40),
  };
}

export function countWarnings(stderr) {
  const m = /(\d+) warning/.exec(stderr);
  return m ? Number(m[1]) : 0;
}

export function firstLine(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).find((l) =>
    l && !/^Importing|^Imported|^Confidence/.test(l)
  ) ?? "";
}
