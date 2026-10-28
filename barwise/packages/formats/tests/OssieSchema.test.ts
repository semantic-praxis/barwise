/**
 * The run-time Ossie schema (`docs/specs/ossie-unknown-fields.spec.md`):
 * the assumption `unknownOssieFields` rests on, checked against the pinned
 * schemas rather than stated.
 *
 * The importer reads every `additionalProperties` error as an unknown
 * field. Under a union (`oneOf`, `anyOf`, `contains`) ajv discards a
 * branch's errors when the union holds, but keeps every branch's when it
 * fails as a whole, and then a closed branch names fields another branch
 * defines. Errors under `not`, `if` and the like are discarded or kept by
 * rules of their own. Rather than read each keyword's rule, the check is
 * conservative: the pinned schemas reach no closed object from inside any
 * of these, and this fails if a re-pin does, so the importer is changed
 * then instead of warning wrongly. It also fails on
 * `unevaluatedProperties`, which closes an object without an
 * `additionalProperties` error the importer would read.
 */
import { describe, expect, it } from "vitest";
import ontologySchema from "../schemas/ossie/ontology.json" with { type: "json" };
import ossieCoreSchema from "../schemas/ossie/ossie-schema.json" with { type: "json" };
import { OSSIE_CORE_SCHEMA_URL } from "../src/ossie/ossieSchema.js";

type Schema = Record<string, unknown>;

/** Keywords whose subschemas may fail while the document still validates. */
const BRANCHES = new Set([
  "oneOf",
  "anyOf",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
]);

/**
 * Every closed object reachable from `root`, as the chain of keywords that
 * reached it, split by whether a branch was on the way. `$ref` is followed into `root` itself
 * (`#/...`) or into any schema in `external`, keyed by URL.
 */
function closedObjects(
  root: Schema,
  external: Record<string, Schema> = {},
): { all: string[]; underBranch: string[]; } {
  const all: string[] = [];
  const underBranch: string[] = [];
  // A ref target walked once per branch state, by identity: both files
  // define `#/$defs/Relationship`, so the ref string alone would collide.
  const visited = { true: new Set<unknown>(), false: new Set<unknown>() };

  function resolve(ref: string, doc: Schema): [Schema, Schema] {
    const [url, fragment = ""] = ref.split("#");
    const target = url ? external[url] : doc;
    if (!target) throw new Error(`unresolved $ref ${ref}`);
    let at: unknown = target;
    for (const seg of fragment.split("/").filter(Boolean)) at = (at as Schema)[seg];
    return [at as Schema, target];
  }

  function walk(node: unknown, doc: Schema, inBranch: boolean, trail: string): void {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, doc, inBranch, `${trail}[${i}]`));
      return;
    }
    const schema = node as Schema;
    if (schema["additionalProperties"] === false || schema["unevaluatedProperties"] === false) {
      all.push(trail);
      if (inBranch) underBranch.push(trail);
    }
    for (const [k, v] of Object.entries(schema)) {
      if (k === "$ref" && typeof v === "string") {
        const [target, targetDoc] = resolve(v, doc);
        // Once per target, so a cycle through $defs ends.
        if (!visited[`${inBranch}`].has(target)) {
          visited[`${inBranch}`].add(target);
          walk(target, targetDoc, inBranch, `${trail} -> ${v}`);
        }
      } else if (k === "properties" || k === "patternProperties" || k === "dependentSchemas") {
        for (const [p, sub] of Object.entries(v as Schema)) {
          walk(sub, doc, inBranch || BRANCHES.has(k), `${trail}.${k}.${p}`);
        }
      } else if (k !== "$defs" && k !== "enum" && k !== "const" && k !== "examples") {
        walk(v, doc, inBranch || BRANCHES.has(k), `${trail}.${k}`);
      }
    }
  }

  walk(root, root, false, "#");
  return { all, underBranch };
}

describe("the pinned Ossie schemas", () => {
  it("close no object under a branch that may fail", () => {
    const { all, underBranch } = closedObjects(ontologySchema, {
      [OSSIE_CORE_SCHEMA_URL]: ossieCoreSchema,
    });
    expect(underBranch).toEqual([]);
    // The walk reached the closed objects it was asked about: the document,
    // a concept, a relationship and a role, and through `semantic_model`
    // the core schema it refers to by URL.
    expect(all).toEqual(expect.arrayContaining([
      "#",
      "#.properties.ontology.items -> #/$defs/OntologyComponent",
      expect.stringMatching(/-> #\/\$defs\/Relationship$/),
      expect.stringMatching(/-> #\/\$defs\/Role$/),
      expect.stringMatching(/semantic_model -> https:.*ossie-schema\.json$/),
    ]));
  });

  it("close no object with unevaluatedProperties, which the importer does not read", () => {
    for (const schema of [ontologySchema, ossieCoreSchema]) {
      expect(JSON.stringify(schema)).not.toContain("unevaluatedProperties");
    }
  });

  it("the check finds one reached through a $ref under oneOf (so the test above can fail)", () => {
    const planted: Schema = {
      type: "object",
      properties: {
        ai_context: { oneOf: [{ type: "string" }, { $ref: "#/$defs/Closed" }] },
      },
      $defs: { Closed: { type: "object", additionalProperties: false } },
    };
    expect(closedObjects(planted).underBranch).toEqual([
      "#.properties.ai_context.oneOf[1] -> #/$defs/Closed",
    ]);
  });
});
