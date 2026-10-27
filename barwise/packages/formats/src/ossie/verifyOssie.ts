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
  type ConstraintSpec,
  type ExternalConstraint,
  type OrmModel,
  OrmYamlSerializer,
  writeDocument,
} from "@barwise/core";
import { buildConstraintSpec } from "@barwise/core/annotation";
import { deltaLabel, diffModels, type ModelDelta } from "@barwise/core/diff";
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
 * through the Ossie importer, and report what `reported` (the keys of the
 * writer's own loss lines) does not already cover.
 */
export function verifyOssie(
  source: OrmModel,
  back: OrmModel,
  written: OssieCorrespondence,
  reported: ReadonlySet<string>,
): OssieVerifyResult {
  const aligned = align(source, back, written);
  const losses: string[] = [];
  const specs: ConstraintSpec[] = [];
  const verbalizer = new ConstraintVerbalizer();
  for (const delta of diffModels(source, aligned).deltas) {
    if (delta.kind === "unchanged") continue;
    const key = sourceKey(delta);
    if (key !== undefined && reported.has(key)) continue;
    losses.push(line(delta));
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
 * draft against its base.
 */
function align(source: OrmModel, back: OrmModel, written: OssieCorrespondence): OrmModel {
  const ids = new Map<string, string>();
  const byConcept = new Map<string, string>();
  for (const [id, name] of written.conceptNames) byConcept.set(name, id);
  for (const ot of back.objectTypes) {
    const id = byConcept.get(ot.name);
    if (id !== undefined) ids.set(ot.id, id);
  }

  const doc = writeDocument(back);
  for (const ftDoc of doc.model.fact_types ?? []) {
    const w = written.factTypes.find((x) => x.importedName === ftDoc.name);
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

  // Every minted id is a UUID that occurs only where the model refers to
  // its element, so replacing it over the text reaches every reference
  // without a list of the fields that hold one.
  let text = stringify(doc);
  for (const [minted, sourceId] of ids) text = text.split(minted).join(sourceId);
  return new OrmYamlSerializer().deserialize(text);
}

/** The key of a delta's source side, as `lossKey` spells it; none for an added element. */
function sourceKey(delta: ModelDelta): string | undefined {
  if (delta.kind === "added") return undefined;
  if (delta.elementType === "definition") return lossKey({ kind: "definition", id: delta.term });
  const id = delta.existing?.id;
  if (id === undefined) return undefined;
  const kind = delta.elementType === "objectified_fact_type"
    ? "objectification"
    : delta.elementType;
  return lossKey({ kind, id });
}

function line(delta: ModelDelta): string {
  const label = deltaLabel(delta);
  const text = delta.kind === "removed"
    ? `${label}: does not come back`
    : delta.kind === "added"
    ? `${label}: comes back added, though the model does not have it`
    : `${label}: comes back changed: ${delta.changeDescriptions.join("; ")}`;
  return text.replace(/\s+/g, " ").trim();
}
