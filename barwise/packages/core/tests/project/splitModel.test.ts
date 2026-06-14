/**
 * Tests for splitModel: cutting a monolithic .orm.yaml into a
 * multi-domain project with suggested context mappings.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ModelSplitError, splitModel } from "../../src/project/splitModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { assembleProject, type ProjectFiles } from "../../src/serialization/projectAssembly.js";
import { projectRules } from "../../src/validation/rules/projectRules.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");

/** A two-domain shop model with one cross-domain fact type. */
const SHOP_MODEL = `orm_version: "1.0"
model:
  name: shop
  object_types:
    - { id: ot-customer, name: Customer, kind: entity, reference_mode: customer_id }
    - { id: ot-email, name: Email, kind: value }
    - { id: ot-invoice, name: Invoice, kind: entity, reference_mode: invoice_id }
    - { id: ot-amount, name: Amount, kind: value }
  fact_types:
    - id: ft-cust-email
      name: Customer has Email
      roles:
        - { id: r1, player: ot-customer, role_name: has }
        - { id: r2, player: ot-email, role_name: of }
      readings: ["{0} has {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r1] }
    - id: ft-inv-amount
      name: Invoice has Amount
      roles:
        - { id: r3, player: ot-invoice, role_name: has }
        - { id: r4, player: ot-amount, role_name: of }
      readings: ["{0} has {1}"]
    - id: ft-cust-invoice
      name: Customer pays Invoice
      roles:
        - { id: r5, player: ot-customer, role_name: pays }
        - { id: r6, player: ot-invoice, role_name: paid-by }
      readings: ["{0} pays {1}"]
`;

describe("splitModel", () => {
  /** Assemble a SplitResult into a project via the pure assembler. */
  function load(result: ReturnType<typeof splitModel>) {
    const files: ProjectFiles = {
      domains: new Map(result.domains.map((d) => [d.fileName, { content: d.yaml }])),
      mappings: new Map(result.mappings.map((m) => [m.fileName, { content: m.yaml }])),
    };
    return assembleProject(result.manifestYaml, files);
  }

  it("rejects a config with fewer than two domains", () => {
    expect(() => splitModel(SHOP_MODEL, { projectName: "P", domains: { only: [] } })).toThrow(
      ModelSplitError,
    );
  });

  it("rejects input that is not a valid ORM model", () => {
    expect(() =>
      splitModel("not: a model", {
        projectName: "P",
        domains: { a: [], b: [] },
      })
    ).toThrow(ModelSplitError);
  });

  it("produces one domain file per configured context", () => {
    const result = splitModel(SHOP_MODEL, {
      projectName: "Shop",
      domains: { crm: ["Customer"], billing: ["Invoice"] },
    });
    expect(result.domains.map((d) => d.context)).toEqual(["crm", "billing"]);
    expect(result.domains[0]?.fileName).toBe("domains/crm.orm.yaml");
  });

  it("infers a home for value types from the fact types that use them", () => {
    const result = splitModel(SHOP_MODEL, {
      projectName: "Shop",
      domains: { crm: ["Customer"], billing: ["Invoice"] },
    });
    const crm = new OrmYamlSerializer().deserialize(
      result.domains.find((d) => d.context === "crm")!.yaml,
    );
    const billing = new OrmYamlSerializer().deserialize(
      result.domains.find((d) => d.context === "billing")!.yaml,
    );
    // Email is reachable only from Customer; Amount only from Invoice.
    expect(crm.getObjectTypeByName("Email")).toBeDefined();
    expect(billing.getObjectTypeByName("Amount")).toBeDefined();
  });

  it("shadows a cross-domain object type and suggests a mapping", () => {
    const result = splitModel(SHOP_MODEL, {
      projectName: "Shop",
      domains: { crm: ["Customer"], billing: ["Invoice"] },
    });
    // "Customer pays Invoice" is homed in crm (tie broken to first role);
    // Invoice is therefore shadowed into crm.
    const crmYaml = result.domains.find((d) => d.context === "crm")!.yaml;
    const crm = new OrmYamlSerializer().deserialize(crmYaml);
    const invoice = crm.getObjectTypeByName("Invoice");
    expect(invoice).toBeDefined();
    expect(crmYaml).toContain("source_context: billing");

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]?.fileName).toBe("mappings/billing-crm.map.yaml");
    expect(result.mappings[0]?.yaml).toContain("Invoice");
  });

  it("produces a project that loads and validates with no errors", () => {
    const result = splitModel(SHOP_MODEL, {
      projectName: "Shop",
      domains: { crm: ["Customer"], billing: ["Invoice"] },
    });
    const { project, problems } = load(result);
    expect(problems).toEqual([]);

    const engine = new ValidationEngine();
    for (const domain of project.domains) {
      const errors = engine
        .validate(domain.model!)
        .filter((d) => d.severity === "error");
      expect(errors).toEqual([]);
    }
    expect(
      projectRules(project).filter((d) => d.severity === "error"),
    ).toEqual([]);
  });

  it("splits the auction model into a valid four-domain project", () => {
    const modelYaml = readFileSync(
      join(repoRoot, "docs/auction.orm.yaml"),
      "utf-8",
    );
    const configYaml = readFileSync(
      join(repoRoot, "examples/auction-split.yaml"),
      "utf-8",
    );
    // The config file is plain YAML; parse it the same way the CLI does.
    const config = parseAuctionConfig(configYaml);

    const result = splitModel(modelYaml, config);
    expect(result.domains).toHaveLength(4);

    const { project, problems } = load(result);
    expect(problems).toEqual([]);

    const engine = new ValidationEngine();
    for (const domain of project.domains) {
      const errors = engine
        .validate(domain.model!)
        .filter((d) => d.severity === "error");
      expect(errors, `domain ${domain.context}`).toEqual([]);
    }
    expect(
      projectRules(project).filter((d) => d.severity === "error"),
    ).toEqual([]);
  });
});

/** Minimal parse of the auction-split.yaml config used by the test. */
function parseAuctionConfig(yaml: string): {
  projectName: string;
  domains: Record<string, string[]>;
} {
  return parse(yaml) as {
    projectName: string;
    domains: Record<string, string[]>;
  };
}
