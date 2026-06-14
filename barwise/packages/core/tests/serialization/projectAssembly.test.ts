/**
 * Tests for the pure project assembler: building an OrmProject from a
 * manifest and already-read file contents, with no filesystem access.
 * The CLI tool layer reads the files; these tests pass contents directly.
 */
import { describe, expect, it } from "vitest";
import {
  assembleProject,
  type ProjectFile,
  projectFilePaths,
  ProjectLoadError,
} from "../../src/serialization/projectAssembly.js";

const MANIFEST = `project:
  name: Shop
  domains:
    - path: ./domains/crm.orm.yaml
      context: crm
    - path: ./domains/billing.orm.yaml
      context: billing
  mappings:
    - path: ./mappings/crm-billing.map.yaml
`;

const CRM = `orm_version: "1.0"
model:
  name: CRM
  domain_context: crm
  object_types:
    - { id: ot-customer, name: Customer, kind: entity, reference_mode: id }
`;

const BILLING = `orm_version: "1.0"
model:
  name: Billing
  domain_context: billing
  object_types:
    - { id: ot-account, name: Account, kind: entity, reference_mode: id }
`;

const MAPPING = `mapping:
  source_context: crm
  target_context: billing
  pattern: shared_kernel
  entity_mappings:
    - source_object_type: Customer
      target_object_type: Account
`;

function content(yaml: string): ProjectFile {
  return { content: yaml };
}

function fullFiles() {
  return {
    domains: new Map<string, ProjectFile>([
      ["./domains/crm.orm.yaml", content(CRM)],
      ["./domains/billing.orm.yaml", content(BILLING)],
    ]),
    mappings: new Map<string, ProjectFile>([
      ["./mappings/crm-billing.map.yaml", content(MAPPING)],
    ]),
  };
}

describe("projectFilePaths", () => {
  it("returns the domain and mapping paths the manifest references", () => {
    const { domainPaths, mappingPaths } = projectFilePaths(MANIFEST);
    expect(domainPaths).toEqual([
      "./domains/crm.orm.yaml",
      "./domains/billing.orm.yaml",
    ]);
    expect(mappingPaths).toEqual(["./mappings/crm-billing.map.yaml"]);
  });

  it("throws ProjectLoadError when the manifest cannot be parsed", () => {
    expect(() => projectFilePaths("not: a project")).toThrow(ProjectLoadError);
  });
});

describe("assembleProject", () => {
  it("attaches a model to each domain and adds each mapping", () => {
    const { project, problems } = assembleProject(MANIFEST, fullFiles());

    expect(problems).toEqual([]);
    expect(project.name).toBe("Shop");
    expect(project.getDomain("crm")?.model?.name).toBe("CRM");
    expect(project.getDomain("billing")?.model?.name).toBe("Billing");
    expect(project.mappings).toHaveLength(1);
    expect(project.resolveQualifiedRef("crm:Customer")?.name).toBe("Customer");
  });

  it("reports a read error as a non-fatal problem", () => {
    const files = fullFiles();
    files.domains.set("./domains/billing.orm.yaml", {
      readError: "ENOENT: no such file",
    });

    const { project, problems } = assembleProject(MANIFEST, files);

    expect(project.getDomain("crm")?.model).toBeDefined();
    expect(project.getDomain("billing")?.model).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Domain "billing"');
    expect(problems[0]).toContain("ENOENT");
  });

  it("reports content that was not provided as a problem", () => {
    const files = fullFiles();
    files.domains.delete("./domains/crm.orm.yaml");

    const { problems } = assembleProject(MANIFEST, files);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Domain "crm"');
    expect(problems[0]).toContain("not provided");
  });

  it("reports an unparseable domain file as a problem and keeps the rest", () => {
    const files = fullFiles();
    files.domains.set("./domains/crm.orm.yaml", content("not: an orm model"));

    const { project, problems } = assembleProject(MANIFEST, files);

    expect(project.getDomain("crm")?.model).toBeUndefined();
    expect(project.getDomain("billing")?.model).toBeDefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Domain "crm"');
  });

  it("reports an unparseable mapping file as a problem", () => {
    const files = fullFiles();
    files.mappings.set(
      "./mappings/crm-billing.map.yaml",
      content("mapping: : broken"),
    );

    const { problems } = assembleProject(MANIFEST, files);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Mapping (./mappings/crm-billing.map.yaml)");
  });

  it("throws ProjectLoadError when the manifest itself cannot be parsed", () => {
    expect(() => assembleProject("not: a project", fullFiles())).toThrow(
      ProjectLoadError,
    );
  });
});
