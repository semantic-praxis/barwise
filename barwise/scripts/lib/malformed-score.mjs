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

/**
 * The words of a text: camelCase split at its humps, everything lowercased,
 * anything not a letter or digit a separator. `referenceMode`,
 * `reference_mode` and "reference mode" all read as `reference mode`.
 */
const words = (s) =>
  String(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(
    Boolean,
  );

/**
 * The names of element kinds a message uses as labels ("Fact type
 * \"Permit\"", "object_types/2"). Their `type` is part of the label, not
 * the `type` field a constraint case is about.
 */
const KIND_LABELS = ["fact", "object", "entity", "value"];

/**
 * Whether a message names a field, in any spelling: `reference_mode`,
 * `referenceMode`, "reference mode".
 *
 * Whole words, in sequence. A substring match credited a field to any
 * message that held it inside a longer word: `type` inside the
 * `fact_types` of every fact type path, `role` inside `roles`, so a
 * generic message about a constraint was scored as naming the field.
 * Whole words alone still credited `type` to a message that says "Fact
 * type \"Permit has Age\"", so a `type` that completes an element-kind
 * label is not a match, unless the field itself is that label
 * (`value_type`).
 */
export function namesField(message, field) {
  const said = words(message);
  const name = words(field);
  return said.some((_, i) =>
    name.every((w, j) => said[i + j] === w)
    && !(name[0] === "type" && KIND_LABELS.includes(said[i - 1]))
  );
}

/**
 * The document collection each element kind lives in, in the order a
 * document lists them, and the field that keys an element of it. Format 3.0
 * added the model's own `constraints` list (effect-adoption.spec.md, 1r);
 * a definition is keyed by its term and a diagram by its name, since
 * neither has an id.
 */
const COLLECTIONS = {
  object_type: "object_types",
  fact_type: "fact_types",
  constraint: "constraints",
  subtype_fact: "subtype_facts",
  objectified: "objectified_fact_types",
  population: "populations",
  definition: "definitions",
  diagram: "diagrams",
};
const KEY_FIELD = { definition: "term", diagram: "name" };
const keyOf = (kind, el) => el?.[KEY_FIELD[kind] ?? "id"];

/** A path separator in either spelling: `/`, `.`, or a bracket. */
const SEP = String.raw`"?\]?(?:/|\.|\[)"?`;

/**
 * Whether a message holds a path to position `index` of `collection`.
 *
 * The model's own `constraints` and a fact type's share a name, so a
 * model-level collection is matched only right after `model`, and a fact
 * type's constraints only when not right after it: `model/constraints/0`
 * and `fact_types/5/constraints/0` are different elements. Every other
 * collection name is unique, and matches wherever it appears.
 */
function atPosition(message, collection, index, { modelLevel = false } = {}) {
  const at = `${collection}"?\\]?(/|\\[)${index}(\\b|\\])`;
  if (collection !== "constraints") return new RegExp(at).test(message);
  const afterModel = new RegExp(`model${SEP}${at}`).test(message);
  if (modelLevel) return afterModel;
  return new RegExp(at, "g").test(message.replace(new RegExp(`model${SEP}${at}`, "g"), ""));
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
  // The header is one per document: naming the model is naming it.
  if (kind === "header") {
    const named = namesField(message, "model");
    return { readable: named, any: named };
  }
  const byName = name.trim() !== "" && message.includes(name);
  const byId = id !== "" && message.includes(id);
  const byIndex = atPosition(message, COLLECTIONS[kind], index, {
    modelLevel: kind === "constraint",
  });
  return { readable: byName || byId, any: byName || byId || byIndex };
}

/**
 * Whether a message identifies the constraint a problem sits in: by its id
 * when it has one, else by its position in the fact type's `constraints`.
 * A constraint with an id is named only by the id, as S4 asks; its
 * position does not stand in for it.
 */
export function identifiesConstraint(message, constraint) {
  if (constraint.id) return message.includes(constraint.id);
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
  const input = parse(inputYaml)?.model ?? {};
  const output = parse(outputYaml)?.model ?? {};
  // The header's own fields: every key of `model` that is not a collection.
  const collections = new Set(Object.values(COLLECTIONS));
  for (const key of Object.keys(input)) {
    if (!collections.has(key) && !(key in output)) lost.push({ id: "model", key });
  }
  for (const [kind, collection] of Object.entries(COLLECTIONS)) {
    const before = input[collection] ?? [];
    const after = new Map((output[collection] ?? []).map((o) => [keyOf(kind, o), o]));
    for (const el of before) {
      const id = keyOf(kind, el);
      const out = after.get(id);
      if (!out) {
        for (const key of Object.keys(el)) lost.push({ id, key });
        continue;
      }
      for (const path of missingPaths(el, out, "")) lost.push({ id, key: path.slice(1) });
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
 * A case's kind names its collection (`COLLECTIONS`; an object type when
 * `kind` is absent), and the fixture holds exactly one element there.
 * Every element in the fixture's other collections is supporting: well
 * formed, carrying no problem, there so the case's element can name it --
 * the object types a fact type's roles need, the fact types and subtype
 * facts a model-level constraint spans.
 *
 * A `header` case is about the model's own fields (`name`, `namespace`).
 * Its element is the header, and it is scored singly: a document has one
 * header, so two header cases cannot be combined (effect-adoption.spec.md,
 * 1r).
 *
 * The id and name come from the fixture, not from the manifest: a copy of
 * them in `cases.json` would be a second statement of the fixture that
 * nothing checks, and an edited fixture would then be scored against the
 * wrong element. Only the field, and for a problem inside a fact type's
 * constraint that constraint's position, are declared, because they are
 * what the file cannot say about itself.
 */
export function caseProblem(c, yamlText, index = 0) {
  const kind = c.kind ?? "object_type";
  const model = parse(yamlText)?.model ?? {};
  if (kind === "header") {
    const header = Object.fromEntries(
      Object.entries(model).filter(([k]) => !Object.values(COLLECTIONS).includes(k)),
    );
    return {
      problem: { kind, id: "", name: String(model.name ?? ""), field: c.field, index: 0 },
      element: header,
      supporting: {},
    };
  }
  const collection = COLLECTIONS[kind];
  if (!collection) throw new Error(`${c.file}: unknown case kind ${kind}`);
  const elements = model[collection] ?? [];
  if (elements.length !== 1) {
    throw new Error(
      `${c.file}: a ${kind} case holds exactly one ${kind}, found ${elements.length}`,
    );
  }
  const el = elements[0];
  const problem = {
    kind,
    id: String(keyOf(kind, el) ?? ""),
    name: String(el.name ?? el.term ?? ""),
    field: c.field,
    index,
  };
  if (c.constraint !== undefined) {
    const declared = el.constraints?.[c.constraint];
    if (!declared) throw new Error(`${c.file}: no constraint at position ${c.constraint}`);
    problem.constraint = { index: c.constraint, id: declared.id };
  }
  const supporting = Object.fromEntries(
    Object.values(COLLECTIONS)
      .filter((other) => other !== collection && (model[other] ?? []).length > 0)
      .map((other) => [other, model[other]]),
  );
  return { problem, element: el, supporting };
}

/**
 * One document holding every case's element.
 *
 * Collections are written in document order. Within each, the elements of
 * that collection's cases come first, in case order, so their positions
 * are the ones they are scored at; then the supporting elements other
 * cases need there, each once. Two cases may share a supporting element
 * only if they define it identically, since the combined file can hold
 * one. Header cases are left out (see `caseProblem`). The document states
 * the version the manifest's fixtures are written in, 2.0 unless given.
 */
export function combine(cases, readCase, version = "2.0") {
  // A header case has no collection, so the loop below never takes it.
  const loaded = cases.map((c) => ({ c, yaml: readCase(c.file) }));
  const own = Object.fromEntries(Object.values(COLLECTIONS).map((col) => [col, []]));
  const support = Object.fromEntries(Object.values(COLLECTIONS).map((col) => [col, new Map()]));
  const problems = [];
  for (const [kind, collection] of Object.entries(COLLECTIONS)) {
    for (const { c, yaml } of loaded) {
      if ((c.kind ?? "object_type") !== kind) continue;
      const { problem, element, supporting } = caseProblem(c, yaml, own[collection].length);
      problems.push(problem);
      own[collection].push(element);
      for (const [other, els] of Object.entries(supporting)) {
        const otherKind = Object.keys(COLLECTIONS).find((k) => COLLECTIONS[k] === other);
        for (const el of els) {
          const key = keyOf(otherKind, el);
          const seen = support[other].get(key);
          if (seen && JSON.stringify(seen) !== JSON.stringify(el)) {
            throw new Error(`${c.file}: ${otherKind} ${key} differs from another case's`);
          }
          support[other].set(key, el);
        }
      }
    }
  }
  const model = { name: "Malformed" };
  for (const collection of Object.values(COLLECTIONS)) {
    const els = [...own[collection], ...support[collection].values()];
    if (els.length > 0 || collection === "object_types") model[collection] = els;
  }
  return { yaml: stringify({ orm_version: version, model }), problems };
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
