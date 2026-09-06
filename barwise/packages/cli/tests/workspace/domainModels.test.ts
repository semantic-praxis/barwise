/**
 * Tests for resolveDomainModels: the single-model / project-with-domain
 * / project-without-domain fork shared by the read/analyze commands
 * (docs/specs/archive/orm-project-surface-wiring.spec.md).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDomainModels } from "../../src/workspace/domainModels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");
const missingDomainProject = resolve(fixtures, "project/missing-domain.orm-project.yaml");
const project = resolve(fixtures, "project/project.orm-project.yaml");

describe("resolveDomainModels", () => {
  it("resolves a single-model file to one unlabelled entry", () => {
    const { resolved, problems } = resolveDomainModels(resolve(fixtures, "simple.orm.yaml"));
    expect(problems).toEqual([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.context).toBeUndefined();
  });

  it("skips a domain that failed to load when no --domain is given", () => {
    const { resolved, problems } = resolveDomainModels(missingDomainProject);
    expect(resolved.map((r) => r.context)).toEqual(["crm"]);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("throws when the named domain exists but failed to load", () => {
    expect(() => resolveDomainModels(missingDomainProject, "ghost"))
      .toThrow(/domain "ghost" could not be loaded/);
  });

  it("throws naming the available domains for an unknown --domain", () => {
    expect(() => resolveDomainModels(project, "nonexistent"))
      .toThrow(/project has no domain "nonexistent"\. Available: crm, billing\./);
  });

  it("returns the one named domain's model when --domain matches", () => {
    const { resolved } = resolveDomainModels(project, "crm");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.context).toBe("crm");
  });
});
