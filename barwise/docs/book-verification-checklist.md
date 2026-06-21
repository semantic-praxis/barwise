# Book-verification checklist (anti-NORMA-centrism)

Status: Living checklist -- items resolved in place as they are verified.
Created: 2026-06-21
Last-updated: 2026-06-21
Tracking: barwise-8ir (audit epic), barwise-5t9 (epic),
docs/adr/0001-metamodel-evolution-policy.md, docs/NORMA_VS_ORM_YAML.md

## Why this exists

ADR-0001 filter 4 says design the metamodel _against the book_ (Halpin &
Morgan, _Information Modeling and Relational Databases_, 3rd ed., 2024 --
ISBN 9780443237904 -- and Halpin's ORM 2 papers), not against NORMA's
tooling. Across Tiers 1-3 we mostly held that line, but several constructs
were grounded with NORMA artifacts in hand (the `ORM2Core.xsd`, the sample
`.orm` corpus) and a few verbalizations are deterministic approximations
rather than true FORML2. This is the standing list of claims to check
against the canonical sources, so a NORMA habit does not quietly become a
barwise decision.

Verify against the 3rd ed. (2024), the current edition; earlier editions
predate its updated ORM/FORML coverage and its new treatment of JSON/YAML
and markup serialization (see CC5).

Each item names the claim to verify, the canonical source to check it
against, the NORMA-centrism risk, the current barwise choice, and a status.
Resolve an item by editing its status line (and the construct, if the book
disagrees); the join-constraint deep-research pass (which corrected the
single-endpoint model to projected tuples) is the template.

## How to verify

Prefer the book and Halpin's own papers over NORMA docs or the tool source:

- Halpin & Morgan, _Information Modeling and Relational Databases_, 3rd ed.
  (2024; the reference text; constraint chapters and the conceptual-join
  sections).
- _ORM 2 Constraint Verbalization_, tech report ORM2-02
  (https://www.orm.net/pdf/ORM2_TechReport2.pdf) -- the FORML target forms.
- _ORM 2 Graphical Notation_, tech report ORM2-01
  (https://www.orm.net/pdf/ORM2_TechReport1.pdf).
- Halpin, _Logical Data Modeling_ Parts 7-8, Business Rules Journal
  (https://www.brcommunity.com/articles.php?id=b866 and `id=b883`).
- _Constraints on Conceptual Join Paths_ (Idea Group, 2005) and _A Role
  Calculus for ORM_ (OTM 2009) for join/role-path semantics.

NORMA's `ORM2Core.xsd` and sample corpus are evidence of _one tool's_
encoding, useful for interop but not authoritative for the concept.

## Cross-cutting risks

### CC1. Verbalization fidelity (FORML2) -- _priority: high_

Several constraint verbalizers emit a deterministic, recognizable sentence
rather than the book's FORML2. The join verbalizer is the clearest case:
barwise says `... project the same [Person, Country]` where Halpin writes
the relative-clause form `... the same Country of which that Person is a
citizen`. Verify each constraint family's verbalization against ORM2-02 and
decide, per family, whether the approximation is acceptable or should move
toward FORML. This is the construct most likely to read as tool-flavored.
Verify: every constraint verbalizer. Source: ORM2-02; b866/b883.

### CC2. Terminology -- _priority: medium_

Check public model vocabulary against Halpin's terms. `RolePath.root` is the
known soft spot: Halpin uses "root object type" for _subtyping_, and frames a
path's start as the first role / a correlation variable, not a "root". The
join verbalizer's "For each {root}" framing should also be checked against
the book's "for each" / correlation phrasing. Verify: `RolePath`,
`JoinOperand`, the verbalization vocabulary. Source: _Role Calculus for ORM_;
b866.

### CC3. "Defer to NORMA mapping" framing -- _priority: medium_

Multiple constructs deferred a NORMA mapping as "XSD-gated". The book-first
reframe: the `.orm.yaml` representation is designed against the book and is
authoritative; a NORMA mapping is a separate, lossy interop concern that
never dictates the native shape. Audit each "deferred NORMA mapping" note
(cardinality, derivation, value-comparison, the Tier-1 fields, join import)
to confirm no native shape was bent toward NORMA's encoding "to make import
easier". Source: ADR-0001 filter 4.

### CC4. Validation semantics as tooling, not concept -- _priority: low_

The error/warning/info severity ladder and the population-violation rules
are barwise tooling, not book constructs -- fine, but the one place a
severity encodes a _conceptual_ claim is deontic = warning (CC/T1.6 below).
Keep severity choices out of the "is this faithful to ORM" question except
where a severity stands in for a modal/semantic distinction.

### CC5. Read the 3rd ed.'s serialization coverage -- _priority: medium_

The 3rd ed. (2024) newly covers JSON, YAML, and other markup serializations
of ORM models. That is barwise's exact domain (the native `.orm.yaml`), so
this is the rare case where a book edition could bear directly on a design
choice rather than just a citation. Read that material and check whether the
book sanctions a serialization framing barwise should align to -- the
book-first answer to "is our format too NORMA-shaped?". Verify: the
`.orm.yaml` schema shape and key vocabulary. Source: Halpin & Morgan, 3rd
ed., the serialization / data-file-format material.

## Tier 1

### T1.1 Value ranges (5t9.1) -- _priority: low_

Verify: inclusive/exclusive and open-ended value ranges on value types match
the book's value-constraint semantics. Risk: low; ranges are standard.
Current: `ValueRange { min?, max?, minInclusive?, maxInclusive? }`. Source:
Halpin & Morgan value-constraints chapter. Status: unverified.

### T1.2 Value-comparison (5t9.9) -- _priority: medium_

Verify: the operator set `< <= = <> >= >` and that a value-comparison
constraint is an ordering between two roles' values within one fact type
(not a join). Risk: the operator enum may mirror NORMA's; confirm the book's
value-comparison constraint uses this set and this scope. Current:
`ValueComparisonOperator` with those six operators; single fact type; join
case deferred to the role-path model. Source: ORM2 graphical notation;
Halpin & Morgan. Status: unverified.

### T1.3 Independent object types (5t9.5) -- _priority: low_

Verify: "independent" (open-dot) means instances may exist without playing
any elementary/non-identifying fact role, and the exemption from the
isolated-object-type completeness warning matches the book. Risk: low; term
is canonical. Current: `ObjectType.independent` exempts the isolation
warning. Source: Halpin & Morgan (independent object types). Status:
unverified.

### T1.4 Default values (5t9.7) -- _priority: medium_

Verify: whether a default value on a value type is a _conceptual_ ORM
construct in the book, or primarily an implementation/mapping feature. If
the latter, confirm it belongs in the conceptual `.orm.yaml` rather than
only in the relational mapping. Risk: could be a tooling feature dressed as
a conceptual one. Current: `ObjectType.defaultValue`, threaded to SQL
DEFAULT. Source: Halpin & Morgan. Status: unverified.

### T1.5 Notes (5t9.12) -- _priority: low_

Verify: nothing to verify conceptually -- an informal note is an annotation,
not an ORM constraint. Listed for completeness. Status: not applicable.

### T1.6 Deontic modality (5t9.3) -- _priority: high_

Verify: (a) the book marks each constraint alethic or deontic as a single
per-constraint tag (we modeled exactly this); (b) a deontic violation is
faithfully a recorded/permitted state -- our rendering as a validation
_warning_ rather than _error_ is the right reading; (c) excluding compound /
nested modal operators is sound (the book's graphical notation does not use
them). Risk: "deontic = warning" is a barwise rendering of a modal
distinction; confirm it matches Halpin's intent. Current: `modality` on
`ConstraintBase`; deontic violations are warnings; FORML "It is obligatory
that ...". Source: Halpin's modality treatment; ORM2-02. Status: partially
researched (earlier deep-research pass); confirm the warning rendering.

## Tier 2

### T2.1 Object cardinality (5t9.4) -- _priority: medium_

Verify: the book's cardinality constraints -- object-type (population) and
role cardinality -- and whether restricting role cardinality to _unary_ roles
is correct or too narrow (can a role cardinality apply to a role of an n-ary
fact type?). Also check the verbalization forms. Risk: the unary-only
restriction was read off the NORMA XSD element split, not the book. Current:
`ObjectType.cardinality` plus a unary-role `CardinalityConstraint`
(arity-1 enforced). Source: Halpin & Morgan (cardinality). Status:
unverified.

### T2.2 Derived fact types (5t9.2) -- _priority: low_

Verify: the asserted / derived (`*`) / semiderived (`+`) and
derive-on-request (`*`) / derived-and-stored (`**`) taxonomy, that
subtype-defining rules are the same family, and that the FORML derivation
verbalization is faithful. Risk: low; the taxonomy came from a cited
deep-research pass against the book, not NORMA. Current: `DerivationRule`
with the two axes; informal rule text only. Source: Halpin & Morgan
(derivation); cited research already on file. Status: largely verified
(taxonomy); confirm verbalization phrasing under CC1.

### T2.3 Multi-role frequency (5t9.8) -- _priority: medium_

Verify: the book permits a frequency constraint over a _role sequence_
(combination), the tuple-counting semantics, and whether the `min >= 1`
rule is a book constraint or a tooling default we carried. Risk: the `min`
floor and the single-vs-sequence treatment were aligned to the existing
barwise/NORMA frequency code. Current: `FrequencyConstraint.roleIds`
(length 1 = single role); per-tuple counting; `min >= 1` enforced. Source:
Halpin & Morgan (frequency constraints). Status: unverified.

## Tier 3

### T3.1 Join constraints (5t9.10) -- _priority: low_

Verify: the projected-tuple model (operand = path + projection, compared as
tuple sets) is the book's "role sequence projected from a join path"; that
"first and last role of the path" is the canonical default projection vs our
fully general node projection; that the linear-only minimal grammar (no
sub-paths, object unifiers, or calculated projections) is an acceptable
faithful subset; and that the verbalization moves toward FORML (CC1). Risk:
low; this construct was reset to the book by a cited deep-research pass, and
NORMA's `RolePathOwner` substrate was deliberately not copied. Current:
`JoinOperand { path; projection }`; tuple-set subset/equality/exclusion;
linear paths only. Source: _Constraints on Conceptual Join Paths_; _Role
Calculus for ORM_; b866. Status: largely verified; confirm projection
default and verbalization.

## Resolution log

Append a dated line when an item is verified or a construct is changed in
response, so the audit has a trail (mirrors the REPO_REVIEW dating
convention without spawning a new file each time).

- 2026-06-21 -- checklist created from the Tier 1-3 build sweep.
