/**
 * Scores how a loader reports malformed object types and fact types: the D2
 * measure of docs/specs/effect-comparison.spec.md, and S4 of
 * docs/specs/effect-adoption.spec.md, which extends it to fact types, their
 * roles and their constraints.
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

/** The document collection each element kind lives in. */
const COLLECTIONS = { object_type: "object_types", fact_type: "fact_types" };

/** Whether a message holds a path to position `index` of `collection`. */
function atPosition(message, collection, index) {
  return new RegExp(`${collection}"?\\]?(/|\\[)${index}(\\b|\\])`).test(message);
}

/**
 * How a message identifies an element: by its name or id, which a person
 * can act on, or only by its position in the file.
 *
 * A position is read in both path spellings the arms produce: a JSON
 * pointer (`object_types/1`, today's schema check) and a bracketed path
 * (`object_types[1]` or `["object_types"][1]`, Effect Schema's). Knowing
 * only the first would score the Effect arm lower for its punctuation.
 * The collection follows the element's kind, so `fact_types/1` never
 * credits the object type at position 1.
 */
export function identifies(message, { id, name, index, kind = "object_type" }) {
  const byName = name.trim() !== "" && message.includes(name);
  const byId = message.includes(id);
  const byIndex = atPosition(message, COLLECTIONS[kind], index);
  return { readable: byName || byId, any: byName || byId || byIndex };
}

/**
 * Whether a message identifies the constraint a problem sits in: by its id
 * when it has one, else by its position in the fact type's `constraints`.
 */
export function identifiesConstraint(message, constraint) {
  if (constraint.id && message.includes(constraint.id)) return true;
  return atPosition(message, "constraints", constraint.index);
}

/**
 * The paths under `before` that `after` does not have, at every depth.
 *
 * Array items are matched by `id` when every item on both sides has one,
 * so a reordered list is not a loss, and by position otherwise. A missing
 * item is one loss at its own path, not one per field inside it.
 */
function missingPaths(before, after, prefix) {
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) return [prefix];
    const keyed = [...before, ...after].every((x) => x && typeof x === "object" && "id" in x);
    return before.flatMap((item, i) => {
      const match = keyed ? after.find((o) => o.id === item.id) : after[i];
      return match === undefined ? [`${prefix}.${i}`] : missingPaths(item, match, `${prefix}.${i}`);
    });
  }
  if (before && typeof before === "object") {
    if (!after || typeof after !== "object") return [prefix];
    return Object.keys(before).flatMap((key) =>
      key in after
        ? missingPaths(before[key], after[key], `${prefix}.${key}`)
        : [`${prefix}.${key}`]
    );
  }
  return [];
}

/**
 * Object type and fact type fields present in the input and missing after
 * a round trip, at every depth: `data_type`, `roles.0.player`,
 * `constraints.1.ring_type`.
 *
 * An element missing altogether is reported field by field at its top
 * level, so a dropped element reads as the loss of everything it held.
 */
export function lostKeys(inputYaml, outputYaml) {
  const lost = [];
  for (const collection of Object.values(COLLECTIONS)) {
    const before = parse(inputYaml)?.model?.[collection] ?? [];
    const after = new Map((parse(outputYaml)?.model?.[collection] ?? []).map((o) => [o.id, o]));
    for (const el of before) {
      const out = after.get(el.id);
      if (!out) {
        for (const key of Object.keys(el)) lost.push({ id: el.id, key });
        continue;
      }
      for (const path of missingPaths(el, out, "")) lost.push({ id: el.id, key: path.slice(1) });
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
 *
 * `ambiguous` lists every message credited to more than one problem. The
 * scorer cannot tell such a message from a report that lists every problem
 * in one block of text -- Effect Schema's default formatter does exactly
 * that -- and crediting the block would count each problem whose field and
 * object type appear anywhere in it, in unrelated parts. A loader is scored
 * one message per problem; the caller refuses a reading with an ambiguous
 * message rather than report the inflated count.
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
      // Only a problem inside a constraint is asked to name the constraint.
      ...(p.constraint
        ? { namesConstraint: attributed.some((m) => identifiesConstraint(m, p.constraint)) }
        : {}),
    };
  });
  const ambiguous = messages
    .map((m) => ({
      message: m,
      ids: problems
        .filter((p) => namesField(m, p.field) && (problems.length === 1 || identifies(m, p).any))
        .map((p) => p.id),
    }))
    .filter((a) => a.ids.length > 1);
  return { outcome, messages, problems: scored, silentLosses, ambiguous };
}

/**
 * The one element a case's fixture is about, and the problem it carries.
 *
 * An object type case (`kind` absent) holds exactly one object type. A
 * fact type case (`kind: "fact_type"`) holds exactly one fact type, and
 * the object types its roles need, which are well formed and carry no
 * problem of their own.
 *
 * The id and name come from the fixture, not from the manifest: a copy of
 * them in `cases.json` would be a second statement of the fixture that
 * nothing checks, and an edited fixture would then be scored against the
 * wrong element. Only the field, and for a problem inside a constraint that
 * constraint's position, are declared, because they are what the file
 * cannot say about itself.
 */
export function caseProblem(c, yamlText, index = 0) {
  const kind = c.kind ?? "object_type";
  const model = parse(yamlText)?.model ?? {};
  const elements = model[COLLECTIONS[kind]] ?? [];
  if (elements.length !== 1) {
    throw new Error(
      `${c.file}: a ${kind} case holds exactly one ${kind}, found ${elements.length}`,
    );
  }
  const el = elements[0];
  const problem = { kind, id: String(el.id), name: String(el.name ?? ""), field: c.field, index };
  if (c.constraint !== undefined) {
    const declared = el.constraints?.[c.constraint];
    if (!declared) throw new Error(`${c.file}: no constraint at position ${c.constraint}`);
    problem.constraint = { index: c.constraint, id: declared.id };
  }
  return {
    problem,
    element: el,
    supporting: kind === "fact_type" ? (model.object_types ?? []) : [],
  };
}

/**
 * One document holding every case's element.
 *
 * Object type cases come first, in case order, so their positions are the
 * ones they are scored at; the object types fact type cases need follow,
 * each once; then the fact types, in case order. Two cases may share a
 * supporting object type only if they define it identically, since the
 * combined file can hold one.
 */
export function combine(cases, readCase) {
  const loaded = cases.map((c) => ({ c, yaml: readCase(c.file) }));
  const objectTypes = [];
  const factTypes = [];
  const problems = [];
  for (const { c, yaml } of loaded) {
    if ((c.kind ?? "object_type") !== "object_type") continue;
    const { problem, element } = caseProblem(c, yaml, objectTypes.length);
    problems.push(problem);
    objectTypes.push(element);
  }
  const supportingById = new Map();
  for (const { c, yaml } of loaded) {
    if (c.kind !== "fact_type") continue;
    const { problem, element, supporting } = caseProblem(c, yaml, factTypes.length);
    for (const ot of supporting) {
      const seen = supportingById.get(ot.id);
      if (seen && JSON.stringify(seen) !== JSON.stringify(ot)) {
        throw new Error(`${c.file}: object type ${ot.id} differs from another case's`);
      }
      supportingById.set(ot.id, ot);
    }
    problems.push(problem);
    factTypes.push(element);
  }
  objectTypes.push(...supportingById.values());
  const model = { name: "Malformed", object_types: objectTypes };
  if (factTypes.length > 0) model.fact_types = factTypes;
  return { yaml: stringify({ orm_version: "2.0", model }), problems };
}

/**
 * Why a set of readings cannot be reported, or null when it can: the text
 * `measure-comparison malformed` refuses with when any message is ambiguous
 * (see `scoreDocument`).
 */
export function ambiguityReport(readings) {
  const ambiguous = readings.flatMap((r) => r.ambiguous);
  if (ambiguous.length === 0) return null;
  return "a message is credited to more than one problem, so the count would be inflated:\n"
    + ambiguous.map((a) => `  [${a.ids.join(", ")}] ${a.message.split("\n")[0]}\n`).join("")
    + "  Report problems as a list (`problems` or `validationResult.errors`), one per entry.";
}

/** Totals over a scored document, for the summary line. */
export function summarize(result) {
  const inConstraint = result.problems.filter((p) => "namesConstraint" in p);
  return {
    outcome: result.outcome,
    problems: result.problems.length,
    reported: result.problems.filter((p) => p.reported).length,
    namesElement: result.problems.filter((p) => p.namesElement).length,
    inConstraint: inConstraint.length,
    namesConstraint: inConstraint.filter((p) => p.namesConstraint).length,
    silentLosses: result.silentLosses.length,
  };
}
