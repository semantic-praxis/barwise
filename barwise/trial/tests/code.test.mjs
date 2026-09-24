/**
 * The code generator must render every role of every fact type. It kept
 * only the first two (`const [r0, r1] = ft.roles`), so a ternary lost
 * its third role and an objectified fact type reached the repo with no
 * roles at all -- and the lane graded the importers on input the harness
 * never wrote (barwise-kt7). Checked over every customer kernel, since
 * each has both shapes.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { generateCode } from "../lib/generators/code.mjs";

const customersDir = new URL("../customers/", import.meta.url);
const kernels = readdirSync(customersDir).filter((d) => /^C\d+/.test(d));

// A field declaration in the TypeScript the generator writes:
// `  name: Type;` or `  name?: Type[];`.
const fieldsOf = (src) =>
  [...src.matchAll(/^ {2}(\w+)\??: ([\w]+)(\[\])?;$/gm)].map((m) => ({ name: m[1], type: m[2] }));

for (const customer of kernels) {
  test(`${customer}: every role of every fact type reaches the generated code`, () => {
    const doc = parse(readFileSync(new URL(`${customer}/kernel.orm.yaml`, customersDir), "utf8"));
    const dir = mkdtempSync(join(tmpdir(), "trial-code-"));
    try {
      generateCode(doc, { language: "typescript" }, dir);
      const pkg = join(dir, "src", "main", "com", "trial", "domain");
      const classes = new Map(
        readdirSync(pkg).map((
          f,
        ) => [f.replace(/\.ts$/, ""), fieldsOf(readFileSync(join(pkg, f), "utf8"))]),
      );
      const ids = new Map(doc.model.object_types.map((o) => [o.id, o]));
      const objectifier = new Map(
        (doc.model.objectified_fact_types ?? []).map((
          o,
        ) => [o.fact_type, ids.get(o.object_type).name]),
      );
      for (const ft of doc.model.fact_types) {
        if (ft.roles.length < 2) continue;
        const players = ft.roles.map((r) => ids.get(r.player)).filter(Boolean);
        if (ft.roles.length === 2 && !objectifier.has(ft.id)) {
          // A binary is a field on its first player's class naming the second.
          const [a, b] = players;
          const on = classes.get(a.name) ?? [];
          if (a.kind === "entity") {
            assert.ok(
              on.some((f) =>
                f.name
                  === b.name.charAt(0).toLowerCase() + b.name.slice(1).replace(/[^A-Za-z0-9]/g, "")
              ),
              `${ft.name}: ${a.name} has no field for ${b.name}`,
            );
          }
          continue;
        }
        // Anything else is a class holding one field per role.
        const holder = objectifier.get(ft.id)
          ?? ft.name.split(/[^A-Za-z0-9]+/).filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
        const on = classes.get(holder);
        assert.ok(on, `${ft.name}: no class ${holder}`);
        // Each entity role is a field typed as its player; a value role's type
        // is a scalar the kernel does not name, so it is counted, not matched.
        for (const p of players.filter((p) => p.kind === "entity")) {
          const want = players.filter((q) => q === p).length;
          const got = on.filter((f) => f.type === p.name).length;
          assert.ok(
            got >= want,
            `${ft.name}: ${holder} has ${got} field(s) typed ${p.name}, needs ${want}`,
          );
        }
        const valueRoles = players.filter((p) => p.kind !== "entity").length;
        const entityTypes = new Set(players.filter((p) => p.kind === "entity").map((p) => p.name));
        assert.ok(
          on.filter((f) => !entityTypes.has(f.type)).length >= valueRoles,
          `${ft.name}: ${holder} has too few fields for its ${valueRoles} value role(s)`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
