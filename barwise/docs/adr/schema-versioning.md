# Schema versioning

Scope: architecture
Date: 2026-10-28
Tracking: barwise-ubc, barwise-1063, barwise-n9n, barwise-vvg, barwise-6om, barwise-y1b,
barwise-jj8,
docs/specs/archive/schema-versioning.spec.md,
docs/specs/diagram-references-by-id.spec.md,
docs/specs/orm-format-3.spec.md
Enforced-by: tests (version-signal, minor-and-major, load-forward),
none (barwise-ym8.4i2: version-signal), none (barwise-ym8.31z: minor-and-major), none (barwise-ym8.8l3: shared-minor),
none (barwise-ym8.yfi: load-forward)

## Context

The native `.orm.yaml` grows: the metamodel evolution policy
(`docs/adr/metamodel-evolution-policy.md`) decides which constructs it
gains, and this ADR decides what the file's `orm_version` says when it
does. A reader that meets a construct it does not know should fail with
a message that names the cause, not a schema error, and an older file
should keep loading after an upgrade. The archived schema-versioning
spec built the mechanism (one current version, a migration registry,
the "newer barwise" error); the diagram-references-by-id spec applied
the major-bump rule (1.1 to 2.0), and the orm-format-3 spec applied it
again (2.0 to 3.0) with a reader for the previous major and
`barwise migrate`. Their reasoning and alternatives are there. The rule
was a section of the metamodel ADR before this one.

## Decision

1. **The version is the compatibility signal.**{#version-signal} Every `.orm.yaml` states
   an `orm_version`. The serializer stamps `CURRENT_ORM_VERSION` on
   every file it writes, and the JSON Schema pins the same value as a
   `const`, so a reader given a file whose version exceeds its own
   refuses it with a "written by a newer barwise" error rather than a
   schema failure on an unknown construct. `.orm-project.yaml` and
   `.map.yaml` follow the same rule with a `format_version` of their own,
   one current version per file kind; a file of either kind without one
   predates versioning and is read as its first version.
2. **An additive change bumps the minor version; a breaking or
   structural change bumps the major with a real migration.**{#minor-and-major} Adding an
   optional construct or field is a minor change: bump
   `CURRENT_ORM_VERSION` and the schema `const`, and register a forward
   migration (a no-op for a purely additive change). The loader reads every
   version from `CURRENT_MAJOR_FIRST_VERSION` up to the current one by
   applying those steps, so a minor bump keeps every earlier file of its
   major loadable; a major bump moves `CURRENT_MAJOR_FIRST_VERSION`. A change an older
   reader would misread rather than ignore is structural (diagram
   references moving from names to ids was one).
3. **The minor bump is shared across its unreleased cycle.**{#shared-minor} The first
   additive change after a released version performs the bump; every
   later additive change before the next release adds its construct to
   the already-bumped schema without touching the version -- not one
   bump per construct or per pull request.
4. **Older files load at the current version; a surface writes them
   back only when it writes an edit.**{#load-forward} A migration brings an older file
   forward on load, either as a step on the raw document
   (`ORM_VERSION_MIGRATIONS`) or, where the step needs the model,
   through the previous major's reader (2.0 to 3.0). The file on disk
   becomes the current version when a surface writes an edit to it, or
   when `barwise migrate` rewrites it.

## Consequences

- Core's `SchemaVersioning.test.ts` checks decision 1: a file at the
  current version loads (which fails if the schema `const` and
  `CURRENT_ORM_VERSION` disagree), output is stamped with the current
  version, and a newer version is refused with "newer barwise", never
  the schema's `const` message. It runs in CI through
  `npm run test:coverage` (`if: steps.changes.outputs.docs_only !=
  'true'`, so skipped on a docs-only pull request and, like any step,
  once an earlier step fails). A file at the same version that uses a
  construct the reader lacks still fails at the schema; decision 1 does
  not cover that.
- Decision 2 has no gate: whether a change is additive or structural is
  a judgment each spec makes and its review checks, as
  `diagram-references-by-id.spec.md` D1 and `orm-format-3.spec.md` did.
  Its loader is tested without a real minor: `planRead` in
  `serialization/schemaVersion.ts` takes the build's versions as a
  parameter, and `schemaVersion.test.ts` reads a 3.0 document in a
  synthetic 3.1 build through a 3.0-to-3.1 step, calls a 3.0 file no step
  reaches a bug in barwise, and still refuses a version between the two
  majors (barwise-jj8). Against this build's own versions it checks that
  registered steps reach the current version from its major's first, so a
  minor bump that forgets its step fails. A step that skips a minor (3.0 to
  3.2 in a 3.2 build) still passes and leaves every 3.1 file unreadable;
  nothing checks that, and the serializer's own path through a real minor
  first runs at that bump.
- Decision 3 has no gate: a change to `orm-model.schema.json` that
  leaves `CURRENT_ORM_VERSION` equal to the last tagged release's passes
  CI (barwise-vvg, which waits on barwise-6om for what "released"
  means).
- Decision 3 is silent on what counts as released and on what happens
  inside an unreleased major. v1.7.0 wrote 1.1; 2.0 and 3.0 have landed
  since only in the moving `edge` pre-release. `join_ring` (#746) and
  the external-uniqueness preferred identifier (#767), both additive,
  joined 3.0 after #708 with no minor bump, so an earlier 3.0 `edge`
  build refuses such a file at the schema rather than with "newer
  barwise". `diagram-empty-view.spec.md` changed what `elements: []`
  means inside 2.0 with no bump, a structural change an older 2.0 reader
  misreads, and accepted that exposure in its PR. Whether either is
  allowed is open (barwise-6om).
- Decision 4's load and write paths are tested: the 1.0 forward load in
  `SchemaVersioning.test.ts`, the 2.0 reader and `migrate` in
  `format30.test.ts`, the command in `cli/tests/commands/migrate.test.ts`,
  and `merge.test.ts` asserting `barwise merge` leaves both inputs
  untouched, all under `test:coverage`. No general check covers other
  commands; the capability matrix's `migrate` and `merge` rows record by
  hand which surfaces write files.
- Migration loses what the serializer or a lenient load does not carry:
  `barwise migrate` drops YAML comments because it writes from the model
  (barwise-ok6), and a 2.0 merge fragment's `is_preferred` flags are
  dropped by the lenient load (barwise-n9n.f06). Any surface edit that
  writes an older file has the same comment loss.
- `.orm-project.yaml` and `.map.yaml` follow decisions 1 to 3 with their
  own `format_version`, each kind on its own version
  (`CURRENT_PROJECT_FORMAT_VERSION`, `CURRENT_MAPPING_FORMAT_VERSION`, both
  1.0; barwise-y1b, `docs/specs/iri-identity.spec.md` WS4). Decision 1 is
  tested for both in core's `formatVersion.test.ts`: each schema `const`
  equals its constant, every written file is stamped, and a newer file is
  refused with "newer barwise" before the schema runs. A file without
  `format_version` predates versioning and is read as 1.0. Decision 4 does
  not yet apply to them: neither kind has a migration step, and `barwise
  migrate` takes only `.orm.yaml`, so it gains them with their first step.
  `planRead` gives all three kinds one answer per refusal reason
  (`READ_PLAN_ADVICE`).
- 1.0 includes value ranges (barwise-5t9.1), which shipped before this
  rule; the discipline began with the 1.0 to 1.1 bump.
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule: the metamodel ADR's
  bounded-cost filter; the root `CLAUDE.md` `migrate` row; `docs/CLI.md` (`migrate`);
  `architecture-scenarios.md` S-EXPL-1 and S-EXPL-2; the `pr-review`
  checklist's `schemaVersion` item; `orm-format-3.spec.md`,
  `diagram-references-by-id.spec.md` and `diagram-empty-view.spec.md`;
  and the `CURRENT_ORM_VERSION` comment in `schemaVersion.ts`.
