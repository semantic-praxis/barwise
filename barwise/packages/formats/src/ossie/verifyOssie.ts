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
import { type ChangeKind, lossKey, type OssieCorrespondence } from "./writeOssie.js";

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
  for (const delta of diffModels(source, aligned).deltas) {
    if (delta.kind === "unchanged") continue;
    const key = sourceKey(delta);
    const covered = key === undefined ? undefined : covers.get(key);
    if (covered === "all") continue;
    let changes = delta.changeDescriptions;
    if (covered !== undefined) {
      // A scoped line explains changes, never an element that does not come
      // back or comes back added.
      if (delta.kind === "modified" && "changes" in delta) {
        changes = delta.changeDescriptions.filter((_, i) => !covered.has(delta.changes[i]!.change));
        if (changes.length === 0) continue;
      }
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

  const byImportedName = new Map(written.factTypes.map((w) => [w.importedName, w]));
  const doc = writeDocument(back);
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

  // An id is a whole string, as a value or a key, wherever the document
  // refers to its element, so replacing every string equal to a minted id
  // reaches each reference without a list of the fields that hold one. Done on the
  // document, not its text: a minted id may be a prefix of another, and a
  // source id may need quoting in YAML ("1", "true").
  return new OrmYamlSerializer().deserialize(stringify(reId(doc, ids)));
}

function reId(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => reId(v, ids));
  if (value !== null && typeof value === "object") {
    // Keys too: a population's role values are keyed by role id.
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [ids.get(k) ?? k, reId(v, ids)]),
    );
  }
  return value;
}

/** The key of a delta's source side, as `lossKey` spells it; none for an added element. */
function sourceKey(delta: ModelDelta): string | undefined {
  if (delta.kind === "added") return undefined;
  if (delta.elementType === "definition") return lossKey({ kind: "definition", id: delta.term });
  const id = delta.existing?.id;
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
