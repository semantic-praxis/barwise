/**
 * The YAML layout of a fact type, its roles and its constraints, byte for
 * byte: gate S2 of docs/specs/effect-adoption.spec.md, the counterpart of
 * objectTypeLayout.test.ts.
 *
 * The constraint serialization tests (Phase2ConstraintSerialization,
 * JoinConstraintSerialization) compare values after a round trip, so a key
 * written in a different position passes them: the reordered text reads
 * back to the same constraint. Users see it as a diff in every committed
 * `.orm.yaml`. A decoder rewritten in another style -- the Effect spike --
 * is exactly the change that could reorder keys without changing a value.
 *
 * One fact type carrying every fact type field, both readings, a
 * derivation, and one constraint of every kind with every field that kind
 * writes: an id on each (written after the body, which is part of what is
 * pinned), a deontic modality, a value constraint
 * with values and ranges, and frequency in both its one-role and many-role
 * forms. Whether every kind is here is checked against CONSTRAINT_TYPES
 * rather than trusted.
 *
 * The fact type's own constraints are written under it and those across
 * fact types in the model's own list (orm-format-3 WS4b, format 3.0).
 * Before 3.0, a save wrote each across-fact-type constraint under its first
 * holder, after that fact type's own.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CONSTRAINT_TYPES } from "../../src/model/Constraint.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const EXPECTED = `orm_version: "3.0"
model:
  name: Layout
  object_types:
    - id: ot-person
      name: Person
      kind: entity
      reference_mode: person_id
  fact_types:
    - id: ft-knows
      name: Person knows Person
      roles:
        - id: r-knower
          player: ot-person
          role_name: knows
        - id: r-known
          player: ot-person
          role_name: is known by
      readings:
        - "{0} knows {1}"
        - "{1} is known by {0}"
      definition: An acquaintance.
      note: Directed.
      constraints:
        - type: internal_uniqueness
          roles:
            - r-knower
            - r-known
          id: c-iuc
        - type: mandatory
          role: r-knower
          id: c-mandatory
          modality: deontic
        - type: value_constraint
          values:
            - A
            - B
          ranges:
            - min: "1"
              max: "5"
              min_inclusive: false
              max_inclusive: false
          role: r-known
          id: c-value
        - type: ring
          role_1: r-knower
          role_2: r-known
          ring_type: irreflexive
          id: c-ring
        - type: frequency
          role: r-knower
          min: 1
          max: 3
          id: c-freq-one
        - type: frequency
          roles:
            - r-knower
            - r-known
          min: 2
          max: unbounded
          id: c-freq-many
        - type: value_comparison
          role_1: r-knower
          role_2: r-known
          operator: <=
          id: c-vcomp
        - type: cardinality
          role: r-knower
          min: 0
          max: 9
          id: c-card
      derivation:
        kind: semiderived
        expression: Person knows Person if Person works with Person.
        storage: derived_and_stored
        is_formal: true
  constraints:
    - type: external_uniqueness
      roles:
        - r-knower
        - r-known
      id: c-euc
    - type: disjunctive_mandatory
      roles:
        - r-knower
        - r-known
      id: c-dm
    - type: exclusion
      roles:
        - r-knower
        - r-known
      id: c-excl
    - type: exclusive_or
      roles:
        - r-knower
        - r-known
      id: c-xor
    - type: subset
      subset_roles:
        - r-knower
      superset_roles:
        - r-known
      id: c-subset
    - type: equality
      roles_1:
        - r-knower
      roles_2:
        - r-known
      id: c-eq
    - type: join_subset
      subset:
        path:
          root: ot-person
          steps:
            - entry: r-knower
              exit: r-known
        projection:
          - 0
          - 1
      superset:
        path:
          root: ot-person
          steps:
            - entry: r-known
              exit: r-knower
        projection:
          - 1
          - 0
      id: c-jsub
    - type: join_equality
      operands:
        - path:
            root: ot-person
            steps:
              - entry: r-knower
                exit: r-known
          projection:
            - 0
            - 1
        - path:
            root: ot-person
            steps:
              - entry: r-known
                exit: r-knower
          projection:
            - 1
            - 0
      id: c-jeq
    - type: join_exclusion
      operands:
        - path:
            root: ot-person
            steps:
              - entry: r-knower
                exit: r-known
          projection:
            - 0
            - 1
        - path:
            root: ot-person
            steps:
              - entry: r-known
                exit: r-knower
          projection:
            - 1
            - 0
      id: c-jex
`;

describe("fact type YAML layout", () => {
  const serializer = new OrmYamlSerializer();

  it("reads every fact type, role and constraint field back to the same text", () => {
    expect(serializer.serialize(serializer.deserialize(EXPECTED))).toBe(EXPECTED);
  });

  it("holds one constraint of every kind, so every kind's layout is pinned", () => {
    const doc = parse(EXPECTED).model;
    const constraints: { type: string; role?: string; roles?: string[]; }[] = [
      ...doc.fact_types[0].constraints,
      ...doc.constraints,
    ];
    expect(new Set(constraints.map((c) => c.type))).toEqual(new Set(CONSTRAINT_TYPES));
    const frequencies = constraints.filter((c) => c.type === "frequency");
    expect(frequencies.map((c) => ("role" in c ? "role" : "roles"))).toEqual(["role", "roles"]);
  });
});
