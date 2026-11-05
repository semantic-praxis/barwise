// Planted violations on the real tree, through the real reader, and timing.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeJudge, compare, modelJudge } from "./judge.mjs";
const { createGovernanceReader } = await import("../../../scripts/lib/adr-facts.mjs");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const dir = join(root, "barwise/docs/adr");
const base = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()
  .map((f) => ({ f: `barwise/docs/adr/${f}`, text: readFileSync(join(dir, f), "utf8") }));
const plant = (name, edit) =>
  base.map((a) => {
    if (!a.f.endsWith(`/${name}.md`)) return a;
    const text = edit(a.text);
    if (text === a.text) throw new Error(`plant on ${name} changed nothing`);
    return { ...a, text };
  });
const cases = {
  "clean real tree": base,
  "a real entry lists an unknown id": plant(
    "connector-packages",
    (t) =>
      t.replace("npm run purity (connector-owns-io", "npm run purity (connector-owns-io, ghost-id"),
  ),
  "a real decision loses both its entries": plant(
    "connector-packages",
    (t) =>
      t.replace("npm run purity (connector-owns-io),\n", "").replace(
        "none (barwise-ym8.iyw: connector-owns-io), ",
        "",
      ),
  ),
  "a real entry cites a closed issue": plant(
    "connector-packages",
    (t) => t.replace("Enforced-by: ", "Enforced-by: none (barwise-ym8.pw0: connector-owns-io), "),
  ),
  "a real entry names an undefined gate": plant(
    "connector-packages",
    (t) =>
      t.replace(
        "npm run purity (connector-owns-io)",
        "npm run check:nonexistent (connector-owns-io)",
      ),
  ),
};
for (const [name, adrs] of Object.entries(cases)) {
  const cl = [];
  const t0 = performance.now();
  const code = codeJudge(
    adrs,
    await createGovernanceReader(root, { needsWorkflow: true, refusals: cl }),
    cl,
  );
  const t1 = performance.now();
  const ml = [];
  const model = modelJudge(
    adrs,
    await createGovernanceReader(root, { needsWorkflow: false, refusals: ml }),
    ml,
  );
  const t2 = performance.now();
  const c = compare(code, model);
  const ok = c.diff.length === 0 && c.refusalDiff.length === 0 && c.refused.length === 0;
  console.log(
    `${name}: ${
      ok ? "AGREE" : "DISAGREE"
    } code=[${code.findings}] model=[${model.findings}] (code ${Math.round(t1 - t0)}ms, model ${
      Math.round(t2 - t1)
    }ms)`,
  );
  for (const x of [...c.diff, ...c.refusalDiff, ...c.refused]) console.log("   " + x);
}
