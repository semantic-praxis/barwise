/**
 * A change storm: the kernel edited step by step per customer.yaml's
 * `history` list, each step committed to a throwaway git repository so
 * `barwise history` and `barwise diff` can be run over a real
 * revision walk. Returns the expected delta per step, which is the
 * oracle's ground truth: a rename must show as a rename candidate, a
 * removal as a removal, an added fact type as an addition.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { byName, factTypes } from "../model.mjs";

export function applyChange(doc, change) {
  const d = structuredClone(doc);
  const names = byName(d);
  const fts = factTypes(d);
  switch (change.kind) {
    case "rename_object_type": {
      const ot = names.get(change.from);
      if (!ot) throw new Error(`history: no object type ${change.from}`);
      ot.name = change.to;
      for (const ft of fts) {
        if (ft.name.includes(change.from)) ft.name = ft.name.split(change.from).join(change.to);
      }
      return { doc: d, expect: { renamed: { from: change.from, to: change.to } } };
    }
    case "rename_fact_type": {
      const ft = fts.find((f) => f.name === change.from);
      if (!ft) throw new Error(`history: no fact type ${change.from}`);
      ft.name = change.to;
      return { doc: d, expect: { renamedFactType: { from: change.from, to: change.to } } };
    }
    case "add_fact_type": {
      const [a, b] = change.between.map((n) => names.get(n));
      if (!a || !b) throw new Error(`history: add_fact_type players missing for ${change.name}`);
      if (fts.some((f) => f.name === change.name)) {
        throw new Error(`history: add_fact_type name already in the model: ${change.name}`);
      }
      const id = `ft-hist-${d.model.fact_types.length + 1}`;
      d.model.fact_types.push({
        id,
        name: change.name,
        roles: [
          { id: `${id}-r0`, player: a.id, role_name: "has" },
          { id: `${id}-r1`, player: b.id, role_name: "is of" },
        ],
        readings: ["{0} has {1}", "{1} is of {0}"],
        constraints: [{ type: "internal_uniqueness", roles: [`${id}-r0`] }],
      });
      return { doc: d, expect: { addedFactType: change.name } };
    }
    case "remove_object_type": {
      const ot = names.get(change.name);
      if (!ot) throw new Error(`history: no object type ${change.name}`);
      const removed = fts.filter((f) => f.roles.some((r) => r.player === ot.id));
      const removedFts = removed.map((f) => f.name);
      const removedIds = new Set(removed.map((f) => f.id));
      d.model.fact_types = fts.filter((f) => !removedIds.has(f.id));
      d.model.object_types = d.model.object_types.filter((o) => o.id !== ot.id);
      if (d.model.subtype_facts) {
        d.model.subtype_facts = d.model.subtype_facts.filter((s) =>
          s.subtype !== ot.id && s.supertype !== ot.id
        );
      }
      if (d.model.objectified_fact_types) {
        d.model.objectified_fact_types = d.model.objectified_fact_types.filter((o) =>
          o.object_type !== ot.id && !removedIds.has(o.fact_type)
        );
      }
      if (d.model.populations) {
        d.model.populations = d.model.populations.filter((p) =>
          d.model.fact_types.some((f) => f.id === p.fact_type)
        );
      }
      return { doc: d, expect: { removedObjectType: change.name, removedFactTypes: removedFts } };
    }
    case "add_value_constraint_value": {
      const ot = names.get(change.object_type);
      if (!ot?.value_constraint?.values) {
        throw new Error(`history: ${change.object_type} has no value constraint`);
      }
      ot.value_constraint.values.push(change.value);
      return { doc: d, expect: { modifiedObjectType: change.object_type } };
    }
    case "tighten_uniqueness": {
      const ft = fts.find((f) => f.name === change.fact_type);
      if (!ft) throw new Error(`history: no fact type ${change.fact_type}`);
      const spanning = (ft.constraints ?? []).find((c) =>
        c.type === "internal_uniqueness" && c.roles.length > 1
      );
      if (!spanning) {
        throw new Error(`history: ${change.fact_type} has no spanning uniqueness to tighten`);
      }
      spanning.roles = [ft.roles[0].id];
      return { doc: d, expect: { modifiedFactType: change.fact_type } };
    }
    case "add_subtype": {
      const sub = names.get(change.subtype);
      const sup = names.get(change.supertype);
      if (!sub || !sup) throw new Error(`history: add_subtype names missing`);
      d.model.subtype_facts = d.model.subtype_facts ?? [];
      if (d.model.subtype_facts.some((s) => s.subtype === sub.id && s.supertype === sup.id)) {
        throw new Error(
          `history: add_subtype already in the model: ${change.subtype} < ${change.supertype}`,
        );
      }
      d.model.subtype_facts.push({
        id: `sf-hist-${d.model.subtype_facts.length + 1}`,
        subtype: sub.id,
        supertype: sup.id,
      });
      return {
        doc: d,
        expect: { addedSubtype: { subtype: change.subtype, supertype: change.supertype } },
      };
    }
    case "add_mandatory": {
      const ft = fts.find((f) => f.name === change.fact_type);
      if (!ft) throw new Error(`history: no fact type ${change.fact_type}`);
      const role = ft.roles[change.role_index ?? 0];
      ft.constraints = ft.constraints ?? [];
      // A duplicate constraint is not a change, and diff is right to say
      // "No changes" about one. Refuse it here so a no-op history step
      // cannot be read as the product missing a delta.
      if (ft.constraints.some((c) => c.type === "mandatory" && c.role === role.id)) {
        throw new Error(
          `history: add_mandatory is a no-op, ${change.fact_type} role ${
            change.role_index ?? 0
          } is already mandatory`,
        );
      }
      ft.constraints.push({ type: "mandatory", role: role.id });
      return { doc: d, expect: { modifiedFactType: change.fact_type } };
    }
    default:
      throw new Error(`history: unknown change kind ${change.kind}`);
  }
}

/** Build the repo; returns the revisions (oldest first) with their expectations. */
export function buildHistoryRepo(doc, changes, dir) {
  mkdirSync(dir, { recursive: true });
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "-q");
  git("config", "user.email", "trial@example.invalid");
  git("config", "user.name", "Trial");
  git("config", "commit.gpgsign", "false");
  const file = join(dir, "model.orm.yaml");
  const steps = [];
  let current = doc;
  writeFileSync(file, stringify(current, { lineWidth: 0 }));
  git("add", "model.orm.yaml");
  git("commit", "-q", "-m", "Initial model", "--no-verify");
  steps.push({ index: 0, change: null, expect: null });
  changes.forEach((change, i) => {
    const { doc: next, expect } = applyChange(current, change);
    current = next;
    writeFileSync(file, stringify(current, { lineWidth: 0 }));
    git("add", "model.orm.yaml");
    git("commit", "-q", "-m", `Change ${i + 1}: ${change.kind}`, "--no-verify");
    steps.push({ index: i + 1, change, expect });
  });
  return { file, steps, finalDoc: current };
}
