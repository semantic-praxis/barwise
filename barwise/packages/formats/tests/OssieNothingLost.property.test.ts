/**
 * The Ossie export loses nothing silently, over generated models
 * (`docs/adr/ossie-interchange.md#nothing-lost-silently`;
 * `docs/specs/adr-batch9-enforcers.spec.md`, WS8).
 *
 * The example and the unit cases hold the constructs their authors thought
 * of. This takes core's model arbitrary, exports each model, reads the
 * document back through the importer, and for every element whose
 * serialized form differs between the source and the read-back model
 * requires a loss line that names it.
 *
 * THE ORACLE IS SERIALIZED YAML, NOT `diffModels`. `verifyOssie` finds its
 * lines with `diffModels`, so a field the diff does not compare (a model's
 * note and domain context, a population, a diagram) is a field the
 * verifier cannot see; an oracle built on the same diff would share that
 * blind spot and pass. Here each element's 4.0 document entry, with the
 * ids that are minted rather than stated removed, is compared as text.
 *
 * What the oracle shares with the exporter, and so cannot check: the
 * alignment of the read-back model to the source ids (`align`, which
 * restores the role order and role names the writer changes on purpose).
 * A difference that alignment hides is a difference the export has decided
 * is not a loss.
 *
 * "Names it" is by element: a line that mentions the fact type's name
 * covers every difference on that fact type. That is coarse, and the
 * coarseness is why the self-check below exists: the property would pass
 * a corpus whose every fact type is already named by some unrelated line.
 */
import {
  type Constraint,
  constraintRef,
  objectificationRef,
  type ObjectifiedFactType,
  type OrmModel,
  writeDocument40,
} from "@barwise/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { arbOrmModel, RUNS, SEED } from "../../core/tests/arbitraries/model.js";
import { OssieExportFormat } from "../src/ossie/OssieExportFormat.js";
import { OssieImportFormat } from "../src/ossie/OssieImportFormat.js";
import { align } from "../src/ossie/verifyOssie.js";
import { writeOssie } from "../src/ossie/writeOssie.js";

/** 250 exports, each read back and compared, is not a fixture test. */
const TIMEOUT_MS = 120_000;

const exporter = new OssieExportFormat();

/** The loss lines of an export's text, without the block's heading. */
function lossLines(text: string): string[] {
  const heading = "# barwise: what this document could not carry from the model:";
  return text.split("\n")
    .filter((l) => l.startsWith("# barwise: ") && l !== heading)
    .map((l) => l.slice("# barwise: ".length));
}

type Json = Record<string, unknown>;

/** The model as its 4.0 document's `model` entry. */
const modelEntry = (m: OrmModel): Json => (writeDocument40(m) as unknown as { model: Json; }).model;

const list = (entry: Json, key: string): Json[] => (entry[key] ?? []) as Json[];

/**
 * An element's comparable text. A constraint, a subtype fact and an
 * objectification the model left unnamed get an id minted from a sentence
 * in the importer, so `id` and `minted_from` are dropped from those; an
 * object type's, a fact type's and a role's ids are compared, because
 * `align` gives the read-back the source's.
 */
function comparable(e: Json, dropId: boolean): string {
  const strip = (v: unknown, drop: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => strip(x, drop));
    if (v === null || typeof v !== "object") return v;
    const out: Json = {};
    for (const [k, x] of Object.entries(v as Json)) {
      if (k === "minted_from" || (drop && k === "id")) continue;
      out[k] = k === "constraints" ? stripConstraints(x) : strip(x, drop);
    }
    return out;
  };
  const stripConstraints = (v: unknown): unknown =>
    (v as Json[]).map((c) => stringify(strip(c, true), { sortMapEntries: true })).sort();
  return stringify(strip(e, dropId), { sortMapEntries: true });
}

/** `token` as a whole name in `line`: `T1` is not in `T10`, nor `F0` in `F0.x`'s sibling. */
function mentions(line: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.%<])${escaped}(?![\\w])`).test(line);
}

/** One source element whose text did not come back, and the words a line naming it would hold. */
interface Differs {
  readonly what: string;
  readonly named: (line: string) => boolean;
}

/**
 * Every source element whose serialized form has no equal in the aligned
 * read-back. Elements without a stable id are matched as a multiset, so
 * two equal constraints need two equal constraints back.
 */
function differences(source: OrmModel, back: OrmModel): Differs[] {
  const s = modelEntry(source);
  const b = modelEntry(back);
  const out: Differs[] = [];

  const byKey = (
    kind: string,
    key: string,
    id: (e: Json) => string,
    elements: readonly unknown[],
    named: (i: number) => (line: string) => boolean,
  ) => {
    const there = new Map(list(b, key).map((e) => [id(e), comparable(e, false)]));
    list(s, key).forEach((e, i) => {
      if (there.get(id(e)) !== comparable(e, false)) {
        out.push({ what: `${kind} ${id(e)}`, named: named(i) });
      }
    });
    void elements;
  };
  const byContent = (
    kind: string,
    key: string,
    named: (i: number) => (line: string) => boolean,
  ) => {
    const left = new Map<string, number>();
    for (const e of list(b, key)) {
      const c = comparable(e, true);
      left.set(c, (left.get(c) ?? 0) + 1);
    }
    list(s, key).forEach((e, i) => {
      const c = comparable(e, true);
      const n = left.get(c) ?? 0;
      if (n > 0) left.set(c, n - 1);
      else out.push({ what: `${kind} #${i}`, named: named(i) });
    });
  };

  // The model's own header. A line for it begins `model:`; its name is
  // the caller's and is excluded.
  const header = (m: Json) =>
    stringify({
      domain_context: m["domain_context"],
      namespace: m["namespace"],
      note: m["note"],
      imports: m["imports"],
    }, { sortMapEntries: true });
  if (header(s) !== header(b)) {
    out.push({ what: "model header", named: (l) => l.startsWith("model:") });
  }

  const ots = source.objectTypes;
  byKey(
    "object type",
    "object_types",
    (e) => String(e["id"]),
    ots,
    (i) => (l) => mentions(l, ots[i]!.name),
  );
  const fts = source.factTypes;
  byKey(
    "fact type",
    "fact_types",
    (e) => String(e["id"]),
    fts,
    (i) => (l) => mentions(l, fts[i]!.name),
  );

  const name = (id: string) => source.getObjectType(id)?.name ?? id;
  const cs: readonly Constraint[] = source.constraints;
  byContent("constraint", "constraints", (i) => {
    const c = cs[i]!;
    const kind = c.type.replace(/_/g, " ");
    return (l) =>
      mentions(l, constraintRef(c)) || new RegExp(`${kind}( \\(deontic\\))? over`).test(l);
  });
  const sfs = source.subtypeFacts;
  byContent("subtype fact", "subtype_facts", (i) => {
    const sub = name(sfs[i]!.subtypeId);
    return (l) => mentions(l, sub);
  });
  const ofts: readonly ObjectifiedFactType[] = source.objectifiedFactTypes;
  byContent("objectification", "objectified_fact_types", (i) => {
    const o = ofts[i]!;
    return (l) => mentions(l, objectificationRef(o)) || mentions(l, name(o.objectTypeId));
  });
  const pops = source.populations;
  byKey(
    "population",
    "populations",
    (e) => String(e["id"]),
    pops,
    (i) => (l) => mentions(l, pops[i]!.id),
  );
  const defs = source.definitions;
  byKey(
    "definition",
    "definitions",
    (e) => String(e["term"]),
    defs,
    (i) => (l) => mentions(l, defs[i]!.term),
  );
  const dgs = source.diagramLayouts;
  byKey(
    "diagram",
    "diagrams",
    (e) => String(e["name"]),
    dgs,
    (i) => (l) => mentions(l, dgs[i]!.name),
  );

  return out;
}

/** A deontic mandatory on a fact type's first role: the shape only the read-back names. */
function hasDeonticMandatoryOnFirstRole(m: OrmModel): boolean {
  return m.factTypes.some((ft) =>
    ft.internalConstraints.some((c) =>
      c.type === "mandatory" && c.modality === "deontic" && c.roleId === ft.roles[0]?.id
    )
  );
}

describe("Ossie export: nothing is lost silently, over generated models", () => {
  it(
    "names every element that does not come back as it went [adr:ossie-interchange#nothing-lost-silently]",
    {
      timeout: TIMEOUT_MS,
    },
    () => {
      let models = 0;
      let deonticFirstRole = 0;
      fc.assert(
        fc.property(arbOrmModel(), (model) => {
          models++;
          if (hasDeonticMandatoryOnFirstRole(model)) deonticFirstRole++;

          const text = exporter.export(model).text;
          const lines = lossLines(text);
          const back = new OssieImportFormat().parse(text).model;
          const aligned = align(model, back, writeOssie(model).written);

          const silent = differences(model, aligned)
            .filter((d) => !lines.some(d.named))
            .map((d) => d.what);
          expect(silent, `elements with no loss line\n${lines.join("\n")}`).toEqual([]);
        }),
        { seed: SEED, numRuns: RUNS },
      );

      // The property cannot pass what it cannot tell apart: without a
      // deontic mandatory on a first role the read-back names nothing the
      // writer's own lines do not, and an exporter that stopped reading
      // back would pass.
      expect(models).toBe(RUNS);
      expect(deonticFirstRole, "generated models with a deontic mandatory on a first role")
        .toBeGreaterThan(0);
    },
  );
});
