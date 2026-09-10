# Phase 6 Implementation Plan

Phase 6 has two tracks: (A) Phase 2 constraints across the full stack, and (B) relational mapping. They're somewhat independent -- mapping only needs Phase 1 constraints for the MVP patterns -- but we'll interleave them.

## Track A: Phase 2 Constraints

Add 7 new constraint types to the metamodel, validation, verbalization, and serialization layers.

### A1. Metamodel: New constraint classes in Constraint.ts

Add to the existing constraint type union:

| Constraint                       | Key Fields                                              | Notes                                                    |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `DisjunctiveMandatoryConstraint` | roleIds: string[] (2+, can span fact types)             | "At least one of these roles"                            |
| `ExclusionConstraint`            | roleIds: string[] (2+, can span fact types)             | "No instance plays both"                                 |
| `ExclusiveOrConstraint`          | roleIds: string[] (2+)                                  | Logical combination of disjunctive mandatory + exclusion |
| `SubsetConstraint`               | subsetRoleIds: string[], supersetRoleIds: string[]      | Role sequence subset                                     |
| `EqualityConstraint`             | roleIds1: string[], roleIds2: string[]                  | Bidirectional subset                                     |
| `RingConstraint`                 | roleId1: string, roleId2: string, ringType: RingType    | Reflexive relationship constraint                        |
| `FrequencyConstraint`            | roleId: string, min: number, max: number \| "unbounded" | How many times an object plays a role                    |

`RingType` enum: `irreflexive`, `asymmetric`, `antisymmetric`, `intransitive`, `acyclic`, `symmetric`, `transitive`, `purely_reflexive`.

Add type guards for each: `isDisjunctiveMandatory()`, `isExclusion()`, etc.

Update the `Constraint` union type.

### A2. Validation: Constraint consistency rules

New rules in `constraintConsistency.ts`:

- DisjunctiveMandatory: all roleIds must reference existing roles; the roles must share a common player object type
- Exclusion: same as disjunctive mandatory structure
- ExclusiveOr: same structural checks
- Subset: both sequences must be same length; corresponding roles must have compatible types
- Equality: same as subset structure
- Ring: both roles must be in the same fact type; both must be played by the same object type
- Frequency: role must exist; min <= max; min >= 1

### A3. Verbalization: FORML patterns

New methods in `ConstraintVerbalizer.ts`:

- DisjunctiveMandatory: "Each Customer places some Order or rates some Product."
- Exclusion: "No Customer both places some Order and rates some Product."
- ExclusiveOr: "Each Customer either places some Order or rates some Product but not both."
- Subset: "If a Customer places some Order then that Customer rates some Product."
- Equality: "A Customer places some Order if and only if that Customer rates some Product."
- Ring (irreflexive): "No Person is a parent of that same Person."
- Ring (asymmetric): "If Person1 is a parent of Person2 then Person2 is not a parent of Person1."
- Frequency: "Each Customer places at least 2 and at most 5 Orders."

### A4. Serialization: Schema + round-trip

- Update `orm-model.schema.json` to accept Phase 2 constraint types
- Update `OrmYamlSerializer` to serialize/deserialize new constraint shapes
- Round-trip tests for each constraint type

### A5. ModelBuilder extensions

Add fluent helpers for constructing Phase 2 constraints in tests.

### A6. Export from index.ts

Export all new types and type guards.

---

## Track B: Relational Mapping (Rmap)

### B1. RelationalSchema data model

New file `packages/core/src/mapping/RelationalSchema.ts`:

```
Table { name, columns[], primaryKey, foreignKeys[], sourceElementId }
Column { name, dataType, nullable, sourceRoleId? }
PrimaryKey { columnNames[] }
ForeignKey { columnNames[], referencedTable, referencedColumns[], sourceConstraintId? }
RelationalSchema { tables[], sourceModelId }
```

### B2. RelationalMapper

New file `packages/core/src/mapping/RelationalMapper.ts`:

Core algorithm (standard ORM-to-relational mapping rules):

1. **Independent object types** (entity types not absorbed): each becomes a table with its reference mode as PK.
2. **Binary fact type, single-role uniqueness**: FK on the uniqueness side's table pointing to the other side. If the unique role is also mandatory, the FK column is NOT NULL.
3. **Binary fact type, spanning uniqueness (both roles unique)**: either a FK in one direction (if one side is mandatory) or a separate table.
4. **Unary fact type**: boolean column on the player's table.
5. **Ternary+ fact types**: separate associative table, composite PK from all role FKs, with FKs pointing to each player's table.
6. **Value types used as reference modes**: become the PK column type/name on the entity's table.
7. **Value types in non-identifying roles**: become FK columns typed by the value type.

### B3. DDL Renderer

New file `packages/core/src/mapping/renderers/ddl.ts`:

Takes a `RelationalSchema` and produces a SQL DDL string (CREATE TABLE statements with PKs, FKs, NOT NULL).

### B4. Tests

- Unit tests for each mapping pattern (binary/unary/ternary, uniqueness/mandatory combinations)
- Integration test: build a model with ModelBuilder, map it, verify table/column/key structure
- DDL renderer output tests
- Edge cases: objectified fact types, multiple fact types sharing an entity

### B5. Export from index.ts

Export `RelationalSchema`, `RelationalMapper`, `renderDdl` (or similar).

---

## Implementation Order

1. **A1** - Phase 2 constraint classes + type guards
2. **A4 (schema only)** - Update JSON schema for new constraints
3. **A2** - Validation rules for Phase 2 constraints
4. **A3** - Verbalization patterns for Phase 2 constraints
5. **A4 (serializer)** - Serialization round-trip for Phase 2 constraints
6. **A5** - ModelBuilder extensions
7. **A6** - Exports
8. **B1** - RelationalSchema data model
9. **B2** - RelationalMapper
10. **B3** - DDL renderer
11. **B4** - Mapping tests
12. **B5** - Exports

Tests are written alongside each step, not batched at the end.
