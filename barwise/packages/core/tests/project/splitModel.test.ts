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

  it("rejects an empty or whitespace-only project name", () => {
    expect(() =>
      splitModel(SHOP_MODEL, {
        projectName: "   ",
        domains: { crm: ["Customer"], billing: ["Invoice"] },
      })
    ).toThrow(ModelSplitError);
  });

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

  it("refuses a source without orm_version rather than inventing one (barwise-5t9.14)", () => {
    // The schema requires the version at the root, and the source is
    // validated before it is split, so the fallback that used to write
    // a literal "1.0" here could never run. Pin the refusal so nobody
    // reintroduces a default for a path the schema has closed.
    expect(() =>
      splitModel("model:\n  name: unversioned\n", {
        projectName: "Unversioned",
        domains: { a: [], b: [] },
      })
    ).toThrow(/orm_version/);
  });

  it("produces empty domains for a model with no object types or fact types", () => {
    const result = splitModel('orm_version: "1.0"\nmodel:\n  name: empty\n', {
      projectName: "Empty",
      domains: { a: [], b: [] },
    });

    expect(result.domains).toHaveLength(2);
    for (const domain of result.domains) {
      expect(domain.yaml).not.toContain("object_types:");
      expect(domain.yaml).not.toContain("fact_types:");
    }
    expect(result.warnings.some((w) => w.includes('Domain "a" has no object types'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Domain "b" has no object types'))).toBe(true);
  });

  it("gives an unhomed, unreferenced object type a fallback home with a warning", () => {
    const model = `orm_version: "1.0"
model:
  name: orphan-test
  object_types:
    - { id: ot-customer, name: Customer, kind: entity, reference_mode: customer_id }
    - { id: ot-orphan, name: Orphan, kind: value }
`;
    // Orphan participates in no fact type and is not listed in the
    // config, so it can be neither assigned nor inferred.
    const result = splitModel(model, {
      projectName: "P",
      domains: { a: ["Customer"], b: [] },
    });

    expect(
      result.warnings.some((w) => w.includes('Could not infer a domain for object type "Orphan"')),
    ).toBe(true);
    const domainA = new OrmYamlSerializer().deserialize(
      result.domains.find((d) => d.context === "a")!.yaml,
    );
    expect(domainA.getObjectTypeByName("Orphan")).toBeDefined();
  });

  it("warns about a config name that matches no object type in the source model", () => {
    const result = splitModel(SHOP_MODEL, {
      projectName: "Shop",
      domains: { crm: ["Customer", "Ghost"], billing: ["Invoice"] },
    });

    expect(
      result.warnings.some((w) =>
        w.includes('Config assigns object type "Ghost" to domain "crm"')
        && w.includes("no such object type")
      ),
    ).toBe(true);
  });

  it("keeps the first domain when an object type is assigned to two domains", () => {
    const result = splitModel(SHOP_MODEL, {
      projectName: "Shop",
      domains: { crm: ["Customer"], billing: ["Invoice", "Customer"] },
    });

    expect(
      result.warnings.some((w) =>
        w.includes('Object type "Customer" is assigned to multiple domains')
        && w.includes('keeping "crm"')
      ),
    ).toBe(true);
    const crm = new OrmYamlSerializer().deserialize(
      result.domains.find((d) => d.context === "crm")!.yaml,
    );
    expect(crm.getObjectTypeByName("Customer")).toBeDefined();
  });

  it("treats a domain with no per-domain list as owning nothing", () => {
    const config = { projectName: "Shop", domains: { crm: ["Customer"] } } as unknown as {
      projectName: string;
      domains: Record<string, string[]>;
    };
    // A context present in the config but with its list omitted entirely
    // (as opposed to an explicit empty array) -- possible from a JS
    // caller even though SplitConfig's type says otherwise.
    (config.domains as Record<string, string[] | undefined>).billing = undefined;

    const result = splitModel(SHOP_MODEL, config);
    expect(result.domains.map((d) => d.context)).toEqual(["crm", "billing"]);
  });

  it("falls back to the first domain for a fact type whose players are all still unhomed", () => {
    // Two value types connected only to each other and to nothing else:
    // neither is in the config, and inference has no homed neighbour to
    // seed from, so their fact type's home falls back to the first
    // configured domain.
    const model = `orm_version: "1.0"
model:
  name: isolated-test
  object_types:
    - { id: ot-customer, name: Customer, kind: entity, reference_mode: customer_id }
    - { id: ot-x, name: X, kind: value }
    - { id: ot-y, name: Y, kind: value }
  fact_types:
    - id: ft-x-relates-y
      name: X relates Y
      roles:
        - { id: rx, player: ot-x, role_name: relates }
        - { id: ry, player: ot-y, role_name: is related to }
      readings: ["{0} relates {1}"]
`;
    const result = splitModel(model, {
      projectName: "P",
      domains: { first: ["Customer"], second: [] },
    });

    const first = new OrmYamlSerializer().deserialize(
      result.domains.find((d) => d.context === "first")!.yaml,
    );
    expect(first.getFactTypeByName("X relates Y")).toBeDefined();
  });

  it("resolves objectified fact type home conflicts, carries populations, and warns about diagrams", () => {
    const model = `orm_version: "1.0"
model:
  name: obj-test
  object_types:
    - { id: ot-person, name: Person, kind: entity, reference_mode: person_id }
    - { id: ot-marriage-ok, name: MarriageOk, kind: entity, reference_mode: marriage_ok_id }
    - { id: ot-marriage-conflict, name: MarriageConflict, kind: entity, reference_mode: marriage_conflict_id }
  fact_types:
    - id: ft-marries-ok
      name: Person marries Person Ok
      roles:
        - { id: rok1, player: ot-person, role_name: marries }
        - { id: rok2, player: ot-person, role_name: is married to }
      readings: ["{0} marries {1}"]
    - id: ft-marries-conflict
      name: Person marries Person Conflict
      roles:
        - { id: rc1, player: ot-person, role_name: marries }
        - { id: rc2, player: ot-person, role_name: is married to }
      readings: ["{0} marries {1}"]
  objectified_fact_types:
    - { id: obj-ok, fact_type: ft-marries-ok, object_type: ot-marriage-ok }
    - { id: obj-conflict, fact_type: ft-marries-conflict, object_type: ot-marriage-conflict }
  populations:
    - id: pop-1
      fact_type: ft-marries-ok
      instances:
        - { id: inst-1, role_values: { rok1: P1, rok2: P2 } }
  definitions:
    - { term: Person, definition: "A human being." }
  diagrams:
    - { name: main }
`;
    // MarriageOk is pre-assigned to the same domain its fact type lands
    // in (a no-op); MarriageConflict is pre-assigned to the other domain,
    // forcing a conflict warning and a move to follow its fact type.
    const result = splitModel(model, {
      projectName: "P",
      domains: { a: ["Person", "MarriageOk"], b: ["MarriageConflict"] },
    });

    expect(
      result.warnings.some((w) =>
        w.includes('Object type "MarriageConflict" objectifies a fact type homed in "a"')
        && w.includes('assigned it to "b"')
      ),
    ).toBe(true);

    const domainA = new OrmYamlSerializer().deserialize(
      result.domains.find((d) => d.context === "a")!.yaml,
    );
    // Both objectified entity types end up in "a", following their fact types.
    expect(domainA.getObjectTypeByName("MarriageOk")).toBeDefined();
    expect(domainA.getObjectTypeByName("MarriageConflict")).toBeDefined();
    expect(domainA.populations).toHaveLength(1);
    expect(domainA.definitions.some((d) => d.term === "Person")).toBe(true);

    // Domain "b" is left with nothing of its own.
    expect(
      result.warnings.some((w) => w.includes('Domain "b" has no object types or fact types')),
    ).toBe(true);

    expect(
      result.warnings.some((w) => w.includes("diagram layout(s)") && w.includes("not carried")),
    ).toBe(true);
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
