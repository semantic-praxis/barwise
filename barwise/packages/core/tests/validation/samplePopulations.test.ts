/**
 * A sample population is positive evidence only.
 *
 * It can satisfy a constraint but never creates the obligation that one
 * be satisfied. That single sentence is the whole semantics, and these
 * tests are its two halves: an entity a sample merely mentions raises
 * no mandatory violation, and a sample instance still discharges an
 * obligation raised elsewhere.
 *
 * The distinction exists because populations arrive from two very
 * different places. A hand-authored population is significant -- the
 * modeller chose those tuples to check a rule against, and a gap in
 * them is a finding. An extracted one is whatever a transcript happened
 * to mention, and a gap in it is just a transcript being a transcript.
 * Judging the second as the first reported a violation for every entity
 * named in passing, which is what sank a dev case to zero and reached
 * anyone importing a long transcript in the editor
 * (docs/specs/sample-populations.spec.md).
 */
import { describe, expect, it } from "vitest";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const MANDATORY_VIOLATION = "population/mandatory-violation";

/**
 * "Incident has Severity" is mandatory on the Incident role. INC-001
 * has one; INC-003 exists only in a second fact type. Under closed-world
 * checking that is a violation -- INC-003 exists and plays no severity
 * role.
 */
function incidents(sample: boolean) {
  const b = new ModelBuilder()
    .withEntityType("Incident")
    .withEntityType("Severity")
    .withEntityType("Alert")
    .withBinaryFactType("Incident has Severity", {
      role1: { player: "Incident", name: "incident" },
      role2: { player: "Severity", name: "severity" },
      mandatory: "role1",
    })
    .withBinaryFactType("Incident seen in Alert", {
      role1: { player: "Incident", name: "incident" },
      role2: { player: "Alert", name: "alert" },
    });

  const add = sample
    ? b.withSamplePopulation.bind(b)
    : b.withPopulation.bind(b);

  add("Incident has Severity", [
    {
      roleValues: {
        "Incident has Severity::role1": "INC-001",
        "Incident has Severity::role2": "P1",
      },
    },
  ]);
  add("Incident seen in Alert", [
    {
      roleValues: {
        "Incident seen in Alert::role1": "INC-003",
        "Incident seen in Alert::role2": "A-9",
      },
    },
  ]);
  return b.build();
}

function mandatoryViolations(model: ReturnType<typeof incidents>): number {
  return new ValidationEngine().validate(model)
    .filter((d) => d.ruleId === MANDATORY_VIOLATION).length;
}

describe("a significant population", () => {
  it("still reports a mandatory role no instance plays", () => {
    // Unchanged behaviour, and the half most worth protecting: this is
    // a real finding for a model whose population was chosen to check
    // the rule. Weakening it would make the check useless for the
    // hand-authored case it was built for.
    expect(mandatoryViolations(incidents(false))).toBe(1);
  });
});

describe("a sample population", () => {
  it("does not accuse an entity it merely mentions", () => {
    expect(mandatoryViolations(incidents(true))).toBe(0);
  });

  it("still satisfies an obligation raised by a significant population", () => {
    // The asymmetry, stated as a test. The significant population puts
    // INC-007 in the universe; the sample is what shows it plays the
    // mandatory role. If samples were excluded from `valuesPlayedInRole`
    // as well as from the universe, this would report a violation and
    // the rule would punish evidence for existing.
    const model = new ModelBuilder()
      .withEntityType("Incident")
      .withEntityType("Severity")
      .withEntityType("Alert")
      .withBinaryFactType("Incident has Severity", {
        role1: { player: "Incident", name: "incident" },
        role2: { player: "Severity", name: "severity" },
        mandatory: "role1",
      })
      .withBinaryFactType("Incident seen in Alert", {
        role1: { player: "Incident", name: "incident" },
        role2: { player: "Alert", name: "alert" },
      })
      // Significant: INC-007 exists, and must therefore have a severity.
      .withPopulation("Incident seen in Alert", [
        {
          roleValues: {
            "Incident seen in Alert::role1": "INC-007",
            "Incident seen in Alert::role2": "A-1",
          },
        },
      ])
      // Sample: and here it is, playing that role.
      .withSamplePopulation("Incident has Severity", [
        {
          roleValues: {
            "Incident has Severity::role1": "INC-007",
            "Incident has Severity::role2": "P2",
          },
        },
      ])
      .build();

    expect(
      new ValidationEngine().validate(model)
        .filter((d) => d.ruleId === MANDATORY_VIOLATION),
    ).toEqual([]);
  });

  it("is still checked for contradictions in the data it does contain", () => {
    // The line between the two families: a sample cannot be incomplete
    // in a way that creates a duplicate. Uniqueness reads the instances
    // directly rather than through the object universe, so marking a
    // population as a sample must not silence it -- otherwise "sample"
    // becomes "unchecked".
    const model = new ModelBuilder()
      .withEntityType("Incident")
      .withEntityType("Severity")
      .withBinaryFactType("Incident has Severity", {
        role1: { player: "Incident", name: "incident" },
        role2: { player: "Severity", name: "severity" },
        uniqueness: "role1",
      })
      .withSamplePopulation("Incident has Severity", [
        {
          roleValues: {
            "Incident has Severity::role1": "INC-001",
            "Incident has Severity::role2": "P1",
          },
        },
        {
          roleValues: {
            "Incident has Severity::role1": "INC-001",
            "Incident has Severity::role2": "P3",
          },
        },
      ])
      .build();

    const violations = new ValidationEngine().validate(model)
      .filter((d) => d.ruleId === "population/uniqueness-violation");
    expect(violations.length).toBeGreaterThan(0);
  });
});
