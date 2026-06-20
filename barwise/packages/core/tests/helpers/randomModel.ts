/**
 * Deterministic, seeded random-model generation for property tests.
 *
 * A small mulberry32 PRNG (no dependency) drives a generator that builds
 * arbitrary but schema-valid OrmModels: entities and value types, binary
 * fact types over them, and a spread of intra-fact-type constraints. The
 * same seed always yields the same model, so a failing property is
 * reproducible from its seed.
 */

import { OrmModel } from "../../src/model/OrmModel.js";

/** A seeded PRNG returning floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a schema-valid OrmModel from a seed: 2-4 entities, 1-3 value
 * types, and 2-5 binary fact types carrying a random spread of intra-
 * fact-type constraints (internal uniqueness, mandatory, value, frequency,
 * ring). No populations -- callers that need them add their own.
 */
export function generateModel(seed: number): OrmModel {
  const rng = makeRng(seed);
  const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

  const model = new OrmModel({ name: `Gen-${seed}` });
  const entities = Array.from(
    { length: int(2, 4) },
    (_, i) => model.addObjectType({ name: `E${i}`, kind: "entity", referenceMode: `e${i}_id` }),
  );
  const values = Array.from(
    { length: int(1, 3) },
    (_, i) => model.addObjectType({ name: `V${i}`, kind: "value" }),
  );
  const objects = [...entities, ...values];
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;

  let roleSeq = 0;
  let conSeq = 0;
  const cid = () => `c${conSeq++}`;
  for (let f = 0; f < int(2, 5); f++) {
    const p1 = pick(objects);
    const p2 = pick(objects);
    const r1 = `r${roleSeq++}`;
    const r2 = `r${roleSeq++}`;
    const ft = model.addFactType({
      name: `F${f}`,
      roles: [
        { name: `plays${r1}`, playerId: p1.id, id: r1 },
        { name: `plays${r2}`, playerId: p2.id, id: r2 },
      ],
      readings: [`{0} f${f} {1}`],
    });
    // Constraints carry explicit ids, as the serializer writes them, so a
    // round-trip is idempotent rather than minting ids on first load.
    if (rng() < 0.6) {
      ft.addConstraint({
        type: "internal_uniqueness",
        id: cid(),
        roleIds: [rng() < 0.5 ? r1 : r2],
      });
    }
    if (rng() < 0.3) ft.addConstraint({ type: "mandatory", id: cid(), roleId: r1 });
    if (rng() < 0.3 && p2.kind === "value") {
      ft.addConstraint({
        type: "value_constraint",
        id: cid(),
        roleId: r2,
        values: ["A", "B", "C"],
      });
    }
    if (rng() < 0.2) {
      ft.addConstraint({ type: "frequency", id: cid(), roleIds: [r1], min: 1, max: int(2, 4) });
    }
    if (rng() < 0.2 && p1.id === p2.id) {
      ft.addConstraint({
        type: "ring",
        id: cid(),
        roleId1: r1,
        roleId2: r2,
        ringType: "irreflexive",
      });
    }
  }
  return model;
}
