# Schema versioning

Scope: architecture
Date: 2026-10-28
Tracking: barwise-ubc, barwise-1063, barwise-n9n, barwise-vvg, barwise-6om, barwise-y1b,
barwise-jj8,
docs/specs/archive/schema-versioning.spec.md,
docs/specs/diagram-references-by-id.spec.md,
docs/specs/orm-format-3.spec.md
Enforced-by: tests (version-signal, minor-and-major, load-forward),
npm run check:source-sites (version-signal), none (barwise-ym8.8l3: shared-minor),
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

Which kind of bump a change needs is a judgment each spec makes and its
review checks. Adding an optional construct or field is additive, a
minor change: bump `CURRENT_ORM_VERSION` and the schema `const`, and
register a forward migration (a no-op for a purely additive change). A
change an older reader would misread rather than ignore is breaking or
structural, a major change with a real migration (diagram references
moving from names to ids was one). Until 2026-11-06 decision 2 stated
that classification; the owner restated it then as the step shape below,
which a check can hold (`docs/specs/adr-batch9-enforcers.spec.md`).

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
2. **A minor step goes to the next minor, a major step to the next
   major's first; the schema const equals `CURRENT_ORM_VERSION`.**{#minor-and-major}
   (Owner, 2026-11-06.) The loader reads every version from
   `CURRENT_MAJOR_FIRST_VERSION` up to the current one by applying those
   steps, so a minor bump keeps every earlier file of its major loadable;
   a major bump moves `CURRENT_MAJOR_FIRST_VERSION`.
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
  current version loads (a 4.0 file is read by the Effect decoders in
  `decode/document40.ts`, not validated against `orm-model.schema.json`,
  so this fails if the decoder's `orm_version` literal and
  `CURRENT_ORM_VERSION` disagree), output is stamped with the current
  version, a newer version is refused with "newer barwise" before any
  decoder sees its fields, and a file with no `orm_version` is
  refused with a message naming the missing field. The two writers that
  build a document outside the serializer are tested the same way:
  `splitModel`'s domain files (core's `splitModel.test.ts`, from a 1.0
  source) and the editor's new-model scaffold (vscode's
  `projectScaffold.test.ts`) both state `CURRENT_ORM_VERSION`;
  `tested-in.json` names all three files, so each must carry a passing
  tagged test. These run in CI through
  `npm run test:coverage` (`if: steps.changes.outputs.docs_only !=
  'true'`, so skipped on a docs-only pull request and, like any step,
  once an earlier step fails). Any other writer is held by `npm run
  check:source-sites`, rule `orm-version-writers`
  (`scripts/check-source-sites.mjs`, `adr-batch9-enforcers.spec.md`
  WS3), uncached and run in CI before the build on the same guard. It
  parses every tracked `packages/*/src` file and counts each site that
  sets `orm_version` (an object key, an assignment to `.orm_version` or
  `["orm_version"]`, or string or template text holding `orm_version:`)
  per file, enclosing function and form, against `ORM_VERSION_WRITERS`:
  the decoders' literals, two in-memory 3.0 documents never written
  (`document40Configs`, `verifyOssie`'s `document30`), the two
  migration restamps, the serializer, and the two writers above. An
  unlisted site, an extra one in a listed group, and a row with fewer sites
  than listed are each a finding. Review-only, because a parse cannot see
  them: a computed key built by concatenation, an `Object.assign` or
  `defineProperty` from a variable key, a document copied by spread from a
  source other than the serializer, and YAML assembled from fragments that
  never hold `orm_version:` whole. A file at the same version that uses a
  construct the reader lacks still fails at the decoder; decision 1 does
  not cover that.
- Decision 2 is held by tagged tests in core's `schemaVersion.test.ts`.
  They take a build's versions as `planRead` does and run on this
  build's: the read path is every `ORM_VERSION_MIGRATIONS` step plus each
  legacy reader (`LEGACY_ORM_VERSION` into the next major's first,
  `PREVIOUS_ORM_VERSION` into the current major's). Every move is a minor
  step (same major, next minor) or a major step (the next major's first,
  by `majorFirst`); no version is left by two moves (`planMigration`
  would take the first step and ignore the second); every move lands on
  `CURRENT_ORM_VERSION` or on a version another move leaves, never past
  the current one; and a major move leaves its major's last minor, so no
  move and not `CURRENT_ORM_VERSION` names a later minor of the major it
  leaves. Parity is checked directly, not through a load: the schema's
  `orm_version` `const` and the 4.0 decoder's literal each equal
  `CURRENT_ORM_VERSION`, and `tests/types/ormVersion.test-d.ts` holds
  `OrmYamlDocument40`'s literal type to it at compile time. A version a
  release wrote but that nothing in the build names (a minor whose step
  was deleted along with every mention) is invisible to these checks.
  The chain checks follow from the kept sentence that the loader reads every
  version "by applying those steps". Whether a change is additive or
  structural (Context) stays a judgment each spec makes and its review
  checks, as `diagram-references-by-id.spec.md` D1 and
  `orm-format-3.spec.md` did.
- Decision 2's loader is tested without a real minor: `planRead` in
  `serialization/schemaVersion.ts` takes the build's versions as a
  parameter, and `schemaVersion.test.ts` reads a 3.0 document in a
  synthetic 3.1 build through a 3.0-to-3.1 step, calls a 3.0 file no step
  reaches a bug in barwise, and still refuses a version between the two
  majors (barwise-jj8). Against this build's own versions it checks that
  registered steps reach the current version from its major's first, so a
  minor bump that forgets its step fails. A step that skips a minor (3.0 to
  3.2) passes that test and fails the shape test above. The serializer's
  own path through a real minor first runs at that bump.
- Decision 3 has no gate: a change to `orm-model.schema.json` that
  leaves `CURRENT_ORM_VERSION` equal to the last tagged release's passes
  CI (barwise-vvg, which waits on barwise-6om for what "released"
  means).
- Decision 3 is silent on what counts as released and on what happens
  inside an unreleased major. v1.7.0 wrote 1.1; 2.0 and 3.0 landed after
  it only in the moving `edge` pre-release, and v2.0.0 is the first
  release since, writing 4.0. `join_ring` (#746) and
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
  and `merge.test.ts` asserting `barwise merge` succeeds on two 1.0
  inputs, prints the merge at the current version, and leaves both inputs
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
