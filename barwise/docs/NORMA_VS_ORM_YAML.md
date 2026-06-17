# NORMA XML vs `.orm.yaml`

A comparison of two ways to serialize an ORM 2 model: the NORMA `.orm`
XML format produced by the Natural ORM Architect (NORMA) Visual Studio
add-in, and barwise's native `.orm.yaml` format.

The short version: **they are not competing for the same job.** NORMA XML
is an interchange and persistence format for a graphical editor;
`.orm.yaml` is an authoring-and-reasoning format for humans and language
models. Against the full ORM 2 standard, NORMA is the more complete
reference. Against the authoring, version-control, and AI workflows
barwise targets, `.orm.yaml` is the better fit. barwise treats NORMA as
an import source rather than a peer format, and that is a deliberate
choice this document explains.

This is a conceptual comparison. The concrete import behaviour and its
current gaps are tracked under epic `barwise-5t9`; see
[Known import gaps](#known-import-gaps).

---

## Design intent

|                   | NORMA XML (`.orm`)                            | barwise (`.orm.yaml`)                |
| ----------------- | --------------------------------------------- | ------------------------------------ |
| Primary author    | The NORMA GUI                                 | A human or an LLM                    |
| Optimised for     | Tool round-trip, full standard, diagram state | Reading, editing, diffing, reasoning |
| Identity          | GUIDs                                         | UUIDs                                |
| Layout/geometry   | Persisted in-file                             | Stored separately, semantics-first   |
| Derived artifacts | OIAL, relational bridge persisted in-file     | Recomputed deterministically by core |
| Verbosity         | High (namespaced, separated elements)         | Low (inline, dense)                  |

NORMA is effectively the reference implementation of ORM 2 -- Terry
Halpin's own ecosystem -- and its XML carries layers barwise does not
model: the ORM Abstraction Layer (`oial:`), the data-language
intermediate, the conceptual-to-relational bridge
(`ormtooial:` / `oialtocdb:`), and full diagram geometry. barwise reads
NORMA as a _purely semantic_ import and drops all of that. Most of what
it drops is tool state or a derived artifact, not conceptual ORM: in
barwise, mapping and DDL are recomputed deterministically from the
conceptual model rather than persisted.

---

## The same fact, side by side

A single binary fact type -- "Customer places Order" -- with a uniqueness
and a mandatory constraint.

### NORMA XML

```xml
<orm:Fact id="_ft_places" _Name="Customer places Order">
  <orm:FactRoles>
    <orm:Role id="_r_cust_places" Name="places" _Multiplicity="ZeroToOne">
      <orm:RolePlayer ref="_et_customer" />
    </orm:Role>
    <orm:Role id="_r_order_placed" Name="is placed by" _Multiplicity="ExactlyOne">
      <orm:RolePlayer ref="_et_order" />
    </orm:Role>
  </orm:FactRoles>
  <orm:ReadingOrders>
    <orm:ReadingOrder id="_ro_1">
      <orm:Readings>
        <orm:Reading><orm:Data>{0} places {1}</orm:Data></orm:Reading>
      </orm:Readings>
      <orm:RoleSequence>
        <orm:Role ref="_r_cust_places" />
        <orm:Role ref="_r_order_placed" />
      </orm:RoleSequence>
    </orm:ReadingOrder>
  </orm:ReadingOrders>
  <orm:InternalConstraints>
    <orm:UniquenessConstraint ref="_uc_places" />
    <orm:MandatoryConstraint ref="_mc_places" />
  </orm:InternalConstraints>
</orm:Fact>
<!-- ...and, elsewhere in the document, the constraints themselves: -->
<orm:UniquenessConstraint id="_uc_places" IsInternal="true">
  <orm:RoleSequence><orm:Role ref="_r_cust_places" /></orm:RoleSequence>
</orm:UniquenessConstraint>
```

### `.orm.yaml`

```yaml
fact_types:
  - id: "ft-places"
    name: "Customer places Order"
    roles:
      - id: "r-cust-places"
        player: "ot-customer"
        role_name: "places"
      - id: "r-order-placed"
        player: "ot-order"
        role_name: "is placed by"
    readings:
      - "{0} places {1}"
      - "{1} is placed by {0}"
    constraints:
      - type: "internal_uniqueness"
        roles: ["r-cust-places"]
      - type: "mandatory"
        role: "r-order-placed"
```

Both are ID-referenced -- the YAML is not "name-based and therefore
fragile-free." The differences that matter are **density**, **locality**
(the constraint sits on the fact it constrains, rather than as a
separate top-level element referenced by `ref`), and **readability**.

---

## Comparison by axis

### Fidelity to the ORM 2 standard

NORMA wins on raw coverage, by design. On the _conceptual_ core of ORM 2
the two are close to parity: both cover entity and value types, n-ary
fact types, objectification, subtyping with exclusive/exhaustive
partitions, and the Phase 1 and Phase 2 constraints (uniqueness
internal/external, mandatory, disjunctive mandatory, exclusion,
exclusive-or, subset, equality, ring with all seven ring types,
frequency, value).

Where NORMA is more faithful to the _full_ standard, most of the
difference is either tool state (diagram geometry) or a derived artifact
(OIAL, the relational bridge) that barwise recomputes rather than
stores. The genuine _conceptual_ gaps -- value ranges, derived fact
types, deontic modality, object cardinality, independent object types,
join-path constraints -- are real and tracked; see
[Known import gaps](#known-import-gaps).

### NORMA's schema vs NORMA's tooling

A cited review of the ORM 2 reference (Halpin & Morgan; Halpin's papers)
against NORMA found that `ORM2Core.xsd` is a faithful, near-superset
realization of the book -- so the metamodel itself misses little. The
genuine shortfalls are in NORMA's _tooling_ completeness, in two spots:
deontic modality (NORMA tags a single main modal operator and does not
handle nested or compound modal formulae) and formal derivation rules
(rich formal-rule entry was historically "under development"). For those
two constructs barwise should design against the book, not NORMA's
implementation, so it does not inherit NORMA's limits. ORM 2's _method_
layer -- CSDP, schema transformations, Rmap -- is algorithms over models,
not metamodel constructs, so "missing" does not apply to it.

### Human and LLM authoring

This is where `.orm.yaml` pulls clearly ahead, and it is the reason
barwise's native format is YAML rather than the standard's XML.

- **Token efficiency.** The same fact is roughly ten readable lines of
  YAML versus ~25 lines of namespaced XML. For retrieval and for
  stuffing a model into an agent's context window, every token of
  `oial:` / geometry is noise.
- **Generation robustness.** In NORMA a constraint is a top-level
  element the fact references by `ref`; a model that generates or edits
  it must keep an id graph consistent across distant elements -- a
  classic failure mode. In `.orm.yaml` the constraint is an inline,
  discriminated-union object on the fact, far more robust under
  generation.
- **Verbalization metadata is first-class.** Object and fact types carry
  inline `definition`, plus `aliases` (stakeholder synonyms) and
  `domain_context`. That is exactly the ubiquitous-language signal an
  LLM needs to map prose to model and back, and it is the spine of
  barwise's transcript-extraction and `verbalize` paths.
- **Clean diffs.** YAML diffs line-by-line in code review; an XML
  re-serialization from a GUI churns attributes and ordering.

### Tooling and determinism

barwise's core is pure and deterministic: validation, verbalization,
relational mapping, diff, and query are same-input/same-output. Because
mapping and DDL are _recomputed_ from the conceptual model, they are
never stale and never need to be stored. NORMA instead persists those
derived layers in the file, which is the right call for a stateful
editor and the wrong call for a version-controlled, tool-composed
pipeline.

---

## Conceptual coverage matrix

What each format can represent today. "Importer" is whether barwise's
NORMA importer carries the construct into `.orm.yaml`.

| ORM 2 construct                       | NORMA XML | `.orm.yaml`   | Importer       |
| ------------------------------------- | --------- | ------------- | -------------- |
| Entity / value types                  | Yes       | Yes           | Yes            |
| Reference modes                       | Yes       | Yes           | Yes            |
| Unary / binary / n-ary facts          | Yes       | Yes           | Yes            |
| Readings (all role orders)            | Yes       | Yes           | Yes            |
| Objectification                       | Yes       | Yes           | Yes            |
| Subtyping (+ partition)               | Yes       | Yes           | Yes            |
| Internal / external uniqueness        | Yes       | Yes           | Yes            |
| Preferred identifier                  | Yes       | Yes           | Yes            |
| Mandatory / disjunctive mandatory     | Yes       | Yes           | Yes            |
| Exclusion / exclusive-or              | Yes       | Yes           | Yes            |
| Subset / equality                     | Yes       | Yes           | Yes            |
| Ring (7 types)                        | Yes       | Yes           | Yes            |
| Frequency (single role)               | Yes       | Yes           | Yes            |
| Value constraint (enumerated)         | Yes       | Yes           | Yes            |
| Conceptual data types                 | Yes       | Yes           | Yes            |
| Value constraint (ranges/open bounds) | Yes       | No            | No (dropped)   |
| Derived fact types / derivation rules | Yes       | No            | No             |
| Deontic vs alethic modality           | Yes       | No            | No             |
| Object cardinality                    | Yes       | No            | No             |
| Independent object types              | Yes       | No            | No             |
| Join-path set/ring constraints        | Yes       | No            | No             |
| Default values                        | Yes       | No            | No             |
| Multi-role frequency                  | Yes       | No            | No             |
| Value-comparison constraints          | Yes       | No            | No             |
| Model / element notes                 | Yes       | No            | No             |
| Modeler queries / subqueries          | Yes       | No            | No             |
| Dynamic (state-transition) rules      | Yes       | No            | No             |
| Diagram geometry                      | Yes       | Separate file | No (by design) |

---

## Known import gaps

barwise's `.orm.yaml` is lossy by design relative to NORMA, but a few of
those omissions are genuine _conceptual_ ORM 2 constructs rather than
tool state. They were catalogued in an evidence-based audit tracked under
epic **`barwise-5t9`**. The highest-impact item:

- **Value ranges are silently dropped on import** (`barwise-5t9.1`). The
  metamodel's value constraint is enumeration-only, and the importer
  keeps a value only when `MinValue === MaxValue`, so a NORMA range such
  as `[1..10]` or `>= 18` is discarded with no warning. This is both a
  metamodel-expressiveness gap and an import data-loss bug.

Other tracked conceptual gaps: derived fact types and derivation rules
(`5t9.2`), deontic vs alethic modality (`5t9.3`), object cardinality
constraints (`5t9.4`), independent object types (`5t9.5`), set-comparison
and ring constraints over join paths (`5t9.6`), default values
(`5t9.7`), and multi-role frequency constraints (`5t9.8`).

A later pass cross-referenced the authoritative `ORM2Core.xsd` schema (in
`ormsolutions/NORMA`) against the metamodel, catching constructs the
import-grounded audit could not see because the importer never references
them: value-comparison constraints (`5t9.9`), the role-path / join-rule
model that underpins join constraints, derivation, and queries
(`5t9.10`), modeler-defined queries and subqueries (`5t9.11`), model and
element notes (`5t9.12`), and dynamic state-transition rules (`5t9.13`).

Note: the import summary in `IMPORT_EXPORT.md` describes the NORMA
mapping as "nearly lossless." That holds for the common conceptual core,
but the value-range case above is a silent loss rather than a warned one;
treat `barwise-5t9` as the precise picture until those issues close.

---

## When to use which

Use **NORMA XML** when you need the full ORM 2 standard, diagram
geometry, or interoperability with the Halpin/NORMA toolchain -- it is
the authoritative, GUI-bound, archival format.

Use **`.orm.yaml`** for authoring, version control, deterministic
tooling, and every AI workflow (generation, editing, verbalization,
grounding, agent pipelines) -- it is the human- and LLM-legible working
format, lossy by design.

In practice: import a NORMA model once to bring it into barwise, then
treat `.orm.yaml` as the source of truth.

---

## Toward two-way interop

barwise imports NORMA but does not yet export it. Making the two formats
a genuine bridge -- so an open-source project can hand a model back to a
NORMA user without loss -- means closing the conceptual gaps above and
then adding a NORMA exporter and round-trip tests. That export and
round-trip work is tracked separately (see `barwise-cb6` and
`barwise-e3g`); the conceptual-coverage prerequisites are `barwise-5t9`.
