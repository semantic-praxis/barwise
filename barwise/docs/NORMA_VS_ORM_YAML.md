# NORMA XML vs `.orm.yaml`

A comparison of two ways to serialize an ORM 2 model: the NORMA `.orm`
XML format produced by the Natural ORM Architect (NORMA) Visual Studio
add-in, and barwise's native `.orm.yaml` format.

The short version: **they are not competing for the same job.** NORMA XML
is an interchange and persistence format for a graphical editor;
`.orm.yaml` is an authoring-and-reasoning format for humans and language
models. Against the full ORM 2 standard, NORMA is the more complete
reference. Against the authoring, version-control, and AI workflows
barwise targets, `.orm.yaml` is the better fit. barwise treats
`.orm.yaml` as the working source of truth and NORMA as a two-way
interchange peer: models import from NORMA and export back, and the
conceptual core round-trips without semantic loss.

This is a conceptual comparison. The precise round-trip behaviour is
pinned by the `@barwise/formats` test suite (`NormaExportFormat`,
`NormaConstructRoundTrip`); the residual differences are catalogued in
[the feature audit](#feature-audit-where-the-formats-differ) below.

---

## Design intent

|                   | NORMA XML (`.orm`)                            | barwise (`.orm.yaml`)                |
| ----------------- | --------------------------------------------- | ------------------------------------ |
| Primary author    | The NORMA GUI                                 | A human or an LLM                    |
| Optimised for     | Tool round-trip, full standard, diagram state | Reading, editing, diffing, reasoning |
| Identity          | GUIDs                                         | UUIDs (UUIDv7, creation-ordered)     |
| Layout/geometry   | Persisted in-file, fully styled               | Named layouts, positions-first       |
| Derived artifacts | OIAL, relational bridge persisted in-file     | Recomputed deterministically by core |
| Verbosity         | High (namespaced, separated elements)         | Low (inline, dense)                  |

NORMA is effectively the reference implementation of ORM 2 -- Terry
Halpin's own ecosystem -- and its XML carries layers barwise does not
model: the ORM Abstraction Layer (`oial:`), the data-language
intermediate, and the conceptual-to-relational bridge
(`ormtooial:` / `oialtocdb:`). barwise reads NORMA as a semantic-plus-
geometry import and drops those derived layers deliberately: in barwise,
mapping and DDL are recomputed deterministically from the conceptual
model rather than persisted, so they are never stale and never need to
round-trip.

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

On the _conceptual_ core of ORM 2 the two formats are at parity, and
that core round-trips: entity and value types, reference schemes, n-ary
fact types, readings, objectification, subtyping with
exclusive/exhaustive partitions, every Phase 1/2 constraint (uniqueness
internal/external, mandatory, disjunctive mandatory, exclusion, subset,
equality, all seven ring types, frequency including multi-role, value
constraints including ranges and open bounds), join-path set
constraints, deontic modality, derivation rules, object-type and
unary-role cardinality, independent object types, conceptual data
types, and diagram positions. One constraint type degrades:
exclusive-or (see the audit).

Where NORMA is more faithful to the _full_ standard, the difference is
either a derived artifact barwise recomputes (OIAL, the relational
bridge) or one of a handful of constructs barwise does not yet model or
wire -- dynamic rules, modeler queries, element notes, sample-population
instances, value-comparison wiring. Each is examined in
[the feature audit](#feature-audit-where-the-formats-differ).

### NORMA's schema vs NORMA's tooling

A cited review of the ORM 2 reference (Halpin & Morgan; Halpin's papers)
against NORMA found that `ORM2Core.xsd` is a faithful, near-superset
realization of the book -- so the metamodel itself misses little. The
genuine shortfalls are in NORMA's _tooling_ completeness, in two spots:
deontic modality (NORMA tags a single main modal operator and does not
handle nested or compound modal formulae) and formal derivation rules
(rich formal-rule entry was historically "under development"). For those
two constructs barwise designs against the book, not NORMA's
implementation: barwise's modality is likewise a single operator per
constraint, and derivation rules carry an informal expression body --
both map cleanly onto what NORMA can actually persist. ORM 2's _method_
layer -- CSDP, schema transformations, Rmap -- is algorithms over
models, not metamodel constructs, so "missing" does not apply to it.

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

What each format can represent today, and whether the construct survives
the NORMA round-trip (import and export are symmetric unless noted).

| ORM 2 construct                       | NORMA XML        | `.orm.yaml` | Round-trip          |
| ------------------------------------- | ---------------- | ----------- | ------------------- |
| Entity / value types                  | Yes              | Yes         | Yes                 |
| Reference modes                       | Yes              | Yes         | Yes                 |
| Unary / binary / n-ary facts          | Yes              | Yes         | Yes                 |
| Readings (all role orders)            | Yes              | Yes         | Yes                 |
| Objectification                       | Yes              | Yes         | Yes                 |
| Subtyping (+ partition)               | Yes              | Yes         | Yes                 |
| Internal / external uniqueness        | Yes              | Yes         | Yes                 |
| Preferred identifier                  | Yes              | Yes         | Yes                 |
| Mandatory / disjunctive mandatory     | Yes              | Yes         | Yes                 |
| Exclusion                             | Yes              | Yes         | Yes                 |
| Exclusive-or                          | Yes (as pair)    | Yes         | Degrades            |
| Subset / equality                     | Yes              | Yes         | Yes                 |
| Ring (7 types)                        | Yes              | Yes         | Yes                 |
| Frequency (single and multi-role)     | Yes              | Yes         | Yes                 |
| Value constraint (enumerated)         | Yes              | Yes         | Yes                 |
| Value constraint (ranges/open bounds) | Yes              | Yes         | Yes                 |
| Conceptual data types                 | Yes              | Yes         | Yes (normalized)    |
| Derived fact types / derivation rules | Yes              | Yes         | Yes (informal body) |
| Deontic vs alethic modality           | Yes              | Yes         | Yes                 |
| Object-type cardinality               | Yes (multirange) | Yes         | Yes (first range)   |
| Unary-role cardinality                | Yes (multirange) | Yes         | Yes (first range)   |
| Independent object types              | Yes              | Yes         | Yes                 |
| Join-path set constraints             | Yes              | Yes         | Yes                 |
| Diagram geometry                      | Yes (styled)     | Positions   | Positions exact     |
| Value-comparison constraints          | Yes              | Yes         | No (unwired)        |
| Default values                        | No schema seat   | Yes         | No (NORMA-side gap) |
| Sample populations                    | Yes              | Yes         | No (unwired)        |
| Model / element notes                 | Yes              | Annotations | Definitions only    |
| Modeler queries / subqueries          | Yes              | No          | No                  |
| Dynamic (state-transition) rules      | Yes              | No          | No                  |

---

## Feature audit: where the formats differ

The matrix rows above the line all round-trip; this audit covers the
rest -- each residual difference, what the feature is worth to a
modeler, and what actually happens at the boundary today.

### Diagram geometry

_Expected value:_ a diagram is the shared artifact domain experts
actually review; preserving a modeler's spatial arrangement preserves
the mental map they built, so a model handed between tools does not
have to be re-laid-out from scratch.

NORMA persists fully styled shapes (bounds, expansion state, colors);
barwise persists named layouts with positions. On round-trip, positions
survive exactly (inch/pixel conversion at 96 px per inch); shape sizes
are re-estimated and styling is dropped. A barwise-exported model opens
in NORMA with every element where the modeler left it.

### Sample populations

_Expected value:_ populations are how ORM 2 models get checked against
reality -- Halpin's method validates a constraint by trying concrete
examples against it, and a stored population turns that from a
whiteboard exercise into an executable test.

Both metamodels carry them: NORMA persists instance collections, and
barwise's populations are first-class, driving deterministic population
validation and counterexample generation. The NORMA importer and
exporter simply do not wire them yet, so NORMA sample data drops on
import and barwise populations are absent from exports. This is the
highest-value unwired feature, precisely because both sides already
model it.

### Exclusive-or

_Expected value:_ "exactly one of these holds" ("each Person is
employed or retired, but not both") is a stronger claim than exclusion
alone; collapsing it to "at most one" silently legalizes the
neither-case.

NORMA has no single xor element -- it encodes the constraint as a
coupled pair, an exclusion plus a disjunctive mandatory. barwise's
writer currently emits only the exclusion half of an `exclusive_or`,
and the importer does not re-couple an exclusion/disjunctive-mandatory
pair back into one constraint. The result (verified empirically): a
barwise `exclusive_or` round-trips as a plain `exclusion` -- the
mandatory half is lost. The fix is known shape on both sides (emit the
pair on export; detect the coupled pair on import) and is the one
open defect in the constraint round-trip.

### Value-comparison constraints

_Expected value:_ comparisons across roles ("end date must be on or
after start date") are among the most common real-world business rules;
without them the rule lives in prose or in application code, invisible
to validation.

Both metamodels model them -- barwise added
`ValueComparisonConstraint` in the constraint union -- but the NORMA
parser and writer have no wiring for NORMA's `ValueComparisonConstraint`
element, so they drop in both directions. A wiring-only gap, like unary
cardinality was before it landed.

### Default values

_Expected value:_ a declared default ("Status defaults to 'active'")
carries straight into relational mapping as a column default, keeping
schema generation faithful to stakeholder intent.

The direction of this gap is the reverse of the others: barwise models
default values on object types, but NORMA's `ORM2Core.xsd` has no seat
for them at all. A barwise default is silently absent from a NORMA
export and cannot arrive via import. Permanent unless NORMA's schema
grows the construct; nothing to do on barwise's side.

### Model and element notes

_Expected value:_ rationale ("we model this as a party, not a person,
because...") is the knowledge that evaporates first; notes anchor it to
the element it explains.

The formats split this concept. Informal `definition` text on object
and fact types round-trips both ways (NORMA `Definitions`). But NORMA's
separate `Note` elements drop on import, and barwise's TODO/NOTE
annotation system -- designed for authoring workflow, propagated into
exports as comments -- has no NORMA seat. Definitions are the durable
common ground.

### Modeler queries and subqueries

_Expected value:_ a persisted query is a saved question against the
model ("which customers placed no orders this year?"), reusable as a
report or a derived view definition.

NORMA persists modeler-defined queries over its role-path apparatus.
barwise deliberately does not persist queries in the model; its
symbolic query capability (`barwise query`) is a runtime tool, and
derived views belong to derivation rules. Imported NORMA queries drop.
If persisted queries earn a seat in barwise's metamodel, the role-path
model they need already exists.

### Dynamic (state-transition) rules

_Expected value:_ rules about change over time ("an order may move from
'placed' to 'shipped' but never back") complete the business-rule
picture that static constraints cannot express.

NORMA's schema carries dynamic rules; barwise's metamodel is static-only
today, so they drop on import. This is the one remaining category where
NORMA can express a genuine conceptual rule barwise cannot hold at all.

### Normalizations (same meaning, different bytes)

Three constructs round-trip semantically but not byte-identically, by
design:

- **Conceptual data types.** Several NORMA type tags collapse to one
  conceptual name on import (`FixedLengthText` and `VariableLengthText`
  are both `text`); export picks one representative tag per name. The
  conceptual name, length, and scale are what round-trip.
- **Cardinality multi-ranges.** NORMA allows a range list ("0..5 or
  10..20"); barwise's bound is a single min/max, so the first NORMA
  range wins on import. Applies to both object-type and unary-role
  cardinality.
- **Derivation attribute defaults.** Export omits NORMA's default
  attribute values (`FullyDerived`, `NotStored`), so a model that
  explicitly stated a default re-imports with the default unstated --
  same semantics, absent attribute.

---

## When to use which

Use **NORMA XML** when you need the full ORM 2 standard surface,
styled diagrams, or interoperability with the Halpin/NORMA toolchain --
it is the authoritative, GUI-bound, archival format.

Use **`.orm.yaml`** for authoring, version control, deterministic
tooling, and every AI workflow (generation, editing, verbalization,
grounding, agent pipelines) -- it is the human- and LLM-legible working
format.

In practice: import a NORMA model to bring it into barwise, treat
`.orm.yaml` as the source of truth, and export back to NORMA whenever a
NORMA user needs the model -- the conceptual core survives the loop.

---

## Round-trip status

Two round-trips, per the norma-export spec:

- **RT-A, `model -> NORMA -> model`.** Lossless for everything
  `.orm.yaml` can represent except default values (no NORMA seat),
  barwise annotations, and the exclusive-or degradation above. Pinned
  by the `@barwise/formats` round-trip tests over the fixture corpus
  and the WS3 construct suite.
- **RT-B, `NORMA -> model -> NORMA`.** Semantically lossless for the
  conceptual core -- verified by importing each NORMA fixture,
  exporting, re-importing, and diffing (`barwise diff` reports no
  changes). A foreign NORMA file loses the unwired/unmodeled constructs
  in the audit above at the _import_ step, plus the derived OIAL and
  relational layers barwise recomputes; the exporter faithfully
  re-emits everything that survives.

One check remains manual: loading a barwise-exported `.orm` in the
NORMA add-in itself (tracked in the manual test plan; needs a NORMA
install).
