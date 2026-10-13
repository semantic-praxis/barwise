/**
 * Scores how a loader reports malformed object types: the D2 measure of
 * docs/specs/effect-comparison.spec.md.
 *
 * It measures rather than asserts. Today's loader reports the first problem
 * and silently drops one field, and the comparison's two arms are built to
 * do better; a gate that failed on today's behaviour would be a test pinned
 * to a limitation, and one that passed on it would say nothing. So the
 * scorer returns what happened and the caller prints it.
 *
 * The loader is a parameter (`deserialize` and `serialize`, the shape of
 * `OrmYamlSerializer`) so the scorer's own test can hand it a loader that
 * drops a field and check the loss is reported.
 */
import { parse, stringify } from "yaml";

/**
 * Every message an error carries.
 *
 * A schema failure lists its errors on `validationResult.errors`; a loader
 * that collects problems may list them on `problems`; anything else is one
 * message.
 */
export function messagesOf(err) {
  const listed = err?.validationResult?.errors;
  if (Array.isArray(listed) && listed.length > 0) {
    return listed.map((e) => `${e.path ?? ""}: ${e.message ?? ""}`);
  }
  if (Array.isArray(err?.problems) && err.problems.length > 0) {
    return err.problems.map((p) => (typeof p === "string" ? p : (p.message ?? JSON.stringify(p))));
  }
  return [String(err?.message ?? err)];
}

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether a message names a field, in any spelling: `reference_mode`, `referenceMode`, "reference mode". */
export function namesField(message, field) {
  return squash(message).includes(squash(field));
}

/**
 * How a message identifies an object type: by its name or id, which a
 * person can act on, or only by its position in the file.
 */
export function identifies(message, { id, name, index }) {
  const byName = name.trim() !== "" && message.includes(name);
  const byId = message.includes(id);
  const byIndex = new RegExp(`object_types(/|\\[)${index}(\\b|\\])`).test(message);
  return { readable: byName || byId, any: byName || byId || byIndex };
}

/** Object type fields present in the input and missing after a round trip. */
export function lostKeys(inputYaml, outputYaml) {
  const before = parse(inputYaml)?.model?.object_types ?? [];
  const after = new Map((parse(outputYaml)?.model?.object_types ?? []).map((o) => [o.id, o]));
  const lost = [];
  for (const ot of before) {
    const out = after.get(ot.id);
    for (const key of Object.keys(ot)) {
      if (!out || !(key in out)) lost.push({ id: ot.id, key });
    }
  }
  return lost;
}

/**
 * Load one document and score it against the problems it is known to hold.
 *
 * `problems`: `{ id, name, field, index }` per object type. A problem is
 * reported when some message names its field and identifies its object
 * type -- by name, id or position, or trivially when the document holds
 * one problem. It is reported readably when that message names the object
 * type by name or id.
 */
export function scoreDocument(yamlText, problems, loader) {
  let messages = [];
  let silentLosses = [];
  let outcome;
  try {
    const model = loader.deserialize(yamlText);
    outcome = "loaded";
    silentLosses = lostKeys(yamlText, loader.serialize(model));
  } catch (err) {
    outcome = "refused";
    messages = messagesOf(err);
  }
  const scored = problems.map((p) => {
    const naming = messages.filter((m) => namesField(m, p.field));
    const attributed = naming.filter((m) => problems.length === 1 || identifies(m, p).any);
    return {
      id: p.id,
      field: p.field,
      reported: attributed.length > 0,
      namesElement: attributed.some((m) => identifies(m, p).readable),
    };
  });
  return { outcome, messages, problems: scored, silentLosses };
}

/** One document holding every case's object type, in case order. */
export function combine(cases, readCase) {
  const objectTypes = [];
  const problems = [];
  for (const c of cases) {
    const ots = parse(readCase(c.file))?.model?.object_types ?? [];
    for (const ot of ots) {
      problems.push({ id: c.id, name: c.name, field: c.field, index: objectTypes.length });
      objectTypes.push(ot);
    }
  }
  const yaml = stringify({
    orm_version: "2.0",
    model: { name: "Malformed", object_types: objectTypes },
  });
  return { yaml, problems };
}

/** Totals over a scored document, for the summary line. */
export function summarize(result) {
  return {
    outcome: result.outcome,
    problems: result.problems.length,
    reported: result.problems.filter((p) => p.reported).length,
    namesElement: result.problems.filter((p) => p.namesElement).length,
    silentLosses: result.silentLosses.length,
  };
}
