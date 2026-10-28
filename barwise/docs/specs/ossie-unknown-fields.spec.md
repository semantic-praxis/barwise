# The Ossie importer names every field the pinned schema does not define

Status: Draft -- no workstream implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-pf2.6d0
Touches: barwise/packages/formats/src/ossie/parseOssie.ts,
barwise/packages/formats/src/ossie/OssieImportFormat.ts,
+barwise/packages/formats/src/ossie/ossieSchema.ts,
+barwise/packages/formats/schemas/ossie/,
-barwise/packages/formats/tests/fixtures/ossie/ontology.json,
-barwise/packages/formats/tests/fixtures/ossie/ossie-schema.json,
barwise/packages/formats/tests/fixtures/ossie/README.md,
barwise/packages/formats/tests/OssieImportFormat.test.ts,
barwise/packages/formats/tests/OssieExportFormat.test.ts,
barwise/packages/formats/package.json,
barwise/packages/formats/CLAUDE.md,
barwise/package-lock.json,
barwise/docs/adr/ossie-interchange.md

When an imported Ossie document carries a field the pinned schema does not
define, the importer shall name that field, by its path, in
`ImportResult.warnings`, and import the rest as it does today. It does so by
validating the parsed document at run time with ajv against the vendored
`ontology.json` and `ossie-schema.json`, which move from the test fixtures
to `formats/schemas/ossie/` so the importer and the tests read one copy.

## Principle

Decision 4 of `docs/adr/ossie-interchange.md` says nothing is lost
silently, and today an unknown field is lost silently. `parseOssie` checks
only the fields the mapper reads (its header says so), so
`{ concept: Airport, type: EntityType, colour: blue }` imports as an
`Airport` with no `colour` and no warning. The version pin does not close
this: `0.2.0.dev0` is a development version, and upstream can add a field
at a later commit without changing the string the importer checks
(decision 3's Consequences bullet). The pinned schema already states which
fields exist -- it sets `additionalProperties: false` on the document and
on eight of its `$defs`, nine places -- so the gap is not missing knowledge,
only that nothing reads that knowledge at run time.

The fix derives the answer from the schema rather than restating it, so a
moved pin moves the answer with it (explicit over implicit, and no
must-agree copy).

## Should the importer validate with ajv, or walk a key allow-list? (resolved: ajv)

ajv, because the schema's own `$ref` graph then decides where an unknown
field can occur, and nothing in barwise restates that graph.

- **(a) ajv over the pinned schema.** Compile `ontology.json`, with
  `ossie-schema.json` registered under the URL its `$ref`s name, as the
  export test already does (but with the named `{ Ajv2020 }` import, as
  core imports `{ Ajv }`: the test's default import does not type-check
  under NodeNext, and only passes because tests are not compiled).
  Validate the raw parsed document with
  `allErrors`, keep the `additionalProperties` errors, and render each as a
  path. Coverage is every object the schema closes, including the ones
  inside `ontology_mappings` and its `semantic_model` (which refers to the
  whole core schema). Cost: `ajv` becomes a runtime dependency of
  `@barwise/formats`; it is already a devDependency here and a runtime
  dependency of `@barwise/core` at the same range (`^8.20.0`), so nothing
  new is installed. The compile is about 75 ms, once per process, on the
  first Ossie import (measured on the pinned schema); validation of the
  flights example is under 1 ms.
- **(b) A walker over known keys per object.** The key sets can be read
  from the schema (`Object.keys($defs.OntologyComponent.properties)`), so
  they cannot drift; but the walker must still know which key leads to
  which `$def` -- `ontology` to `OntologyComponent`, `relationships` to
  `Relationship`, `roles` to `Role` -- and that structure is hand-written.
  If upstream adds a nested object, the walker does not descend into it and
  says nothing: exactly the silent gap this spec closes, one level down. A
  generic walker that follows `$ref`, `items` and `properties` itself is a
  partial JSON-schema validator, which is what ajv is.

(b) wins only on the dependency, and the dependency is already in the tree
and named by CLAUDE.md as the kind of library that is fine. The formats
package's "Allowed runtime dependencies" line gains `ajv`.

## Where the run-time schema lives (resolved: `formats/schemas/ossie/`)

The two vendored JSON files move, unchanged, from
`formats/tests/fixtures/ossie/` to `formats/schemas/ossie/`, and both the
importer and the export test read them there. One copy means the run-time
schema and the schema the tests validate exports against cannot drift; a
second copy with a drift test would be a check guarding a duplication that
need not exist. This is the convention `@barwise/core` already follows:
`core/src/serialization/SchemaValidator.ts` imports
`../../schemas/orm-model.schema.json` with `with { type: "json" }`, which
from `dist/serialization/` resolves to the same package-level `schemas/`
directory; the unbundled `dist` the CLI and MCP server run from in the
workspace resolves it the same way, and their esbuild bundles and the VS
Code extension's inline it. dprint
already excludes `**/schemas/**`, so the files stay byte-identical to the
pinned commit. The flights example stays a test fixture; the license note
moves with the JSON into `schemas/ossie/README.md`.

## Scope

In scope:

- When an imported document has a field the pinned schema does not define,
  at any depth, the importer shall add one warning per field, naming its
  path in the vocabulary `parseOssie`'s refusals already use: a path under
  `ontology[i]` starts `concept <name>`
  (`concept Airport.relationships[0].colour`), any other starts at the
  document root (`colour`, `ontology_mappings[0].extra`). It then proceeds
  as it does today. The confidence becomes `medium`, which any warning
  already makes it.
- That includes a field inside `ontology_mappings`, which the mapper
  already drops whole with a warning. Skipping it would take a list of
  the subtrees the mapper drops, which must agree with the mapper and
  would go silent the day the mapper starts reading one; one uniform rule
  needs no list. The cost is a warning per unknown key in a deprecated
  block, which documents in practice do not carry.
- When a document has no such field, the importer's warnings shall be
  exactly what they are today. The pinned `flights.ontology.yaml` imports
  with the same warning list (its existing `toEqual` test pins this).
- When the version is not the pinned one, or a field the mapper reads is
  malformed, the importer shall refuse as today. The unknown-field check
  runs after `parseOssie`'s checks, so a refused document never reports
  unknown fields.
- The unknown-field warnings come before the mapper's warnings: they are
  about the document's shape, and the mapper's are about what the model
  could not carry.

Out of scope: schema violations other than an unknown field, because none
of them loses anything a warning does not already name. A field the mapper
reads is type-checked by `parseOssie`, which refuses a wrong one.
Everything else the schema constrains is inside a subtree the importer
drops whole with a warning: `ontology_mappings` (its `anyOf`, `minItems`
and `required`), `ai_context`, and the `format: "iri"` on `prefixes`
values. An unknown field is different in kind: it sits beside fields that
are imported, and nothing else names it. If a later pin makes the mapper
read one of those subtrees, `parseOssie` gains the check, as for every
field it reads.

Also out of scope, and still open after this spec: a later upstream commit
that keeps `0.2.0.dev0` but changes a field's type, an enum, or a meaning,
or removes a field. The check here catches the one change of that kind a
schema can see on the document -- an added field -- and decision 3's
Consequences bullet says the rest stays open.

## Target architecture

```
formats/schemas/ossie/
  ontology.json, ossie-schema.json   the pinned commit's files, unchanged
  README.md                          source commit and license

formats/src/ossie/ossieSchema.ts
  compileOssieSchema(ajv)            registers ossie-schema.json under the URL
                                     ontology.json's $refs name, compiles
                                     ontology.json; shared with the export test
  unknownOssieFields(raw)            additionalProperties errors -> warning lines

formats/src/ossie/parseOssie.ts
  parseOssie(text) -> { document, warnings }   checks as today, then
                                               unknownOssieFields(raw)

formats/src/ossie/OssieImportFormat.ts
  warnings = [...parsed.warnings, ...mapped.warnings]
```

The validator compiles on first use and is kept at module scope: most
processes never import Ossie, and the compile is the expensive part.

The run-time ajv is not strict (`strict: false`, `validateFormats: false`,
`allErrors: true`). Strict mode checks how a schema is written, not the
document, so at run time it can only turn a re-pinned schema it dislikes
into a generic ajv error on every Ossie import. The export test keeps
strict mode and its own `iri` format by passing an ajv it configured to
`compileOssieSchema`, so a schema strict mode refuses still fails CI.

`compileOssieSchema` registers `ossie-schema.json` as imported, its `$id`
kept, under the URL the `$ref`s name. The export test deletes the `$id`
first; that would mutate the imported JSON module, which the run-time
validator shares, and keeping it compiles and validates the same
(measured).

The path is rendered by walking the raw document along ajv's
`instancePath`, decoding each JSON-pointer segment (`~1` to `/`, `~0` to
`~`): a segment over an array is an index (`[0]`), over a mapping a key.
A key that is not a plain identifier is written as a JSON string in
brackets (`["a/b"]`), whether it is the unknown field or a key on the way
to it. The unknown key itself is `params.additionalProperty`.

One assumption is checked rather than stated: an `additionalProperties`
error under a `oneOf`, `anyOf`, `not`, `if`/`then`/`else` or
`dependentSchemas` branch that failed would name a field the document's
matching branch does define. The pinned schemas reach no closed object
from any such branch (AIContext's object branch sets
`additionalProperties: true`). A test walks both schemas from
`ontology.json`'s root, following `$ref` into either file, and fails if a
closed object is reachable from inside a branch.

## Workstreams

### 1. Unknown fields warned

One PR: move the schemas, add `ossieSchema.ts`, change `parseOssie`'s
return and the adapter, point the export test at the moved files and at
`compileOssieSchema`, and update the formats `CLAUDE.md` (layout and
allowed dependencies). In the ADR, edit in place: decision 3's statement
(the files are vendored under `formats/schemas/ossie/`, not as test
fixtures), its Consequences bullet (an added field is now named at run
time; any other change under the same version string still is not), and
decision 4's Consequences bullet (the unknown-field gap is closed).

Tests seen failing before the change:

- an unknown field at the top level, in a concept, in a relationship and in
  a role, each named by path, with the rest of the document imported;
- an unknown field inside `ontology_mappings` named as well;
- a key that is not an identifier, and a numeric key, rendered in brackets.

Tests that pass before the change by construction, and how each is shown
able to fail:

- the flights example's warnings unchanged: the existing `toEqual` test,
  which fails if the check reports anything on the example;
- no closed object reachable from a branch: the walker is also run on a
  small synthetic schema that reaches one through a `$ref` under `oneOf`,
  and must report it.

## Risks and testing

- **Bundle size and start-up.** ajv's 2020 dialect and the 24 KB of schema
  join the CLI, MCP and VS Code bundles; the compile runs only when an
  Ossie document is imported.
- **A re-pinned schema ajv cannot compile.** Strict mode is off at run
  time (Target architecture), so only a schema that is not valid JSON
  Schema could throw there; the import tests compile it, and the export
  test compiles it strictly, so moving the pin to either fails CI first.
- Run the monorepo build and tests: `@barwise/formats` is bundled by three
  surfaces.

## Non-goals

- No change to the version pin, the mapper, or the exporter.
- No full schema validation report (Out of scope, above).
