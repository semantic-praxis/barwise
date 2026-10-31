/**
 * Names for the elements a person does not name -- constraints, subtype
 * facts, objectifications -- minted from the sentence that states each,
 * and the content key each was minted from (iri-identity, section 3 and
 * WS6 6a). Pure: one model and one element give one name and one key.
 *
 * `OrmModel` gives an element added without an id its minted name
 * (decision 17; iri-identity 6b-2a). Storing the key beside it as
 * `minted_from`, and reporting the name stale when the element's key no
 * longer matches (decision 14), come with format 4.0. It takes the model as
 * `ConstraintModel`, which is what lets `OrmModel` call it without an
 * import cycle.
 *
 * Nothing is minted from a sentence that is not of the element: a
 * reference that does not resolve, a role two fact types hold, or an
 * internal constraint naming a role outside its own fact type would give a
 * sentence about something else (a dangling player reads as its role
 * name; a role of the wrong fact type reads "Malformed: ..."). Such an
 * element gets no name, and validation reports what is wrong with it.
 */
import { serializeConstraint } from "../serialization/yaml/constraint.js";
import { sentenceHolds } from "../verbalization/constraints/assumptions.js";
import { ConstraintVerbalizer } from "../verbalization/ConstraintVerbalizer.js";
import {
  type ObjectificationShape,
  type SubtypeFactShape,
  verbalizeObjectifiedFactType,
  verbalizeSubtypeFact,
} from "../verbalization/elementSentences.js";
import type { ConstraintInView, ConstraintModel } from "./constraintModel.js";
import type { FactType } from "./FactType.js";
import { localName } from "./name.js";

/** An element that takes a minted name. */
export type Mintable =
  | { readonly kind: "constraint"; readonly inView: ConstraintInView; }
  | { readonly kind: "subtypeFact"; readonly subtypeFact: SubtypeFactShape; }
  | { readonly kind: "objectification"; readonly objectification: ObjectificationShape; };

/** A minted name and the key it was minted from. */
export interface Minted {
  readonly name: string;
  readonly key: string;
}

const verbalizer = new ConstraintVerbalizer();

/**
 * The element's name and key, or undefined when its sentence would not be
 * of this element. One call checks the element once; `mintedName` and
 * `mintedKey` are this, halved.
 */
export function mint(element: Mintable, model: ConstraintModel): Minted | undefined {
  if (!isMintable(element, model)) return undefined;
  const text = sentence(element, model).trim().replace(/\.$/, "");
  return { name: localName(text), key: JSON.stringify(key(element, model)) };
}

/**
 * The element's name: its sentence without the closing period, through
 * `localName()`. Undefined when the sentence would not be of this element.
 */
export function mintedName(element: Mintable, model: ConstraintModel): string | undefined {
  return mint(element, model)?.name;
}

/**
 * What the name was minted from, without ids: the element's serialized
 * form with its id dropped and every reference replaced by what the
 * sentence names -- an object type by its name, a role by its name, its
 * position, and its fact type, a subtype fact by its two types' names.
 * Not the sentence, so a change to the verbalizer's wording does not make
 * every name stale (decision 14). Undefined when the element is not
 * mintable.
 *
 * The key is built from the serializer's field names rather than the
 * model's because the serialized form is what `minted_from` sits beside in
 * the file, and a reader comparing the two reads one vocabulary.
 */
export function mintedKey(element: Mintable, model: ConstraintModel): string | undefined {
  return mint(element, model)?.key;
}

function key(element: Mintable, model: ConstraintModel): unknown {
  switch (element.kind) {
    case "constraint": {
      const [constraint, host] = element.inView;
      const stated = constraintKey(constraint, model);
      // An internal constraint's sentence names its fact type even where
      // no role does (a value constraint on the whole fact type), so the
      // host is part of what the name was minted from.
      return host === undefined ? stated : { ...stated, fact_type: factTypeKey(host, model) };
    }
    case "subtypeFact": {
      const sf = element.subtypeFact;
      return {
        subtype: model.getObjectType(sf.subtypeId)!.name,
        supertype: model.getObjectType(sf.supertypeId)!.name,
        // The sentence prints the expression; the rule's kind and storage
        // do not change what it says.
        defining_rule: sf.definingRule?.expression ?? null,
      };
    }
    case "objectification": {
      const o = element.objectification;
      return {
        fact_type: factTypeKey(model.getFactType(o.factTypeId)!, model),
        object_type: model.getObjectType(o.objectTypeId)!.name,
      };
    }
  }
}

/**
 * Whether the element's sentence is of the element: every reference
 * resolves, each role to exactly one fact type, an internal constraint's
 * roles to its own, and what the sentence assumes of the shape holds
 * (`sentenceHolds`). It reads only what the element names, through the
 * model's lookups, not `graphOf`, which builds the whole model's graph.
 */
export function isMintable(element: Mintable, model: ConstraintModel): boolean {
  switch (element.kind) {
    case "constraint": {
      const [constraint, host] = element.inView;
      const resolves = references(constraint).every((ref) => {
        if (ref.kind === "objectType") return model.getObjectType(ref.id) !== undefined;
        if (ref.kind === "subtypeFact") {
          const sf = model.getSubtypeFact(ref.id);
          return sf !== undefined && model.getObjectType(sf.subtypeId) !== undefined
            && model.getObjectType(sf.supertypeId) !== undefined;
        }
        const holders = model.factTypesHolding([ref.id]);
        if (holders.length !== 1 || (host !== undefined && holders[0] !== host)) return false;
        // The sentence names every player of the role's fact type; one that
        // dangles would read as its role name.
        return holders[0]!.roles.every((r) => model.getObjectType(r.playerId) !== undefined);
      });
      return resolves && sentenceHolds(constraint, model);
    }
    case "subtypeFact": {
      const sf = element.subtypeFact;
      return model.getObjectType(sf.subtypeId) !== undefined
        && model.getObjectType(sf.supertypeId) !== undefined;
    }
    case "objectification": {
      const o = element.objectification;
      const ft = model.getFactType(o.factTypeId);
      return ft !== undefined && model.getObjectType(o.objectTypeId) !== undefined
        && ft.roles.every((r) => model.getObjectType(r.playerId) !== undefined);
    }
  }
}

function sentence(element: Mintable, model: ConstraintModel): string {
  switch (element.kind) {
    case "constraint": {
      const [constraint, host] = element.inView;
      return host === undefined
        ? verbalizer.verbalizeExternal(constraint, model).text
        : verbalizer.verbalize(constraint, host, model).text;
    }
    case "subtypeFact":
      return verbalizeSubtypeFact(element.subtypeFact, model).text;
    case "objectification":
      return verbalizeObjectifiedFactType(element.objectification, model).text;
  }
}

/** A fact type as sentences name it: its name, readings, and players. */
function factTypeKey(ft: FactType, model: ConstraintModel): unknown {
  return {
    name: ft.name,
    readings: ft.readings.map((r) => r.template),
    players: ft.roles.map((r) => model.getObjectType(r.playerId)?.name ?? null),
  };
}

export type Reference =
  | { readonly kind: "role"; readonly id: string; }
  | { readonly kind: "subtypeFact"; readonly id: string; }
  | { readonly kind: "objectType"; readonly id: string; };

/** The serialized fields that name a role, one or a list. */
const ROLE_FIELDS = new Set([
  "role",
  "roles",
  "role_1",
  "role_2",
  "roles_1",
  "roles_2",
  "subset_roles",
  "superset_roles",
]);
/** The serialized fields that hold a join operand, one or a list. */
const OPERAND_FIELDS = new Set(["subset", "superset", "operand", "operands"]);
/** The serialized fields that say something and name nothing. */
const STATED_FIELDS = new Set([
  "type",
  "min",
  "max",
  "ring_type",
  "operator",
  "values",
  "ranges",
  "modality",
]);
/**
 * Fields left out of the key: the id, which the name replaces. (A 2.0
 * file's `is_preferred` is never written by the 3.0 serializer; were it,
 * the walk would refuse it, and whether a preferred identifier belongs in
 * the key would be decided then, not by default.)
 */
const DROPPED_FIELDS = new Set(["id"]);

/**
 * Walk the constraint's serialized form, field by field. A field this
 * walk does not know is an error, not a pass: a constraint kind added
 * later must say which of its fields are references, or its key would
 * carry raw ids and every import would read its name as stale.
 */
function walk(
  constraint: Parameters<typeof serializeConstraint>[0],
  onRef: (ref: Reference) => unknown,
): Record<string, unknown> {
  const form = serializeConstraint(constraint) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(form)) {
    if (DROPPED_FIELDS.has(field)) continue;
    if (STATED_FIELDS.has(field)) out[field] = value;
    else if (ROLE_FIELDS.has(field)) {
      out[field] = Array.isArray(value)
        ? value.map((id: string) => onRef({ kind: "role", id }))
        : onRef({ kind: "role", id: value as string });
    } else if (field === "subtype_facts") {
      out[field] = (value as string[]).map((id) => onRef({ kind: "subtypeFact", id }));
    } else if (OPERAND_FIELDS.has(field)) {
      const operand = (
        o: {
          path: { root: string; steps: { entry: string; exit: string; }[]; };
          projection: number[];
        },
      ) => ({
        root: onRef({ kind: "objectType", id: o.path.root }),
        steps: o.path.steps.map((s) => [
          onRef({ kind: "role", id: s.entry }),
          onRef({ kind: "role", id: s.exit }),
        ]),
        projection: o.projection,
      });
      out[field] = Array.isArray(value) ? value.map(operand) : operand(value as never);
    } else {
      throw new Error(
        `mint: constraint field "${field}" is not classified as a reference or a statement.`,
      );
    }
  }
  return out;
}

/**
 * The constraint's serialized form with every reference it holds replaced
 * by `onRef`'s answer, in the same shape, its id kept: for a caller that
 * rewrites ids (the 3.x replay into 4.0). Reads the same field sets as
 * `walk`, and refuses a field neither classifies, as `walk` does, so a
 * kind added later cannot slip through with its references unmapped.
 */
export function mapConstraintReferences(
  constraint: Parameters<typeof serializeConstraint>[0],
  onRef: (ref: Reference) => string,
): Record<string, unknown> {
  const form = serializeConstraint(constraint) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(form)) {
    if (DROPPED_FIELDS.has(field) || STATED_FIELDS.has(field)) out[field] = value;
    else if (ROLE_FIELDS.has(field)) {
      out[field] = Array.isArray(value)
        ? value.map((id: string) => onRef({ kind: "role", id }))
        : onRef({ kind: "role", id: value as string });
    } else if (field === "subtype_facts") {
      out[field] = (value as string[]).map((id) => onRef({ kind: "subtypeFact", id }));
    } else if (OPERAND_FIELDS.has(field)) {
      const operand = (
        o: {
          path: { root: string; steps: { entry: string; exit: string; }[]; };
          projection: number[];
        },
      ) => ({
        path: {
          root: onRef({ kind: "objectType", id: o.path.root }),
          steps: o.path.steps.map((st) => ({
            entry: onRef({ kind: "role", id: st.entry }),
            exit: onRef({ kind: "role", id: st.exit }),
          })),
        },
        projection: o.projection,
      });
      out[field] = Array.isArray(value) ? value.map(operand) : operand(value as never);
    } else {
      throw new Error(
        `mint: constraint field "${field}" is not classified as a reference or a statement.`,
      );
    }
  }
  return out;
}

function references(constraint: Parameters<typeof serializeConstraint>[0]): Reference[] {
  const refs: Reference[] = [];
  walk(constraint, (ref) => refs.push(ref));
  return refs;
}

function constraintKey(
  constraint: ConstraintInView[0],
  model: ConstraintModel,
): Record<string, unknown> {
  return walk(constraint, (ref) => {
    switch (ref.kind) {
      case "objectType":
        return model.getObjectType(ref.id)!.name;
      case "subtypeFact": {
        const sf = model.getSubtypeFact(ref.id)!;
        return [model.getObjectType(sf.subtypeId)!.name, model.getObjectType(sf.supertypeId)!.name];
      }
      case "role": {
        const ft = model.factTypesHolding([ref.id])[0]!;
        const at = ft.roles.findIndex((r) => r.id === ref.id);
        return [at, ft.roles[at]!.name, factTypeKey(ft, model)];
      }
    }
  });
}
