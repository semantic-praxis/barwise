/**
 * The Ossie export's check on its own loss report
 * (`docs/specs/ossie-export-verified-by-reimport.spec.md`).
 *
 * `writeOssie` predicts, construct by construct, what the importer reads
 * back, and three review rounds each found a prediction that was wrong.
 * This asks the importer instead: the written document, read back, is
 * aligned to the source and compared with `diffModels`, and every element
 * that comes back different with no loss line naming it gets one. A
 * prediction can drift from `mapOssieToOrm`; this cannot.
 */
import {
  type Constraint,
  constraintRef,
  type ConstraintSpec,
  type ExternalConstraint,
  type OrmModel,
  OrmYamlSerializer,
  type writeDocument,
  writeDocument40,
} from "@barwise/core";

/** A 3.0 document, as the 3.0 writer types it. */
type OrmYamlDocument = ReturnType<typeof writeDocument>;
import { buildConstraintSpec } from "@barwise/core/annotation";
import { type ChangeKind, deltaLabel, diffModels, type ModelDelta } from "@barwise/core/diff";
import { remapIds } from "@barwise/core/rename";
import { ConstraintVerbalizer } from "@barwise/core/verbalization";
import { stringify } from "yaml";
import { lossKey, type OssieCorrespondence } from "./writeOssie.js";

export interface OssieVerifyResult {
  /** One line per element that comes back different, unreported before. */
  readonly losses: readonly string[];
  readonly constraintSpecs: readonly ConstraintSpec[];
}

/**
 * Compare `source` with `back`, the document the export wrote read back
 * through the Ossie importer, and report what `covers` (what the writer's
 * own loss lines explain, by element) does not already cover. A line that
 * names the changes it explains covers only those, so a modified element
 * is reported with whatever changes remain.
 */
export function verifyOssie(
  source: OrmModel,
  back: OrmModel,
  written: OssieCorrespondence,
  covers: ReadonlyMap<string, ReadonlySet<ChangeKind> | "all">,
): OssieVerifyResult {
  const aligned = align(source, back, written);
  const losses: string[] = [];
  const specs: ConstraintSpec[] = [];
  const verbalizer = new ConstraintVerbalizer();
  // No rename recognition: `align` already gives the read-back model the
  // source's ids, so a pair the content pass would add is a real loss to
  // report, not a rename.
  for (const delta of diffModels(source, aligned, { recognizeRenames: false }).deltas) {
    if (delta.kind === "unchanged") continue;
    const key = sourceKey(delta);
    const covered = key === undefined ? undefined : covers.get(key);
    if (covered === "all") continue;
    let changes = delta.changeDescriptions;
    // A scoped line explains changes, never an element that does not come
    // back or comes back added; but a header part has no element, and its
    // not coming back is the change a line predicts.
    if (
      covered !== undefined && (delta.kind === "modified" || delta.elementType === "model_header")
    ) {
      changes = delta.changeDescriptions.filter((_, i) => !covered.has(delta.changes[i]!.change));
      if (changes.length === 0) continue;
    }
    losses.push(line(delta, changes));
    if (delta.kind === "removed" && delta.elementType === "constraint" && delta.existing) {
      specs.push(
        buildConstraintSpec([delta.existing as ExternalConstraint, undefined], source, verbalizer),
      );
    }
  }
  return { losses, constraintSpecs: specs };
}

/**
 * The read-back model with the source's ids, names, role names and role
 * order wherever the writer says which source element it came from, so
 * that `diffModels` pairs them by id and anything it reports is a real
 * difference. Elements with no source id (constraints, subtype facts) keep
 * their minted ids; the diff pairs those by content, as it pairs an LLM
 * draft against its base. Exported so the property test over generated
 * models (`OssieNothingLost.property.test.ts`) aligns the way the verifier
 * does and compares what it finds by a different oracle.
 */
export function align(source: OrmModel, back: OrmModel, written: OssieCorrespondence): OrmModel {
  const ids = new Map<string, string>();
  const byConcept = new Map<string, string>();
  for (const [id, name] of written.conceptNames) byConcept.set(name, id);
  for (const ot of back.objectTypes) {
    const id = byConcept.get(ot.name);
    if (id !== undefined) ids.set(ot.id, id);
  }

  const byImportedName = new Map(written.factTypes.map((w) => [w.importedName, w]));
  const doc = document30(back);
  for (const ftDoc of doc.model.fact_types ?? []) {
    const w = byImportedName.get(ftDoc.name);
    const src = w && source.getFactType(w.id);
    if (!w || !src || ftDoc.roles.length !== w.order.length) continue;
    ids.set(ftDoc.id, src.id);
    // Written position p holds source role order[p]; put each back.
    const roles = new Array<(typeof ftDoc.roles)[number]>(w.order.length);
    w.order.forEach((sourceIndex, p) => {
      const role = ftDoc.roles[p]!;
      const sourceRole = src.roles[sourceIndex]!;
      ids.set(role.id, sourceRole.id);
      roles[sourceIndex] = { ...role, role_name: sourceRole.name };
    });
    ftDoc.roles = roles;
    ftDoc.readings = ftDoc.readings.map((t) =>
      t.replace(/\{(\d+)\}/g, (_, p: string) => `{${w.order[Number(p)]}}`)
    );
    ftDoc.name = src.name;
  }

  // The ids go through the model, not the document's strings: in format 4.0
  // an id is its element's name (decision 13), so replacing every string
  // equal to one rewrote names and readings too, which replacing UUIDs
  // never could (iri-identity 6b-4b). Read as written first: the point is
  // the source's ids, which a load would replay into 4.0's, and a model
  // built in code may hold ids 4.0 refuses.
  // Across kinds as a 3.x model allows: a source built in code may give an
  // object type and a fact type one id, and an element only the read-back
  // holds (a constraint it named from its sentence) may hold an id a source
  // element of another kind does, now that ids are names. Within one kind
  // the read-back holds only what maps to the source, so none collides.
  const aligned = remapIds(new OrmYamlSerializer().deserializeAsWritten(stringify(doc)), ids, {
    idsAcrossKinds: false,
  });
  // 3.0 has no imports, so `document30` left them out; they are the
  // read-back's, and the header deltas compare them.
  for (const [alias, target] of back.imports) aligned.setImport(alias, target);
  return aligned;
}

/**
 * `back` as a 3.0 document, the intermediate `align` edits and reads back
 * as written. The 4.0 writer's, which has 3.0's layout, without the keys
 * minted ids were minted from, and with a placeholder id on each element
 * the model left unnamed (iri-identity decision 19): 3.0 states every id,
 * and the diff pairs such an element by content, as it did the generated
 * id a model gave it before format 4.0.
 */
function document30(back: OrmModel): OrmYamlDocument {
  const doc = writeDocument40(back) as unknown as {
    orm_version: string;
    model: Record<string, unknown>;
  };
  let n = 0;
  const fill = (elements: unknown) => {
    for (const e of (elements ?? []) as Record<string, unknown>[]) {
      delete e["minted_from"];
      e["id"] ??= `unnamed.${++n}`;
    }
  };
  for (const ft of (doc.model["fact_types"] ?? []) as Record<string, unknown>[]) {
    fill(ft["constraints"]);
  }
  fill(doc.model["constraints"]);
  fill(doc.model["subtype_facts"]);
  fill(doc.model["objectified_fact_types"]);
  delete doc.model["imports"];
  doc.orm_version = "3.0";
  return doc as unknown as OrmYamlDocument;
}

/** The key of a delta's source side, as `lossKey` spells it; none for an added element. */
function sourceKey(delta: ModelDelta): string | undefined {
  if (delta.kind === "added") return undefined;
  if (delta.elementType === "definition") return lossKey({ kind: "definition", id: delta.term });
  // The model's header is predicted under its own key, per change kind.
  if (delta.elementType === "model_header") return lossKey({ kind: "model_header" });
  // An unnamed constraint's key is its reference, as `writeOssie` keys it.
  const id = delta.elementType === "constraint" && delta.existing
    ? constraintRef(delta.existing as Constraint)
    : delta.existing?.id;
  return id === undefined ? undefined : lossKey({ kind: delta.elementType, id });
}

function line(delta: ModelDelta, changes: readonly string[]): string {
  const label = deltaLabel(delta);
  const text = delta.kind === "removed"
    ? `${label}: does not come back`
    : delta.kind === "added"
    ? `${label}: comes back added, though the model does not have it`
    : `${label}: comes back changed: ${changes.join("; ")}`;
  return text.replace(/\s+/g, " ").trim();
}
