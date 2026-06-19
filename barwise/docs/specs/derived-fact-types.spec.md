# Derived fact types and derivation rules (informal, v1)

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-19
Last-updated: 2026-06-19
Tracking: barwise-5t9.2, barwise-5t9 (epic),
docs/adr/0001-metamodel-evolution-policy.md, docs/NORMA_VS_ORM_YAML.md

## Principle

Derivation is metadata stored as data, never a computation core runs --
which is exactly why it fits. ORM 2 lets a fact type (or subtype) be
_derived_: its population follows from a rule rather than being asserted.
barwise has no derivation concept today, so a modeler cannot say
"TotalPrice is derived from Quantity \* UnitPrice" or "Person is an Adult
iff Person has Age >= 18", and NORMA models that carry derivation lose that
intent on import. ADR-0001 filter 3 is explicit: "Rules are stored as data,
never executed by core. This admits derivation rules as structure." That is
the whole design -- v1 records the rule as text plus its taxonomy, verbalizes
it, and structurally validates it; it never parses or evaluates it. Core
stays pure (determinism-in-core); evaluation, if it ever arrives, is an
outer-layer concern.

The honest cut line, per ADR-0001 filter 2 (_verbalizable_, _inline and
local_) and the cited deep research: model the _taxonomy_ faithfully now,
the _formal rule grammar_ never in v1. NORMA's tool implements formal
role-calculus derivation but its rich-rule entry was "under development" and
its formal coverage is a first-order fragment; the book's taxonomy is the
stable target, so design against it.

## Should the rule be informal text or a formal grammar? (resolved: informal text)

Informal text. A derivation rule in v1 is a free-text string (natural
language or hand-written FORML), carried verbatim. A formal grammar -- a
parsed expression language over role paths -- is the Tier-3 fork
(barwise-5t9.10), and a formal rule cannot even be _expressed_ without the
role-path model it depends on. An informal string is verbalizable (it _is_
the verbalization), inline and local (a field on the fact type), and
deterministic (stored, never executed). A reserved `is_formal` flag
(absent/false in v1) marks the seam where a parsed form would later attach,
so adopting formal rules is an additive change, not a reinterpretation of
existing data.

## Should asserted/derived/semiderived and storage be one enum or two axes? (resolved: two axes)

Two orthogonal axes, as the book (and the cited deep-research correction)
require. The definitional axis is asserted vs derived (`*`, fully defined by
the rule) vs semiderived (`+`, a partial/conditional definition); the
storage axis is derive-on-request (`*`) vs derived-and-stored (`**`). These
are independent -- a semiderived fact can be stored, a fully derived fact can
be on-request -- so collapsing them into one flat enum
(`asserted | derived | semiderived | derived_and_stored`) would conflate a
completeness property with an eager/lazy property and make the illegal pair
"asserted + stored" representable. Two fields keep them separate. Asserted is
the default and is represented by the _absence_ of a derivation, so the
definitional field only needs `derived | semiderived`.

## Scope

In scope:

- A `DerivationRule { kind; storage?; expression; isFormal? }` value type,
  with `DerivationKind = "derived" | "semiderived"` and
  `DerivationStorage = "derive_on_request" | "derived_and_stored"`.
- `FactType.derivation?: DerivationRule` (asserted = absent). Config,
  getter, round-trip, schema, diff, verbalization, validation.
- `SubtypeFact.definingRule?: DerivationRule` -- a subtype defined by a rule
  (Halpin's subtype-defining rules, the same family), reusing the type.
- Verbalization that renders the derivation taxonomy and the rule text.
- Validation: a derived/semiderived element with a blank rule is a warning;
  a purely-derived (derive-on-request) fact type carrying a sample
  population is a warning (its facts are computed, not asserted).

Out of scope:

- **Formal rule grammar, parsing, or evaluation.** The rule is opaque text
  in v1. No expression language, no role-path references, no computing the
  derived population. This is the Tier-3 fork (barwise-5t9.10), deferred.
- **NORMA derivation import/export.** Deferred to a follow-on, XSD-gated:
  NORMA's derivation is largely formal (role paths) and only its
  `InformalDerivationRule` maps cleanly to v1 text. Same caution as the
  other deferred NORMA mappings.
- **Relational projection of derived facts.** Per ADR-0001 filter 5,
  derived artifacts are recomputed, never persisted; a derived fact type's
  mapping behavior is a separate concern, not this construct.

## Inventory

| Module                                        | Change                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `core/src/model/FactType.ts`                  | `DerivationRule`, `DerivationKind`, `DerivationStorage` types; `derivation?` field   |
| `core/src/model/SubtypeFact.ts`               | `definingRule?: DerivationRule` config field, getter                                 |
| `core/src/index.ts`                           | Export the three derivation types                                                    |
| `core/src/serialization/OrmYamlSerializer.ts` | Round-trip fact-type `derivation` and subtype `defining_rule` (emit when present)    |
| `core/schemas/orm-model.schema.json`          | `derivation_rule_def`; `fact_type.derivation`; `subtype_fact.defining_rule`          |
| `core/src/verbalization/Verbalizer.ts`        | Verbalize a fact type's derivation and a subtype's defining rule                     |
| `core/src/validation/rules/*.ts`              | Derivation consistency: missing-rule warning; purely-derived-with-population warning |
| `core/src/diff/elementDiff.ts`                | Fold `derivation` into `diffFactType`; `defining_rule` into subtype diff             |
| `formats/` (NORMA importer/exporter)          | Map NORMA `InformalDerivationRule` + taxonomy markers (follow-on, XSD-grounded)      |

Not affected: the relational mapper / DDL (no projection in v1), the format
registry, and `OrmProject`.

## Target architecture

```
DerivationKind    = "derived" | "semiderived"                  // * vs + ; asserted = absent
DerivationStorage = "derive_on_request" | "derived_and_stored" // * vs ** (default on-request)

interface DerivationRule {                                     // model/FactType.ts
  readonly kind: DerivationKind;
  readonly storage?: DerivationStorage;   // default derive_on_request
  readonly expression: string;            // informal NL/FORML rule text (v1)
  readonly isFormal?: boolean;            // reserved; absent/false in v1
}

FactType.derivation?:   DerivationRule    // asserted when absent
SubtypeFact.definingRule?: DerivationRule // subtype defined by a rule

.orm.yaml:
  fact_type:
    derivation:
      kind: derived              # or semiderived
      storage: derived_and_stored  # omitted when derive_on_request
      expression: "TotalPrice = Quantity * UnitPrice"

verbalization:
  "Fact type 'Order has TotalPrice' is derived (stored): TotalPrice =
   Quantity * UnitPrice."        # taxonomy + rule text, deterministic

validation (structural, never evaluated):
  - derived/semiderived with blank expression  -> warning (rule missing)
  - derive-on-request fact type with a sample population -> warning
    (its facts are computed, not asserted)
```

## Alternatives considered

- **A single flattened enum** (`asserted | derived | semiderived |
  derived_and_stored`). Rejected: it conflates the definitional axis with
  the eager/lazy axis -- the deep-research note is explicit that these are
  orthogonal, not synonyms -- and makes the illegal "asserted + stored" pair
  representable.
- **A formal expression language in v1.** Rejected: a parsed rule needs the
  role-path model (Tier-3, barwise-5t9.10) to reference roles, so it cannot
  ship before that fork; and ADR-0001 keeps rule evaluation out of core. The
  `is_formal` seam lets it attach later additively.
- **A derived-fact-type as a distinct top-level element** (not a field on
  FactType). Rejected: a derived fact type _is_ a fact type with roles,
  readings, and constraints; derivation is one more property, so it belongs
  inline (filter 2, _inline and local_), not in a parallel collection.
- **Separate derivation types for fact types and subtypes.** Rejected:
  Halpin treats subtype-defining rules as the same family; one
  `DerivationRule` shared by both keeps the taxonomy in one place without
  coupling the two elements.
- **Deferring subtype-defining rules.** Rejected: they reuse the same type
  and a small slice of serializer/schema/verbalization; splitting them costs
  a second round of the same plumbing for no orthogonality gain.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. WS1-WS3 are core-only and additive;
WS4 is the connector mapping, gated on XSD verification.

### 1. Model + serialization + schema + diff

Add the three derivation types and the two fields (`FactType.derivation`,
`SubtypeFact.definingRule`); round-trip both (emit only when present); add
the schema `derivation_rule_def` and the two properties; fold derivation
into `diffFactType` and the subtype diff. Round-trip tests per the
established additive-construct pattern. No behavior beyond storage yet.
Additive -- no `orm_version` bump (1.1 is the open cycle).

### 2. Validation: derivation consistency

A derived or semiderived element whose `expression` is blank yields a
`warning` (the derivation is declared but undefined). A fact type marked
derive-on-request that carries a sample population yields a `warning` (its
facts are computed on demand, so asserting instances is suspect);
derived-and-stored and semiderived populations are accepted. Never evaluates
the rule -- these are structural checks on the declaration.

### 3. Verbalization

Render the taxonomy and rule text. A derived fact type verbalizes as "Fact
type '{name}' is {derived | semiderived} [(stored)]: {expression}."; a
subtype defining rule extends the existing subtype sentence: "{Subtype} is a
subtype of {Supertype}, defined as: {expression}." Goldens per form. The
opaque text is emitted verbatim -- verbalization is the rule's primary
surface, and the AI-grounding payoff of the construct.

### 4. NORMA import/export (XSD-grounded, follow-on)

Map NORMA's `InformalDerivationRule` text and the derivation taxonomy
markers (`DerivationStorageValues`, `DerivationCompletenessValues`) onto the
v1 fields; the formal `FactTypeDerivationRule` role-path form is out of
scope until the role-path model exists. Ground the exact element nesting
against `ORM2Core.xsd` before writing the mapping; defer if uncertain, per
the standing NORMA-mapping caution. Tracked as a separate issue.

## API and migration impact

- New public types `DerivationRule`, `DerivationKind`, `DerivationStorage`
  from `@barwise/core`; `derivation` added to `FactTypeConfig` / `FactType`
  and `definingRule` to `SubtypeFactConfig` / `SubtypeFact` (additive, no
  existing signature changes).
- No `orm_version` bump: the fields are optional and additive, and 1.1 is
  already the open cycle.
- Blast radius: derivation is a field, not a new `Constraint` union member,
  so no exhaustive switch changes; only the sites that read it are touched.
  The one-way build surfaces any downstream drift.

## Open decisions (for review)

- **Two axes vs one enum (recommend: two axes).** Separate `kind`
  (`derived | semiderived`) and `storage`
  (`derive_on_request | derived_and_stored`), matching the book's orthogonal
  axes and the deep-research correction. The flat enum is simpler to
  enumerate but admits illegal combinations.
- **Asserted as absence vs explicit kind (recommend: absence).** A fact type
  with no `derivation` is asserted; presence means derived/semiderived. The
  alternative (an explicit `asserted` kind) adds a redundant default state.
- **Share `DerivationRule` across fact types and subtypes (recommend:
  share).** One type, used by both, per Halpin's unified treatment. The
  alternative duplicates the taxonomy.
- **Purely-derived-with-population: warning vs silent (recommend:
  warning).** A derive-on-request fact type with asserted instances is at
  least notable; a warning flags the likely modeling slip without blocking.
  The alternative (silent) loses a cheap, determinism-safe check.

## Risks and testing

- The verbalization phrasing is the subjective part: the bar is that a
  derived fact reads as a derivation a reviewer recognizes, the taxonomy is
  legible, and existing goldens stay green (the construct is new).
- Determinism holds: derivation is stored text plus enums; validation is a
  pure function of the declaration, never the rule's meaning.
  `check-core-purity` guards it.
- Each concern ships a test: round-trip (both fields, taxonomy variants,
  omitted-when-absent), validation (blank-rule warning, purely-derived
  population warning, accepted cases), and verbalization goldens.
- The chief risk is scope creep toward a formal grammar; the `is_formal`
  seam and the explicit out-of-scope line hold it back.

## Non-goals

- No formal rule grammar, parser, or evaluator; opaque text only.
- No role-path references in rules (that is barwise-5t9.10).
- No computing or persisting a derived population; derived artifacts stay
  recomputed (ADR-0001 filter 5).
- No relational / DDL projection of derivation in v1.
