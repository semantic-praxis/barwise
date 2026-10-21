import { describe, expect, it } from "vitest";
import { stripBarwiseComments } from "../../src/annotation/helpers.js";
import {
  annotateOrmYaml,
  collectAnnotations,
  type TranscriptProvenance,
} from "../../src/annotation/OrmYamlAnnotator.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const serializer = new OrmYamlSerializer();

// ---------------------------------------------------------------------------
// Helpers to build provenance fixtures
// ---------------------------------------------------------------------------

function buildModel() {
  // Student and Course have preferred identifiers via isPreferred.
  // Professor has a reference mode but NO preferred uniqueness constraint
  // -> triggers "How do you uniquely identify?" structural gap.
  return new ModelBuilder("University Enrollment")
    .withEntityType("Student", { referenceMode: "student_id" })
    .withEntityType("Course", { referenceMode: "course_code" })
    .withEntityType("Professor", { referenceMode: "professor_id" })
    .withValueType("StudentId")
    .withValueType("CourseCode")
    .withValueType("Grade")
    .withBinaryFactType("Student has StudentId", {
      role1: { player: "Student", name: "has" },
      role2: { player: "StudentId", name: "is of" },
      uniqueness: "both",
      isPreferred: true,
    })
    .withBinaryFactType("Course has CourseCode", {
      role1: { player: "Course", name: "has" },
      role2: { player: "CourseCode", name: "is of" },
      uniqueness: "both",
      isPreferred: true,
    })
    .withBinaryFactType("Student enrolls in Course", {
      role1: { player: "Student", name: "enrolls in" },
      role2: { player: "Course", name: "has enrolled" },
      uniqueness: "spanning",
      mandatory: "role1",
    })
    .withBinaryFactType("Professor teaches Course", {
      role1: { player: "Professor", name: "teaches" },
      role2: { player: "Course", name: "is taught by" },
      uniqueness: "role2",
    })
    .build();
}

function emptyProvenance(model: ReturnType<typeof buildModel>): TranscriptProvenance {
  return {
    model,
    ambiguities: [],
    constraintProvenance: [],
    subtypeProvenance: [],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// collectAnnotations tests
// ---------------------------------------------------------------------------

describe("collectAnnotations", () => {
  it("produces no annotations for a fully-specified model with no provenance issues", () => {
    const model = new ModelBuilder("Clean")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "A person who buys things",
      })
      .withValueType("Name", { definition: "A name string" })
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "both",
        isPreferred: true,
      })
      .build();

    const provenance = emptyProvenance(model);
    const annotations = collectAnnotations(provenance);
    expect(annotations).toHaveLength(0);
  });

  it("generates TODO for ambiguities", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        {
          description: "Can a Student enroll in the same Course twice?",
          source_references: [{ lines: [14, 16], excerpt: "re-enrollment" }],
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const ambiguityAnnotation = annotations.find((a) => a.message.includes("Can a Student enroll"));
    expect(ambiguityAnnotation).toBeDefined();
    expect(ambiguityAnnotation!.severity).toBe("todo");
    expect(ambiguityAnnotation!.message).toContain("Ask:");
    expect(ambiguityAnnotation!.message).toContain("(lines 14-16)");
  });

  it("matches ambiguity to fact type by name in description", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        {
          description: "The Student enrolls in Course relationship may be temporal",
          source_references: [],
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const matched = annotations.find((a) => a.message.includes("temporal"));
    expect(matched).toBeDefined();
    expect(matched!.elementType).toBe("fact_type");
    expect(matched!.elementName).toBe("Student enrolls in Course");
  });

  it("matches ambiguity to object type when no fact type matches", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        {
          description: "Is Professor a full-time or part-time role?",
          source_references: [],
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const matched = annotations.find((a) => a.message.includes("Professor"));
    expect(matched).toBeDefined();
    expect(matched!.elementType).toBe("object_type");
    expect(matched!.elementName).toBe("Professor");
  });

  it("places unmatched ambiguity at model level", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        {
          description: "The scope of the model is unclear",
          source_references: [],
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const modelLevel = annotations.find((a) => a.message.includes("scope of the model"));
    expect(modelLevel).toBeDefined();
    expect(modelLevel!.elementType).toBe("model");
  });

  it("generates TODO for skipped constraints", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      constraintProvenance: [
        {
          description: "Each Student enrolls in Course at most 5 times",
          confidence: "medium",
          sourceReferences: [{ lines: [22, 23], excerpt: "at most 5" }],
          applied: false,
          skipReason: "frequency constraints not yet supported",
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const skipped = annotations.find((a) => a.message.includes("Skipped"));
    expect(skipped).toBeDefined();
    expect(skipped!.severity).toBe("todo");
    expect(skipped!.message).toContain("frequency constraints not yet supported");
    expect(skipped!.message).toContain("(lines 22-23)");
  });

  it("generates TODO for low-confidence constraints", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      constraintProvenance: [
        {
          description: "uniqueness on Professor teaches Course",
          confidence: "low",
          sourceReferences: [{ lines: [30, 30], excerpt: "each professor" }],
          applied: true,
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const lowConf = annotations.find((a) => a.message.includes("Verify"));
    expect(lowConf).toBeDefined();
    expect(lowConf!.severity).toBe("todo");
    expect(lowConf!.message).toContain("low confidence");
    expect(lowConf!.message).toContain("(line 30)");
    expect(lowConf!.elementType).toBe("fact_type");
    expect(lowConf!.elementName).toBe("Professor teaches Course");
  });

  it("generates NOTE for medium-confidence constraints", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      constraintProvenance: [
        {
          description: "mandatory on Student enrolls in Course",
          confidence: "medium",
          sourceReferences: [],
          applied: true,
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const medium = annotations.find((a) => a.message.includes("medium confidence"));
    expect(medium).toBeDefined();
    expect(medium!.severity).toBe("note");
  });

  it("skips medium-confidence notes when option is disabled", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      constraintProvenance: [
        {
          description: "mandatory on Student enrolls in Course",
          confidence: "medium",
          sourceReferences: [],
          applied: true,
        },
      ],
    };

    const annotations = collectAnnotations(provenance, {
      includeMediumConfidence: false,
    });
    const medium = annotations.find((a) => a.message.includes("medium confidence"));
    expect(medium).toBeUndefined();
  });

  it("generates no annotation for high-confidence applied constraints", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      constraintProvenance: [
        {
          description: "uniqueness on Student enrolls in Course",
          confidence: "high",
          sourceReferences: [],
          applied: true,
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const constraintAnnotations = annotations.filter(
      (a) =>
        a.message.includes("Verify")
        || a.message.includes("Skipped")
        || a.message.includes("confidence"),
    );
    expect(constraintAnnotations).toHaveLength(0);
  });

  it("generates TODO for skipped subtypes", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      subtypeProvenance: [
        {
          subtype: "Student",
          supertype: "Person",
          sourceReferences: [{ lines: [5, 6], excerpt: "students are people" }],
          applied: false,
          skipReason: "supertype Person not found in model",
        },
      ],
    };

    const annotations = collectAnnotations(provenance);
    const subtype = annotations.find((a) => a.message.includes("Skipped subtype"));
    expect(subtype).toBeDefined();
    expect(subtype!.severity).toBe("todo");
    expect(subtype!.elementType).toBe("object_type");
    expect(subtype!.elementName).toBe("Student");
    expect(subtype!.message).toContain("Student is a Person");
  });

  it("generates NOTE for warnings at model level", () => {
    const model = buildModel();
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      warnings: ["Transcript is very short; model may be incomplete"],
    };

    const annotations = collectAnnotations(provenance);
    const warning = annotations.find((a) => a.message.includes("very short"));
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("note");
    expect(warning!.elementType).toBe("model");
  });

  it("detects entity types without preferred identifier", () => {
    const model = buildModel();
    const provenance = emptyProvenance(model);

    const annotations = collectAnnotations(provenance);
    const missingId = annotations.find(
      (a) =>
        a.elementName === "Professor"
        && a.message.includes("uniquely identify"),
    );
    expect(missingId).toBeDefined();
    expect(missingId!.severity).toBe("todo");
  });

  it("does not flag entity types with reference mode", () => {
    const model = buildModel();
    const provenance = emptyProvenance(model);

    const annotations = collectAnnotations(provenance);
    const studentId = annotations.find(
      (a) =>
        a.elementName === "Student"
        && a.message.includes("uniquely identify"),
    );
    expect(studentId).toBeUndefined();
  });

  it("detects object types without definitions", () => {
    const model = buildModel();
    const provenance = emptyProvenance(model);

    const annotations = collectAnnotations(provenance);
    const noDefAnnotations = annotations.filter((a) =>
      a.message.includes("No definition captured")
    );
    // All 6 object types lack definitions
    expect(noDefAnnotations.length).toBe(6);
    expect(noDefAnnotations.every((a) => a.severity === "note")).toBe(true);
  });

  it("skips structural gaps when option is disabled", () => {
    const model = buildModel();
    const provenance = emptyProvenance(model);

    const annotations = collectAnnotations(provenance, {
      includeStructuralGaps: false,
    });
    const structural = annotations.filter(
      (a) =>
        a.message.includes("uniquely identify")
        || a.message.includes("No definition"),
    );
    expect(structural).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// annotateOrmYaml YAML injection tests
// ---------------------------------------------------------------------------

describe("annotateOrmYaml", () => {
  it("returns clean YAML when there are no annotations", () => {
    const model = new ModelBuilder("Clean")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "A buyer",
      })
      .withValueType("Name", { definition: "A name" })
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "both",
        isPreferred: true,
      })
      .build();

    const yaml = serializer.serialize(model);
    const provenance = emptyProvenance(model);
    const result = annotateOrmYaml(yaml, provenance);

    expect(result.todoCount).toBe(0);
    expect(result.noteCount).toBe(0);
    expect(result.yaml).toBe(stripBarwiseComments(yaml));
  });

  it("injects TODO after object type name line for ambiguities", () => {
    const model = buildModel();
    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        {
          description: "Is Professor a full-time or part-time role?",
          source_references: [{ lines: [10, 12], excerpt: "professor type" }],
        },
      ],
    };

    const result = annotateOrmYaml(yaml, provenance);
    const lines = result.yaml.split("\n");

    // Find the Professor name line and check the line after it.
    const profIdx = lines.findIndex((l) => l.includes("name: Professor"));
    expect(profIdx).toBeGreaterThan(-1);
    expect(lines[profIdx + 1]).toContain("# TODO(barwise):");
    expect(lines[profIdx + 1]).toContain("Ask:");
    expect(lines[profIdx + 1]).toContain("Professor");
  });

  it("injects annotations after fact type name line", () => {
    const model = buildModel();
    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      constraintProvenance: [
        {
          description: "uniqueness on Professor teaches Course",
          confidence: "low",
          sourceReferences: [],
          applied: true,
        },
      ],
    };

    const result = annotateOrmYaml(yaml, provenance);
    const lines = result.yaml.split("\n");

    // Find the fact type name line.
    const ftIdx = lines.findIndex((l) => l.includes("name: Professor teaches Course"));
    expect(ftIdx).toBeGreaterThan(-1);
    expect(lines[ftIdx + 1]).toContain("# TODO(barwise):");
    expect(lines[ftIdx + 1]).toContain("Verify constraint");
  });

  it("injects model-level annotations after model name", () => {
    const model = buildModel();
    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      warnings: ["Transcript may be incomplete"],
    };

    const result = annotateOrmYaml(yaml, provenance);
    const lines = result.yaml.split("\n");

    // Find the model name line.
    const nameIdx = lines.findIndex((l) => l.match(/^\s{2}name:\s*University/));
    expect(nameIdx).toBeGreaterThan(-1);
    expect(lines[nameIdx + 1]).toContain("# NOTE(barwise):");
    expect(lines[nameIdx + 1]).toContain("Transcript may be incomplete");
  });

  it("counts TODOs and NOTEs correctly", () => {
    const model = buildModel();
    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        { description: "unclear thing about Student", source_references: [] },
      ],
      warnings: ["a warning"],
    };

    const result = annotateOrmYaml(yaml, provenance);
    // 1 ambiguity TODO + 1 structural TODO (Professor missing identifier) = 2
    // 6 missing definitions + 1 warning = 7 NOTEs
    expect(result.todoCount).toBe(2);
    expect(result.noteCount).toBe(7);
  });

  it("is idempotent -- annotating twice produces the same result", () => {
    const model = buildModel();
    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        {
          description: "Is Professor a full-time or part-time role?",
          source_references: [],
        },
      ],
      warnings: ["Model may be incomplete"],
    };

    const first = annotateOrmYaml(yaml, provenance);
    const second = annotateOrmYaml(first.yaml, provenance);

    expect(second.yaml).toBe(first.yaml);
    expect(second.todoCount).toBe(first.todoCount);
    expect(second.noteCount).toBe(first.noteCount);
  });

  it("round-trips: annotate then strip returns clean YAML", () => {
    const model = buildModel();
    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        { description: "unclear thing about Course", source_references: [] },
      ],
      constraintProvenance: [
        {
          description: "uniqueness on Professor teaches Course",
          confidence: "low",
          sourceReferences: [],
          applied: true,
        },
      ],
      warnings: ["Model may be incomplete"],
    };

    const annotated = annotateOrmYaml(yaml, provenance);
    const stripped = stripBarwiseComments(annotated.yaml);

    expect(stripped).toBe(stripBarwiseComments(yaml));
  });

  it("handles a model with no fact types", () => {
    const model = new ModelBuilder("Simple")
      .withEntityType("Thing")
      .build();

    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      warnings: ["Very simple model"],
    };

    const result = annotateOrmYaml(yaml, provenance);
    expect(result.yaml).toContain("# NOTE(barwise): Very simple model");
    // Structural: Thing has no definition
    expect(result.yaml).toContain("No definition captured for Thing");
  });

  it("handles multiple annotations on the same element", () => {
    const model = buildModel();
    const yaml = serializer.serialize(model);
    const provenance: TranscriptProvenance = {
      ...emptyProvenance(model),
      ambiguities: [
        { description: "Is Professor tenured?", source_references: [] },
        {
          description: "Does Professor have a department?",
          source_references: [],
        },
      ],
    };

    const result = annotateOrmYaml(yaml, provenance);
    const lines = result.yaml.split("\n");

    // Find lines after Professor name.
    const profIdx = lines.findIndex((l) => l.includes("name: Professor"));
    expect(profIdx).toBeGreaterThan(-1);

    // Should have both ambiguity TODOs plus structural gaps after the name.
    const annotationLines = [];
    for (let i = profIdx + 1; i < lines.length; i++) {
      if (lines[i]!.match(/^\s*# (?:TODO|NOTE)\(barwise\):/)) {
        annotationLines.push(lines[i]);
      } else {
        break;
      }
    }
    // At least the 2 ambiguities
    expect(annotationLines.length).toBeGreaterThanOrEqual(2);
    expect(annotationLines.some((l) => l!.includes("tenured"))).toBe(true);
    expect(annotationLines.some((l) => l!.includes("department"))).toBe(true);
  });
});
