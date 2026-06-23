/**
 * Tests for the CLI loadProject helper: the filesystem walk that reads a
 * `.orm-project.yaml` manifest plus every domain and mapping file it
 * references, then hands the contents to core's pure assembler.
 */
import { ProjectLoadError, projectRules } from "@barwise/core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadProject } from "../../src/workspace/projectLoader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(
  __dirname,
  "..",
  "fixtures",
  "project",
  "project.orm-project.yaml",
);

describe("loadProject", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "barwise-project-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("resolves the manifest, domains, and mappings", () => {
    const { project, problems } = loadProject(manifestPath);

    expect(problems).toEqual([]);
    expect(project.name).toBe("Data Warehouse Semantic Model");
    expect(project.domains).toHaveLength(2);
    expect(project.mappings).toHaveLength(1);
  });

  it("attaches a loaded model to each domain", () => {
    const { project } = loadProject(manifestPath);

    for (const domain of project.domains) {
      expect(domain.model).toBeDefined();
    }
    expect(project.getDomain("crm")?.model?.name).toBe("CRM Domain");
    expect(project.getDomain("billing")?.model?.name).toBe("Billing Domain");
  });

  it("resolves cross-domain qualified references after loading", () => {
    const { project } = loadProject(manifestPath);

    expect(project.resolveQualifiedRef("crm:Customer")?.name).toBe("Customer");
    expect(project.resolveQualifiedRef("billing:Account")?.name).toBe("Account");
  });

  it("produces no project-rule diagnostics for a valid project", () => {
    const { project } = loadProject(manifestPath);
    expect(projectRules(project)).toEqual([]);
  });

  it("throws ProjectLoadError when the manifest does not exist", () => {
    expect(() => loadProject(resolve(__dirname, "nope.orm-project.yaml")))
      .toThrow(ProjectLoadError);
  });

  it("reports a missing domain file as a non-fatal problem", () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, "p.orm-project.yaml"),
      "project:\n  name: P\n  domains:\n"
        + "    - path: ./missing.orm.yaml\n      context: ghost\n",
      "utf-8",
    );

    const { project, problems } = loadProject(join(dir, "p.orm-project.yaml"));

    expect(project.name).toBe("P");
    expect(project.domains).toHaveLength(1);
    expect(project.getDomain("ghost")?.model).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ghost");
  });

  it("resolves referenced paths relative to the manifest directory", () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, "domain.orm.yaml"),
      'orm_version: "1.0"\nmodel:\n  name: Solo\n  domain_context: solo\n',
      "utf-8",
    );
    writeFileSync(
      join(dir, "nested.orm-project.yaml"),
      "project:\n  name: Nested\n  domains:\n"
        + "    - path: ./domain.orm.yaml\n      context: solo\n",
      "utf-8",
    );

    const { project, problems } = loadProject(
      join(dir, "nested.orm-project.yaml"),
    );

    expect(problems).toEqual([]);
    expect(project.getDomain("solo")?.model?.name).toBe("Solo");
  });
});
