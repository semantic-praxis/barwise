# ADR 0001: Metamodel evolution policy

Status: Accepted
Date: 2026-06-17
Tracking: barwise-5t9 (+ children), docs/NORMA_VS_ORM_YAML.md,
docs/specs/norma-export.spec.md

## Context

A three-layer review of the native `.orm.yaml` metamodel -- against our
own NORMA importer (the barwise-5t9 audit), against NORMA's authoritative
`ORM2Core.xsd` (the schema census), and against the ORM 2 reference book
(a cited research pass) -- catalogued roughly thirteen ORM 2 constructs
barwise does not represent. The tempting but wrong reading is to treat
that list as a backlog to burn down to "full ORM 2 / NORMA parity."

barwise's value is not parity. Its edge over NORMA XML is _legibility_:
a lean, local, verbalizable format that humans read in review and LLMs
generate and edit reliably. Every construct added spends that edge --
more token density, more ways for a generated model to be inconsistent,
more JSON Schema surface to constrain. "Lossy by design" is therefore a
feature, and the gap list is a menu, not a TODO. This ADR records how we
decide what comes off the menu.

## Decision

1. **The metamodel stays deliberately lossy.** barwise-5t9 is a menu.
   Constructs earn their place by serving data engineers and AI
   workflows, not by existing in NORMA or the book.

2. **Four filters gate every candidate construct.**
   - _Verbalizable._ It must read as a natural FORML business rule.
     Verbalization is the differentiator and the AI grounding; a
     construct we cannot verbalize cleanly does not serve the mission.
   - _Inline and local._ It lives on the element it constrains, as a
     discriminated-union value -- not in a separate referenced graph the
     author (human or LLM) must keep consistent.
   - _Deterministic._ Rules are stored as _data_, never executed by core.
     This admits derivation rules as structure; it argues against
     constructs that are inherently about state change over time.
   - _Bounded cost._ Each field is model + serializer + JSON Schema +
     validation + verbalization + round-trip test, under a shared minor
     `orm_version` bump (one per release cycle, not one per field -- see
     Schema versioning). Batch related fields; resist one-offs.

3. **Tiering (below) sequences the menu.** Tier 1 ships soon; Tier 3 is a
   single deliberate architectural fork we may never fully take; Tier 4
   is declared a non-goal so the omission is intentional.

4. **Design the hard constructs against the book, not NORMA's tooling.**
   The cited research found NORMA's _schema_ is a faithful near-superset
   of the book, but its _tooling_ lags in two spots. So model the full
   alethic/deontic modality theory (not NORMA's single-main-operator
   limit), and use the correct derivation taxonomy (`*` derived, `+`
   semiderived/partial, `**` derived-and-stored as a separate eager/lazy
   axis) rather than mirroring NORMA's partial formal-rule support.

5. **Keep recomputing derived artifacts; never persist them.** Relational
   mapping, DDL, and any OIAL-style layer stay _recomputed_ from the
   conceptual model. Persisting them (as NORMA does) is what keeps core
   deterministic and the file lean; not adding them is itself a decision.

## Tiering

| Tier           | Constructs (issues)                                                                                                                       | Rationale                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1 -- do soon   | value ranges (5t9.1, a _bug_), value-comparison (5t9.9), independent types (5t9.5), defaults (5t9.7), notes (5t9.12), deontic tag (5t9.3) | Static, inline, verbalizable, cheap. 5t9.1 is data loss, not a feature -- fix first.                                        |
| 2 -- worth it  | object cardinality (5t9.4), multi-role frequency (5t9.8), derived fact types (5t9.2)                                                      | Real value; 5t9.2 needs a rule-representation call (start informal/NL, defer formal).                                       |
| 3 -- one fork  | role-path / join-rule model (5t9.10) -> unlocks join constraints (5t9.6), formal derivation paths, queries (5t9.11)                       | Highest leverage and highest risk: the one construct that breaks "inline and local". Spec-first; keep a constrained subset. |
| 4 -- non-goals | dynamic rules (5t9.13), queries / subqueries (5t9.11)                                                                                     | Dynamic rules fight determinism; queries sit outside conceptual modeling. Decline explicitly.                               |

## Schema versioning (resolved: additive constructs bump the minor `orm_version`)

Adding an optional construct or field to `.orm.yaml` is a minor format
change, so it bumps the minor `orm_version` (1.0 -> 1.1 -> ...), using the
mechanism already specified in `docs/specs/schema-versioning.spec.md`: bump
`CURRENT_ORM_VERSION` and the schema `const`, and register a forward
migration (a no-op for a purely additive change). A breaking or structural
change bumps the major version with a real migration.

Why bump at all for an additive change: the serializer stamps every file
with `CURRENT_ORM_VERSION` and the schema pins it as a `const`, so a tool
reading a file whose version exceeds its own gets a clean "written by a
newer barwise" error rather than a cryptic schema failure on an unknown
construct. The version is the honest compatibility signal; a construct that
did _not_ bump would let a file claim a version whose construct set it
actually exceeds.

The bump is **once per unreleased minor cycle, shared across every additive
construct that lands in it** -- not per construct and not per PR. The first
additive PR after a released version performs the bump; later additive PRs
in the same cycle add their construct to the already-bumped schema without
touching the version. This is the same batching the _bounded cost_ filter
calls for.

Scope note: value ranges (5t9.1) shipped under 1.0 and stays there -- "1.0"
on main de-facto includes it -- so the discipline starts with the next
construct (5t9.9 value-comparison), whose PR performs the one-time
1.0 -> 1.1 bump. The whole Tier-1 batch then shares 1.1, and any other
additive construct landing before 1.1 is released (e.g. the role-path join
variants, barwise-0s8) shares the same 1.1 rather than bumping
independently. Cross-thread implication: the role-path spec's separate
1.0 -> 1.1 bump folds into this single shared bump.

## Consequences

- The metamodel grows along a principled line rather than chasing a
  competitor's feature list, so the legibility that distinguishes
  `.orm.yaml` is preserved as it gains expressiveness.
- Tier 1 is a coherent batch: its members share the serializer, JSON
  Schema, and verbalization machinery, so they land as one or two PRs
  (DRY-secondary favours batching here) rather than six.
- Declining Tier 4 in writing means a NORMA file using those constructs
  loses them on import _by intent_, not by accident -- consistent with
  "explicit over implicit."
- The cost is honest: barwise will never round-trip a foreign NORMA model
  that uses Tier 3/4 constructs without loss. That is the same superset
  asymmetry the export spec already accepts (RT-B fidelity is bounded by
  what the metamodel represents).
- This ADR is the standing answer to "should we add X from NORMA/the
  book?": run X through the four filters and place it in a tier.
