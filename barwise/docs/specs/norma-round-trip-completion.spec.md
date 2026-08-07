# NORMA round-trip completion: exclusive-or, value comparison, defaults, populations

Status: WS1-WS3 implemented 2026-08-07 (exclusive-or coupled-pair
round-trip with one-sided-coupler tolerance; value-comparison wiring
with the full operator map; value-type default values). Open: WS4
(sample populations), provisional pending a NORMA-authored populated
fixture.
Created: 2026-08-07
Last-updated: 2026-08-07
Tracking: NORMA_VS_ORM_YAML.md feature audit (exclusive-or defect,
value-comparison wiring, sample populations); follows
norma-export.spec.md (archived candidate once this lands);
barwise-5t9.7 / 5t9.9 residue

## Principle

Composability says the NORMA connector's value is the fidelity of its
boundary: every construct both metamodels can represent should cross it
unchanged. Four constructs both sides model today do not cross --
exclusive-or degrades to plain exclusion (a defect: "exactly one"
silently weakens to "at most one"), and value-comparison constraints,
default values, and sample populations drop entirely. All four are
wiring gaps in `@barwise/formats`; none needs a metamodel change. This
spec closes them, grounded against `ORM2Core.xsd` (fetched from
`ormsolutions/NORMA` master, 2026-08-07).

It also corrects a false claim this project has been carrying: the
norma-export spec and the NORMA_VS_ORM_YAML audit state that NORMA has
"no schema seat" for default values. The XSD says otherwise --
`DefaultValue` / `InvariantDefaultValue` elements plus a `DefaultState`
attribute sit on both the ValueType element and the Role element. The
claim is corrected by WS3, which wires the seat.

## Scope

In scope (all in `@barwise/formats`, `src/norma/`):

- When a model containing an `exclusive_or` constraint is exported, the
  system shall emit NORMA's coupled pair -- an `ExclusionConstraint` and
  a `MandatoryConstraint` (`IsSimple="false"`) carrying mutual
  `ExclusiveOrMandatoryConstraint` / `ExclusiveOrExclusionConstraint`
  coupler refs.
- When an imported NORMA `MandatoryConstraint` carries an
  `ExclusiveOrExclusionConstraint` coupler, the system shall map the
  pair to a single `exclusive_or` constraint and shall not emit the
  exclusion or disjunctive-mandatory halves separately.
- When a model containing a `value_comparison` constraint is exported,
  the system shall emit a NORMA `ValueComparisonConstraint` with the
  operator mapped `<`/`<=`/`=`/`<>`/`>=`/`>` to
  `LessThan`/`LessThanOrEqual`/`Equal`/`NotEqual`/
  `GreaterThanOrEqual`/`GreaterThan`, and the importer shall map it
  back.
- When a value-type object with a `defaultValue` is exported, the
  system shall emit the NORMA `DefaultValue` element on the ValueType,
  and the importer shall read it back.
- When a model with populations is exported, the system shall emit
  NORMA instance collections (`ValueTypeInstance`,
  `EntityTypeInstance`, `FactTypeInstance` with role-instance
  declarations on the Role elements), and the importer shall flatten
  NORMA instance collections back into per-fact-type populations of
  role-id -> value maps.

Out of scope: modeler queries and dynamic rules (metamodel gaps, not
wiring; a future metamodel spec), multi-range cardinality (the
single-bound collapse stands), role-level `DefaultValue` (barwise
models defaults on the object type, not the role; revisit only if the
metamodel grows role defaults).

Candidate follow-up (owner-flagged, undecided): NORMA `Note` elements
(model-level and element-level). barwise has no notes seat today --
`definition` already round-trips, so the open design question is where
imported notes would live (definition text, the annotation system, or
a new metamodel seat). File as its own small spec if pursued; not part
of this spec's workstreams.

## Inventory

| Module                              | Current state                                                                                   | Verdict                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| `norma/NormaXmlTypes.ts`            | No coupler, comparison, default, or instance types                                              | Extend                               |
| `norma/NormaXmlParser.ts`           | Ignores couplers, ValueComparison, defaults, instances                                          | Extend                               |
| `norma/NormaXmlWriter.ts`           | `exclusive_or` emits exclusion half only                                                        | Fix WS1; extend WS2-4                |
| `norma/NormaXmlSerializer.ts`       | No emission for the four constructs                                                             | Extend                               |
| `norma/mapping/constraintPasses.ts` | `addDisjunctiveMandatoryConstraints`, `addMultiFactTypeConstraints` re-emit the pair separately | Re-couple in WS1; add comparison WS2 |
| `norma/mapping/objectTypes.ts`      | Maps cardinality, value constraints, independence                                               | Add defaults WS3                     |
| `norma/NormaToOrmMapper.ts`         | No population pass                                                                              | Add WS4 pass                         |

`@barwise/core` is untouched: `exclusive_or`,
`ValueComparisonConstraint`, `ObjectType.defaultValue`, and
`Population` all exist. The CLI, MCP, and VS Code surfaces inherit the
fidelity through the registry with no changes.

## Target architecture

The NORMA document model (`NormaXmlTypes.ts`) gains four seats, each
mirroring an XSD-verified encoding:

```ts
interface NormaConstraintBase {
  // WS1: on the exclusion + mandatory constraint variants
  exclusiveOrPairRef?: string;
}
interface NormaValueComparisonConstraint {
  type: "value_comparison";
  operator:
    | "LessThan"
    | "LessThanOrEqual"
    | "Equal"
    | "NotEqual"
    | "GreaterThanOrEqual"
    | "GreaterThan";
  roleRefs: readonly string[]; // two roles, RoleSequence order
}
interface NormaValueType {
  defaultValue?: string; // WS3: DefaultValue element
}
interface NormaInstances {
  // WS4: per-type instance collections; role-instance declarations
  // (id + object-instance ref) live on the owning NormaRole
}
```

## Alternatives considered

- **Collapse xor on export instead of import** (emit one synthetic
  constraint kind). Loses NORMA compatibility -- NORMA has no single
  xor element; the coupled pair is its native encoding. The pair with
  couplers is what NORMA itself writes.
- **Model populations as NORMA does (instance graph) in core.**
  Rejected: barwise's flat role-id -> value map is the deliberate,
  LLM-legible population shape, and validation consumes it. The
  connector synthesizes the graph on export and flattens on import --
  exactly the connector convention (I/O and format complexity stay
  outside core).
- **Defer default values again.** The claim that NORMA had no seat was
  the only reason for deferral, and it is false. Wiring is a few lines
  per side.

## Workstreams (each independently shippable)

### 1. Exclusive-or re-coupling (defect fix)

Writer: `case "exclusive_or"` emits the exclusion (roleSequences from
`roleIds`) plus a disjunctive `MandatoryConstraint`, each carrying the
coupler ref to the other. Serializer: emit
`orm:ExclusiveOrMandatoryConstraint ref` inside the exclusion and
`orm:ExclusiveOrExclusionConstraint ref` inside the mandatory. Parser:
capture both coupler refs. Mapper: in
`addDisjunctiveMandatoryConstraints`, a mandatory carrying a coupler
maps (with its paired exclusion) to one `exclusive_or`; the paired
exclusion is skipped in `addMultiFactTypeConstraints`. Round-trip test:
`exclusive_or` in, `exclusive_or` out; NORMA-authored pair in, single
`exclusive_or` out. Removes the "one open defect" paragraph from
NORMA_VS_ORM_YAML.md.

### 2. Value-comparison wiring

Writer/serializer: `value_comparison` -> `orm:ValueComparisonConstraint`
(top-level set constraint, `Operator` attribute, two-role
`RoleSequence`). Parser/mapper: inverse, attaching to the fact type
that owns both roles. Operator map is total in both directions; NORMA's
`Undefined` operator (a NORMA validation-error state) does not import
-- the constraint is skipped with the other unmappable states.

### 3. Default values

Writer/serializer: `ObjectType.defaultValue` on a value type ->
`DefaultValue` element on the NORMA ValueType. Parser/mapper: inverse.
Entity-type defaults have no NORMA object-type seat (NORMA's second
seat is the Role) and stay barwise-side, documented. Corrects the
false "no schema seat" claim in norma-export.spec.md and
NORMA_VS_ORM_YAML.md.

### 4. Sample populations (largest; provisional pending a NORMA-authored populated fixture)

Export: for each population, synthesize the instance graph --
`ValueTypeInstance` elements (distinct values per value type),
`EntityTypeInstance` elements with identifying role instances,
role-instance declarations (`id` + object-instance `ref`) on each
`orm:Role`, and `FactTypeInstance` elements whose
`FactTypeRoleInstance` refs point at the role instances. Import:
resolve refs back to value strings and flatten each fact type's
instances to `Population` role-value maps. The encoding is
XSD-grounded; verify element ordering against a real NORMA-authored
populated model before landing (the standing NORMA-mapping caution),
and add such a fixture to `tests/fixtures/`.

## API and migration impact

None outside `@barwise/formats`: no public core API changes, no
registry changes, no CLI/MCP surface changes. Downstream packages see
only higher-fidelity NORMA files.

## Open decisions (for review)

- **Unary-role population encoding (WS4).** NORMA populates unary
  roles via `EntityTypeUnaryRoleInstance` on the entity instance,
  not via fact instances. Options: (a) wire it symmetrically with
  binary+ populations; (b) defer unary populations to a follow-up and
  document. Recommend (a) if the fixture confirms the encoding
  cheaply, else (b) -- the spec treats (b) as acceptable because unary
  populations are rare in practice.
- **Where an imported value-comparison attaches when its two roles
  span fact types via a join path (`SetConstraintWithJoinType`).**
  barwise's constraint is same-fact-type only (cross-fact comparison
  is deferred to barwise-5t9.10). Recommend: import only the
  no-join-path case; a join-path comparison is skipped like other
  unmappable constructs, and noted in the audit.

## Risks and testing

- Each workstream keeps the full suite green and lands separately;
  `NormaConstructRoundTrip.test.ts` grows a case per construct
  (forward: barwise -> NORMA -> barwise; WS1 also backward: a
  NORMA-authored coupled pair collapses to one constraint).
- The four-fixture RT-B check (import -> export -> re-import ->
  `barwise diff` clean) must stay clean; populations add a fifth,
  NORMA-authored, populated fixture.
- Risk: imported models that previously produced exclusion +
  disjunctive-mandatory pairs will now produce `exclusive_or` -- a
  semantic upgrade, but any stored `.orm.yaml` regenerated from NORMA
  sources will diff. Accepted; the diff is the fix.

## Non-goals

- No metamodel changes; no new constraint kinds, no population shape
  change.
- No NORMA `Note`, query, or dynamic-rule support.
- No change to the deliberate normalizations (data-type representative
  tags, cardinality first-range collapse, derivation-default
  omission).
