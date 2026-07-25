#!/usr/bin/env node
// Regenerate the committed tutorial(s) under docs/tutorial/ from their
// sources in packages/learn/tutorials/ -- the regen:examples discipline
// applied to the narrated sequence (modeling-tutorial spec, WS1). A
// drift test in @barwise/learn fails CI when the committed output does
// not match a fresh render.
//
// Usage: npm run regen:tutorial   (requires `npm run build` first)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const learnDist = join(root, "packages/learn/dist/index.js");

let learn;
try {
  learn = await import(learnDist);
} catch {
  console.error("error: packages/learn/dist not found; run 'npm run build' first");
  process.exit(1);
}

const { version } = JSON.parse(
  readFileSync(join(root, "packages/learn/package.json"), "utf-8"),
);

const TUTORIALS = [
  {
    source: "packages/learn/tutorials/order-fulfillment/order-fulfillment.tutorial.yaml",
    output: "docs/tutorial/order-fulfillment.md",
  },
];

mkdirSync(join(root, "docs/tutorial"), { recursive: true });
for (const { source, output } of TUTORIALS) {
  const tutorial = learn.loadTutorial(join(root, source));
  const markdown = learn.renderTutorial(tutorial, { toolVersion: version });
  writeFileSync(join(root, output), markdown, "utf-8");
  console.log(`wrote ${output}`);
}
