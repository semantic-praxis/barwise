#!/usr/bin/env node
/**
 * Measure the relational mapper's key-type fallback over every tracked
 * .orm.yaml in the repository (docs/specs/dbt-key-type-fidelity.spec.md).
 *
 * Usage (after `npm run build`): node packages/core/scripts/refmode-heuristic-audit.mjs
 *
 * For each entity type with no preferred identifying binary, the mapper's
 * `referenceModePkType` takes the data type of the first binary fact type
 * pairing the entity with any value type. This reports how often that
 * value type is the one the reference mode names -- the rule WS2 of the
 * spec adopts, `toSnake(valueType.name) === referenceMode` -- and how
 * often it is an unrelated attribute. `toSnake` is copied from
 * RelationalMapper.ts, where it is not exported; WS2 replaces this
 * script with a mapper test that uses the real one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OrmYamlSerializer } from "../dist/index.js";
import { preferredIdentifyingBinary } from "../dist/model/identification.js";

const toSnake = (name) =>
  name.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: dirname(fileURLToPath(import.meta.url)),
}).toString().trim();
const files = execFileSync("git", ["ls-files", "*.orm.yaml"], { cwd: repoRoot })
  .toString().trim().split("\n").filter(Boolean);

const serializer = new OrmYamlSerializer();
const counts = { files: files.length, loaded: 0, fires: 0, named: 0, unrelated: 0, fallback: 0 };
const unrelated = [];

for (const file of files) {
  let model;
  try {
    model = serializer.deserialize(readFileSync(join(repoRoot, file), "utf8"));
  } catch {
    continue;
  }
  counts.loaded++;
  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity" || preferredIdentifyingBinary(model, ot)) continue;
    let valuePlayer;
    for (const ft of model.factTypes) {
      if (ft.arity !== 2) continue;
      const players = ft.roles.map((r) => model.getObjectType(r.playerId));
      const own = players.findIndex((p) => p?.id === ot.id);
      if (own < 0) continue;
      const other = players[1 - own];
      if (other?.kind === "value") {
        valuePlayer = other;
        break;
      }
    }
    if (!valuePlayer) {
      counts.fallback++;
      continue;
    }
    counts.fires++;
    if (toSnake(valuePlayer.name) === ot.referenceMode) {
      counts.named++;
    } else {
      counts.unrelated++;
      unrelated.push(`${file}: ${ot.name}(${ot.referenceMode}) <- ${valuePlayer.name}`);
    }
  }
}

console.log(JSON.stringify(counts, null, 2));
for (const line of unrelated) console.log(line);
