#!/usr/bin/env node
/**
 * Which sample `computeSampleAgreement` picks per eval case, treating every
 * recorded payload of a case under `eval-payloads/` as one sample of it.
 *
 * Written for orm-format-3 WS3c, which gave constraints across fact types
 * a diff delta of their own and so changed what `differenceCount` counts
 * (the spec's "3c's PR measures this on the promptlab suite"). The
 * comparison is two runs of this script: one against an llm build of the
 * base commit, one against the change.
 *
 *   npm run measure:sample-medoids -- <llm dist dir> [payload dir]
 *
 * Prints one JSON object keyed by case: samples, the medoid's index and the
 * payload it came from, the number of disagreements and of stable elements.
 * A payload that does not parse is skipped, so the sample count is part of
 * the answer. A case's samples are every recorded run of it, across arms,
 * models and dates: a coarse sample, but the same one on both sides of the
 * comparison, which is what the comparison asks of it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [llmDist, payloadRoot = path.join(import.meta.dirname, "..", "eval-payloads")] = process
  .argv.slice(2);
if (!llmDist) {
  console.error("usage: measure-sample-medoids.mjs <llm dist dir> [payload dir]");
  process.exit(2);
}
const { parseDraftModel, computeSampleAgreement } = await import(
  pathToFileURL(path.join(path.resolve(llmDist), "index.js")).href
);

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (p.endsWith(".json")) files.push(p);
  }
};
walk(payloadRoot);
files.sort();

const byCase = new Map();
for (const f of files) {
  const name = path.basename(f).replace(/-run\d+\.json$/, "");
  if (!byCase.has(name)) byCase.set(name, []);
  byCase.get(name).push(f);
}

const report = {};
for (const [name, paths] of [...byCase].sort(([a], [b]) => a.localeCompare(b))) {
  const models = [];
  const used = [];
  for (const p of paths) {
    try {
      models.push(parseDraftModel(JSON.parse(fs.readFileSync(p, "utf8")), name).model);
      used.push(path.relative(payloadRoot, p));
    } catch {
      // Skipped: the sample count reports it.
    }
  }
  if (models.length < 2) continue;
  const agreement = computeSampleAgreement(models);
  report[name] = {
    samples: models.length,
    medoid: agreement.medoidIndex,
    medoidPayload: used[agreement.medoidIndex],
    disagreements: agreement.disagreements.length,
    stable: agreement.stable,
  };
}
console.log(JSON.stringify(report, null, 2));
