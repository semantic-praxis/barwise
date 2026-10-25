/**
 * The tracked models that use ORM hyphen binding verbalize without the
 * hyphen (reading-hyphen-binding.spec.md). A standing check, not a one-off
 * diff: every reader that renders a reading goes through `splitReading`,
 * and a reader that slices the template itself again prints "has sale-",
 * which fails here on real models rather than only on a fixture.
 *
 * "Binding hyphen" is the parser's own definition -- a hyphen after a
 * letter or digit, followed by whitespace or the end -- so the check and
 * the parser cannot disagree about what counts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitReading } from "../../src/model/ReadingOrder.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";

const repoRoot = resolve(__dirname, "../../../..");
const SCANNED = ["docs", "examples", "packages/promptlab/evals"];
const BINDING_HYPHEN = /[A-Za-z0-9]-(?=\s|$)/;

function ormFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ormFiles(path);
    return name.endsWith(".orm.yaml") ? [path] : [];
  });
}

const models = SCANNED.flatMap((dir) => ormFiles(join(repoRoot, dir))).flatMap((path) => {
  try {
    const model = new OrmYamlSerializer().deserialize(readFileSync(path, "utf8"));
    const templates = model.factTypes.flatMap((ft) => ft.readings.map((r) => r.template));
    return templates.some((t) => BINDING_HYPHEN.test(t))
      ? [{ name: relative(repoRoot, path), model, templates }]
      : [];
  } catch {
    // A file that does not load (a deliberately broken fixture) has no
    // verbalization to check.
    return [];
  }
});

describe("tracked models that use hyphen binding", () => {
  it("exist, so this check is checking something", () => {
    expect(models.map((m) => m.name)).toContain("docs/auction.orm.yaml");
  });

  it.each(models.map((m) => [m.name, m] as const))("%s binds every hyphen it writes", (_, m) => {
    expect(m.templates.filter((t) => splitReading(t).unbound)).toEqual([]);
  });

  it.each(models.map((m) => [m.name, m] as const))("%s verbalizes with no hyphen left", (_, m) => {
    const lines = new Verbalizer().verbalizeModel(m.model).map((v) => v.text);
    expect(lines.filter((line) => BINDING_HYPHEN.test(line))).toEqual([]);
  });
});
