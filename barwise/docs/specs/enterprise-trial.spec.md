# Enterprise trial: simulated customers across industries as a standing edge-case ratchet

Status: Workstreams 1, 2, 4 and 6 implemented; the offline lane runs
twelve customers and its findings are ratcheted. Workstream 3 (the
keyed transcript lane) and workstream 5's code-repo amplification are
open. See "What the first run found" and "Implementation notes".

Created: 2026-09-11
Last-updated: 2026-09-11
Tracking: barwise-1032 through barwise-1045 are the findings the first
run produced, each with a reproduction under `trial/findings/`. Companions: `docs/specs/eval-transcript-realism.spec.md`
(the transcript authoring rules the trial's corpus extends),
`docs/specs/eval-difficulty-calibration.spec.md` (three of its five
candidate domains become customers here), `test-plan/README.md` (the
harness shape the trial lane generalises),
`docs/specs/gate-refusal-contract.spec.md` (the three-way exit
contract every trial step is graded against).

## The resolution in one sentence

Barwise runs a multi-week trial of twelve simulated enterprise
customers, each a reproducible scenario package (an industry, three
personas, legacy artifacts amplified to enterprise scale, a six-sprint
journey across the CLI, the MCP server and VS Code, and deterministic
oracles), and every edge case the trial finds lands as a beads issue
with a fixture that fails until it is fixed, never as a paragraph in
a report.

## Principle

Two of the project's rules decide the shape of this trial before any
industry is named.

**A finding is not closed by a document** (`CLAUDE.md`, Conventions).
The obvious trial produces a report: twelve customers, a hundred
findings, a prioritised list. The repository's own history says what
that is worth. `docs/spec-correction-taxonomy-2026-09-11.md` classified
34 recorded spec corrections and found 25 caught by running something
and one caught by a document; `docs/unwired-capability-audit-2026-08-20.md`
found a parity claim that had been false for two years because nothing
checked it. A trial whose output is prose is a trial whose findings
decay at the rate of the next refactor. So the unit of output here is
not the finding but the finding plus its fixture plus its baseline row,
ratcheted the way `audit:duplication`, `audit:rubric` and `audit:specs`
already ratchet: the gate fails on a new unclassified finding and on a
stale row, so the baseline always enumerates exactly what is open.

**Determinism in core, non-determinism one layer out.** Most of what a
customer does with barwise is deterministic: import a schema, validate,
diagram, split a project, diff two versions, export. Those steps can be
scripted, run offline, and gated. Two things are not: transcript
extraction and review call a model, and a customer using the MCP
server through an agent is a model driving a model. The trial keeps
the two apart as two lanes, the way `promptlab` keeps the scorer pure
and the keyed run in `barwise prompt eval`. The offline lane runs in CI
against recorded inputs; the keyed lane runs by hand, records its
payloads, and replays them offline afterwards, which is the mechanism
`docs/specs/offline-eval-rehearsal.spec.md` already built for
`prompt eval`.

The third principle at stake is the one `CLAUDE.md` calls **the shadow
and the property**. A trial produces numbers: pass rates, scores,
seconds. Each is a shadow of something the customer cares about, and
each diverges from it where the mechanism is bypassed. A pass rate
counts steps that exited zero, and a step that exited zero with a
silently wrong export is the finding the trial exists to catch. The
properties the trial ratchets on are named in "What the trial
measures" below; the shadows are printed and never gated.

## Should we simulate customers or recruit them? (resolved: simulate first, in the shape a real customer's intake would take)

The request reads "stimulate real customers"; this spec takes it as
"simulate", and designs so that the other reading costs nothing later.

Recruiting real design partners is the better evidence and the slower
instrument. A real customer brings one industry, one set of artifacts,
and a schedule that is theirs; twelve of them across industries is a
sales programme, not a trial. What a real customer would bring is
exactly what a scenario package holds -- legacy schemas, a dbt project,
an API description, code, meeting transcripts, a change history -- so
the package format is designed as an intake format: a real customer's
artifacts drop into the same slots, behind a redaction step the
`pii-redaction` example already models. The trial's twelve simulated
customers are what runs while no real one has signed.

The refinement that keeps this honest: a simulated customer is only as
adversarial as its author, and an author who knows the product's
limits will route around them without noticing. Each package therefore
declares its stressors up front (the catalog below), and the roster is
reviewed against the catalog for coverage rather than against the
author's sense of what is hard. Difficulty is declared, in the sense
`eval-difficulty-calibration.spec.md` established for the eval suite:
a case says which device it carries and which check grades it.

## Should the trial be a package, a test suite, or a lane? (resolved: a lane, `barwise/trial/`)

Three homes were considered.

- **A workspace package (`@barwise/trial`).** Turborepo would build and
  test it, and it could import `core` directly. That is the problem: a
  trial that imports the library exercises the library, and the
  customer never sees the library. The customer sees the CLI bundle,
  the MCP server over stdio, and the extension. `test-plan/` already
  made this call for the same reason ("it drives the built bundle the
  way a user would").
- **More cases in `promptlab`'s eval suite.** The suite is the
  optimizer's metric, and its own specs say what it must be: a
  business meeting a generalist can follow, with every scored rule
  settled (`eval-transcript-realism.spec.md`, decidability floor;
  `eval-difficulty-calibration.spec.md` rejects difficulty bought by
  domain obscurity). The trial wants the opposite on purpose: a 285-line
  SAP column list nobody can follow, a 30-hour transcript corpus with
  crosstalk and reversals, a bank's three meanings of "Account". Those
  belong in a different instrument, or they turn the metric into noise.
  The transcript corpus the trial authors can later feed the suite
  through that spec's authoring gate, one case at a time; the trial
  does not append to `suite.yaml`.
- **A lane beside `test-plan/` and `optimizer/`.** Dev-time, not an npm
  package, not in the Turborepo graph, drives the bundles as
  subprocesses. `optimizer/` set the convention: "depends on the
  workspace as a subprocess rather than by import", and "nothing there
  may become a runtime dependency". This is the choice.

The lane's deterministic half is a gate (`npm run trial:offline`) with
the three-way exit contract every other gate uses: 0 passed, 1 a
finding regressed or a new one is unclassified, 2 could not answer (no
bundle, no generated artifacts, shallow history for the history
sprint). Its keyed half is a runbook plus a recorder, like
`docs/local-eval-runbook.md`.

## Scope

In scope:

- When `npm run trial:generate -- --customer <id>` runs, the system
  shall build that customer's artifact set from its committed kernel
  and seed, and shall write a manifest of content hashes beside it.
- When `npm run trial:offline` runs with built bundles and generated
  artifacts, the system shall execute every deterministic journey step
  of every customer at every declared scale tier, and shall report each
  step as passed, refused (exit 2 with a named construct), or failed.
- When a step's result matches neither its oracle nor a row in
  `barwise/trial-baseline.json`, the gate shall exit 1 and name the
  customer, sprint, step and oracle.
- When a baseline row's finding no longer reproduces, the gate shall
  exit 1 and name the stale row.
- When the bundles or generated artifacts are absent, the gate shall
  exit 2 and say what to build.
- When `npm run trial:keyed -- --customer <id> --sprint <n>` runs with
  a provider key, the system shall execute that customer's LLM steps,
  record every request and response payload under `trial/recordings/`,
  and append a history row carrying the barwise version, provider,
  model, artifact hash and the recording's hash.
- When `trial:offline` runs after a keyed recording exists, the system
  shall replay the recorded payloads through the same steps and grade
  them with the same oracles, so the keyed sprint's findings are
  reproducible without a key.
- When a trial step produces a finding, the finding shall be filed as a
  beads issue labelled `trial`, `customer:<id>` and `severity:<S1..S5>`,
  with a minimal reproducing fixture under `trial/findings/<issue>/`,
  in the same commit as the baseline row that classifies it.
- When a finding is fixed, the fixture shall move into the owning
  package's test suite and the baseline row shall be removed, in the
  fixing PR.
- When a customer's package is assembled, it shall declare which rows
  of the stressor catalog it carries, and the roster review shall fail
  if any catalog row has no customer.

Out of scope, deferred and named:

- **Fixing what the trial finds.** Each finding is an issue; its fix is
  a separate spec or PR under the owning package's conventions.
- **New importers or exporters.** Two customers deliberately bring
  formats barwise does not read (see the roster); those steps grade the
  refusal, and the format itself is barwise-e8c, barwise-pf2.1 and
  their siblings.
- **Feeding the eval suite.** Any trial transcript that later becomes a
  suite case goes through `eval-difficulty-calibration.spec.md`'s
  authoring gate and bumps the suite version there.
- **Recruiting real design partners.** The intake shape is in scope;
  the recruiting is not.
- **A public benchmark.** The trial's numbers are for the roadmap, not
  for a README.

## The customer roster

Twelve customers, as built. Each kernel is hand-authored, validates
with zero errors, and carries the industry's own modeling difficulties:
a subtype chain at least three deep, an objectified fact type, a ring
constraint, an irreducible ternary, a composite or external key, a
value constraint of thirty or more values, and at least one deontic
rule. The amplification column is the enterprise-tier factor per
artifact, applied to the kernel by the generators.

| Id  | Customer                       | Kernel (OT/FT) | Personas | Contexts | History | Artifacts at enterprise scale                              | Stressors                  |
| --- | ------------------------------ | -------------- | -------: | -------: | ------: | ---------------------------------------------------------- | -------------------------- |
| C01 | Regional hospital network      | 54 / 57        |        3 |        3 |       8 | SQL Server DDL x30 (twice: as sql and as ddl), OpenAPI x10 | K1 K2 K3 K4 K6 K8 K9 K15   |
| C02 | Tier-1 retail bank             | 55 / 59        |        2 |        4 |       7 | Oracle DDL x25 (refusal), Postgres DDL x25, Avro (refusal) | K1 K2 K4 K5 K7 K10 K13 K15 |
| C03 | Property and casualty carrier  | 60 / 62        |        3 |        4 |      15 | Redshift DDL x30, dbt x30                                  | K2 K3 K5 K8 K11 K18        |
| C04 | Global e-commerce marketplace  | 57 / 61        |        2 |        5 |       8 | dbt on Snowflake x15, Snowflake DDL x30                    | K1 K4 K6 K9 K10 K11 K13    |
| C05 | Discrete manufacturer          | 56 / 60        |        2 |        4 |       8 | Databricks DDL x30, Java x30, Kotlin x20                   | K1 K2 K7 K11 K12 K14       |
| C06 | Third-party logistics provider | 54 / 54        |        2 |        4 |       8 | Postgres DDL x25, TypeScript x30                           | K1 K5 K7 K12 K14           |
| C07 | Mobile network operator        | 59 / 60        |        3 |        4 |      10 | BigQuery DDL x30, OpenAPI x30                              | K3 K4 K6 K7 K10            |
| C08 | Electric distribution utility  | 55 / 52        |        3 |        4 |       7 | CIM OWL x40 (refusal), MySQL DDL x25                       | K1 K8 K15 K16              |
| C09 | Pharmaceutical sponsor         | 59 / 59        |        3 |        4 |      10 | NORMA x24, ANSI DDL x30                                    | K3 K4 K5 K9 K11 K17        |
| C10 | State university system        | 59 / 62        |        4 |        7 |      14 | Postgres DDL x30, model scaled x40                         | K2 K10 K11 K13 K14 K18     |
| C11 | Product-analytics vendor       | 59 / 62        |        2 |        4 |       7 | Kotlin x25, dbt on duckdb x12                              | K8 K12 K14 K16 K19         |
| C12 | State benefits agency          | 59 / 62        |        4 |        5 |      12 | DB2 DDL x30 (refusal), Postgres DDL x30                    | K1 K2 K5 K15 K17 K18       |

The nineteen stressor rows are each carried by at least two customers.
Five artifacts are deliberately in formats barwise does not read
(Oracle, DB2 and SQL Server DDL, OWL, Avro): those steps grade the
refusal, and two of them are findings today because the refusal is
invisible rather than named.

The vendor idioms are public naming conventions carried in the skins,
never a vendor's schema: an Epic-style warehouse means abbreviated
upper-case tables with ZC_ lookups and numbered extension tables, a
Banner-style SIS means seven-character tables and TABLE_FIELD columns,
a SAP-style ERP means a client column and German abbreviations. Each
skin also carries a handful of hand-written tables in that idiom,
because an amplifier produces regular mess and a real schema's mess is
irregular.

Three customers grow from what the repository already had: C01 from
`examples/transcripts/clinic-appointments.md`, C04 from the auction
marketplace domain, C10 from `university-enrollment`. C05, C09 and C10
are the manufacturing bill-of-materials, clinical-trial and
curriculum-planning domains that `eval-difficulty-calibration.spec.md`
scored and recommended, so that spec's workstream inherits three
authored kernels.

## The stressor catalog

What makes an enterprise input hard, named so that a customer can
declare it and a reviewer can check coverage. Each row says which
barwise mechanism it lands on and what the oracle observes. The
catalog is the trial's version of the eval suite's device taxonomy
(D1-D5 in `eval-difficulty-calibration.spec.md`); those five devices
are K8's sub-rows, carried by the transcript corpus.

| Id  | Stressor                                                                                                     | Lands on                                        | Oracle observes                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| K1  | Vendor SQL dialect: types, quoting, identifiers, comments and DDL statements outside the ANSI subset         | `formats` DDL importer                          | Every statement is imported, or refused with the statement and construct named; never silently dropped                                     |
| K2  | Cryptic naming: abbreviated, prefixed, 8-character, mixed-language identifiers                               | naming in import; `describe`; verbalization     | Verbalizations read as sentences; `describe` does not invent expansions; `review` flags but does not rename                                |
| K3  | Deep subtyping: 6+ levels, multiple inheritance, subtype-specific mandatory roles                            | validation; diagram layout; DDL export          | Validation is total; layout completes within budget; export chooses a documented table strategy and says which                             |
| K4  | Polymorphism and unions in source: OpenAPI `oneOf`/`allOf`/`@type`, Avro unions, Snowflake VARIANT           | `formats` OpenAPI and Avro importers; dbt       | Each union maps to a declared subtype or a named refusal; VARIANT lands as a value type with a recorded loss                               |
| K5  | Composite and external identification: 3- and 4-part keys, keys spanning fact types                          | reference schemes; external uniqueness; DDL     | Round trip preserves the key; the exported primary key has the same parts in the same order                                                |
| K6  | Large value sets: 500 to 70,000 enumerated values in one value constraint                                    | validation; verbalization; diagram; exports     | Time and memory within tier budget; verbalization elides rather than prints; DDL emits a lookup table, not a 70,000-literal CHECK          |
| K7  | Recursion and rings: BOM part-of, org hierarchies, duplicate-of, circular schema references                  | ring constraints; importers; layout             | Import terminates; ring constraints are carried with their sourced type; layout does not loop                                              |
| K8  | Transcript mess: multi-speaker, timestamps, crosstalk, reversals, tangents, parked questions, D1-D5 devices  | `import transcript`; ambiguity flags            | Seeded contradictions are flagged (recall against the seeded key); settled rules land as the seeded constraint                             |
| K9  | Text encoding: non-ASCII names, emoji, right-to-left, BOM, CRLF, NFC versus NFD                              | every parser; YAML serialization; DDL quoting   | Byte-identical round trip of names; exported identifiers are quoted where the dialect needs it                                             |
| K10 | Name collisions across bounded contexts ("Account" three ways)                                               | `project`; context mappings; `merge`            | `project split` refuses an unmapped collision; `merge` reports rather than unifies                                                         |
| K11 | Objectification and irreducible n-aries at scale (a PolicyVersion, a Coverage-Risk-Term ternary)             | objectified fact types; DDL and dbt export      | Export produces one table per objectified fact with its key; diff sees changes inside it                                                   |
| K12 | Code as source: JPA inheritance strategies, Kotlin sealed classes, TypeScript discriminated unions, generics | `code-analysis` importers                       | Each construct maps or is refused by name; a 1,500-class repo profiles within budget                                                       |
| K13 | Temporal facts: SCD2, bitemporal validity, effective-dated rules                                             | modeling guidance; `review`; verbalization      | `review` recognises the pattern; export carries validity columns; verbalization states the period                                          |
| K14 | Scale of the model itself: 1,500 object types, 4,000 fact types in one file                                  | serializer; validation; diagram; LSP            | Every command completes within the tier budget; the LSP responds within 2 s on the 12,000-line file                                        |
| K15 | Unreadable input: a format barwise does not parse (OWL, DB2), a truncated file, a 40 MB file                 | every importer; the CLI and MCP error paths     | Exit 2 or a tool error naming the format and the first unparseable construct; the MCP server survives the call                             |
| K16 | Hostile content: prompt-injection lines inside a transcript; secrets and PII in source comments              | `import transcript`; `review`; `analyze`        | The injected instruction does not appear in the model or its annotations; secrets do not appear in recorded payloads                       |
| K17 | Deontic and derived rules at volume: thousands of "must"/"may" statements; premium and dose derivations      | deontic modality; derived fact types            | Deontic rules verbalize as warnings; derivations export as documented, not as silently dropped                                             |
| K18 | Long change history: 400 commits, renames, splits, tightened constraints                                     | `history`; `diff`; `merge`; `lineage`; `impact` | `diff` is complete over every element kind; `impact` matches the generated dependency graph; a rename is a rename, not a delete and an add |
| K19 | Agent as the user: an LLM drives the MCP tools end to end                                                    | MCP server; tool descriptions; output budget    | The agent reaches a valid model within the turn budget; every tool call the transcript shows is one a human could have made                |

Two rows are refusal rows on purpose (K15, and the DB2 and OWL halves
of C08 and C12). `gate-refusal-contract.spec.md` made "could not
answer" a first-class result for gates; the trial applies it to
products. A customer with a DB2 schema does not care whether barwise
supports DB2 this quarter; they care whether the tool tells them so in
one line or hands them a stack trace or, worst, a model missing the
tables it did not understand.

## The journey: six sprints per customer

Every customer runs the same six sprints in order. A sprint is a list
of steps; a step is one command or tool call with an oracle. The
sprint order is the order in which a real customer would hit the
product, so a failure early in the journey is the one a real customer
would have hit first.

| Sprint | Name         | Lane    | Steps                                                                                                                                     | Oracles                                                                                                                                                |
| ------ | ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0      | Intake       | offline | Assemble the package; generate artifacts at three tiers; hash them                                                                        | The manifest hashes match on regeneration (the generator is deterministic)                                                                             |
| 1      | Brownfield   | offline | `import` each legacy artifact; `validate`; `describe`; `diagram`; `export` back to the source format; `import` the export                 | Importer totality (K1, K4, K12, K15); the round-trip law: import-export-import is a fixed point up to the format's declared loss set                   |
| 2      | Elicitation  | keyed   | `import transcript` over the corpus (single and `--samples`); `merge` into the brownfield model; `review`                                 | Seeded-defect recall on ambiguity flags (K8, K16); edit distance from the draft to a model the persona accepts; replay parity offline                  |
| 3      | Governance   | offline | `project split` into bounded contexts; `query`, `lineage`, `impact` across mappings; `describe --focus` per domain                        | The split is lossless (union of domains and mappings equals the monolith); `impact` equals the generated dependency graph (K10, K18)                   |
| 4      | Downstream   | offline | `export` DDL in the customer's dialect, dbt, OpenAPI, Avro, NORMA; hand each export to its consumer                                       | Each export parses in its target tool: sqlglot for DDL in the customer's dialect, an OpenAPI validator, the Avro parser, NORMA re-import (K5, K6, K11) |
| 5      | Change storm | offline | Replay the generated commit series; `diff` and `merge` each step; `history`; `lineage` staleness                                          | `diff` completeness by element kind; rename detection; no merge that silently drops a removal (K18)                                                    |
| 6      | Surfaces     | mixed   | Persona acceptance over each model barwise produced; the release bundle as shipped; validate, export and verbalize through the MCP server | Persona checks pass; cross-surface parity: same input, same findings                                                                                   |

The keyed lane is sprint 2 and the agent half of sprint 6. Both record.
A recording is keyed by the content hash of the prompt artifact and the
input, the way `prompt eval --save-payloads` records, so a re-run under
a new barwise version that changes the prompt is a new recording and
the old one stays comparable to its own version.

## What the trial measures

The properties, each with the shadow it is not to be confused with.

| Property                    | Definition                                                                                                                   | The shadow that is printed but not gated        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Totality                    | Fraction of steps that answered: passed, or refused with the construct named. A crash, a hang, or a silent partial is a miss | Pass rate (counts the silent partial as a pass) |
| Round-trip fidelity         | Size of `diff` after import-export-import, minus the format's declared loss set                                              | "Export succeeded"                              |
| Edit distance to acceptance | Number of YAML edits a persona needs from the tool's draft to a model the persona's acceptance oracle passes                 | The extraction score                            |
| Seeded-defect recall        | Fraction of seeded contradictions, injections and decoys the ambiguity flags or `review` surfaces                            | Number of ambiguities flagged                   |
| Budget adherence            | Every step within its tier's time and memory budget                                                                          | Mean latency                                    |
| Cross-surface parity        | CLI and MCP produce the same findings from the same input, byte-for-byte after normalising paths                             | "Both ran"                                      |

The declared loss set is what makes round-trip fidelity a property
rather than a wish. Every format loses something (DDL has no ring
constraints; Avro has no uniqueness), and `docs/IMPORT_EXPORT.md` says
so in prose. The trial turns that prose into a per-format list of
element kinds the round trip may drop, checked into
`trial/loss-sets/<format>.json`, so that a drop outside the list is a
finding and a drop inside it is a documented limitation. When an
exporter gains a construct, the list shrinks in the same PR, which is
the parity rule applied to a document that restates code facts.

## Severity: what kind of finding it is

| Severity | Meaning                                                              | Example                                                                             | Disposition                                                      |
| -------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| S1       | Silent wrong output: the tool exited zero and the artifact is wrong  | A 4-part key exported with 3 parts; a table the DDL importer skipped without a word | Bug, p1. Fixture into the owning package before anything else    |
| S2       | Crash, hang, or resource exhaustion                                  | Stack trace on a PostGIS type; layout that never returns on a 12-level BOM          | Bug, p1 or p2 by tier                                            |
| S3       | Unnamed refusal: an error that does not say which construct or where | "Import failed"; exit 1 with no line number                                         | Bug, p2. The refusal contract applies to products                |
| S4       | Named limitation: the tool refused and said why                      | "DB2 dialect is not supported; first unparseable statement at line 40"              | Roadmap row, not a bug. Recorded in the baseline as `documented` |
| S5       | Ergonomics, documentation, or a slow step still within budget        | A flag a persona could not find in `--help`                                         | Issue, p3 or p4                                                  |

S1 outranks S2 because a crash is visible and a wrong export is not.
The oracles are written to see S1: a round-trip diff, a consumer that
parses the export, a key comparison. A trial whose oracles are "did it
exit zero" finds only S2 and S3, which is what `test-plan/` finds
today.

## Inventory

| Area                                                                    | Current state                                                                                                | Verdict                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `test-plan/` (`cli-checks.sh`, `mcp-checks.mjs`, `vscode-checklist.md`) | A shakedown of every command against the shipped examples; asserts exit codes and key output; three-way exit | Stays. The trial lane generalises its shape (a step with an oracle) and reuses its MCP client harness       |
| `examples/` (9 transcripts, 3 modeled; `auction-project/`, 4 domains)   | Toy-scale domains, one real multi-domain project                                                             | Stays. Three kernels grow from it                                                                           |
| `packages/promptlab/evals/` (10 cases, suite 2.12.0)                    | The optimizer's metric; 3 realistic transcripts; recorded payloads under `tests/fixtures/responses/`         | Untouched. The trial does not append cases                                                                  |
| `packages/cli/tests/commands/promptEvalOffline.test.ts`                 | Drives `prompt eval` against a loopback Ollama server serving recorded fixtures                              | Untouched; its loopback-server pattern is what `trial:offline` replay reuses                                |
| `packages/learn/exercises/` (1 exercise)                                | One novice-to-initiate gym exercise                                                                          | Untouched by the trial; C05, C09 and C10 kernels are candidates for later exercises                         |
| `docs/IMPORT_EXPORT.md`                                                 | Prose on what each format loses                                                                              | Modify: each loss statement gains a pointer to its `trial/loss-sets/` row                                   |
| `scripts/audit-*.mjs`, `*-baseline.json`                                | Four ratchets, each failing on a new unclassified finding and a stale row                                    | Untouched; `trial/gate.mjs` follows their shape and `scripts/lib/` if a shared baseline helper exists there |
| `pyproject.toml`, `uv.lock` (sqlglot as an optional dependency group)   | The optimizer lane's Python; sqlglot available `--only-group`                                                | Modify: a `trial` group for the sprint-4 consumers, resolved `--frozen`                                     |
| `ci.yml`, `scripts/ci-local.mjs`                                        | The gate list CI runs; `ci:local` derives from it                                                            | Modify in WS6 only: the small-tier `trial:offline` joins the list; larger tiers are scheduled or on demand  |
| `CLAUDE.md` capability matrix                                           | Hand-maintained per-surface reach                                                                            | Untouched by the trial; sprint 6 findings that contradict it are S1 findings against the table              |

Everything under `packages/*/src` is untouched by this spec. A trial
that has to change the product to run is measuring a product that does
not exist.

## Target architecture

```
barwise/trial/
  README.md                       what the lane is, how to run each half
  AUTHORING.md                    the customer-package format, binding on an author
  customers/C01-hospital/         one directory per customer (twelve of them)
    customer.yaml                 industry, personas, stressors, artifacts, contexts, history, budgets
    kernel.orm.yaml               the hand-authored 50-60 object-type seed
    personas/<id>.gym.yaml        one acceptance rubric per persona, as a gym exercise
    skins/<name>.yaml             per-artifact generator config (dialect, naming idiom, idioms, extra tables)
    transcripts/                  authored corpus with its seeded-defect key
    generated/<tier>/             derived artifacts and run scratch; gitignored
  lib/
    run.mjs                       trial:generate / trial:offline / trial:keyed / list
    gate.mjs                      the ratchet against ../../trial-baseline.json
    steps.mjs                     the six sprints, as functions over one customer at one tier
    classify.mjs                  a failing step -> a finding class in findings/catalog.json
    oracles/grade.mjs             every grader, pure over its inputs
    generators/                   kernel + skin + seed -> artifact
      ddl.mjs openapi.mjs dbt.mjs code.mjs norma.mjs unreadable.mjs scale.mjs history.mjs transcript.mjs
    model.mjs paths.mjs exec.mjs prng.mjs mcp.mjs
  loss-sets/<format>.json         what a round trip through <format> may drop
  consumers/parse_ddl.py          the sprint-4 DDL consumer (sqlglot, uv --frozen --only-group sqlglot)
  findings/catalog.json           the finding classes; how the gate classifies a new row
  findings/<issue>/               minimal reproduction per open finding
  tests/                          a planted failure per oracle; the history generator's guards
  results/<tier>.json             the latest run; gitignored
barwise-baseline: barwise/trial-baseline.json   open findings, each classified with its issue
```

**The journey is not per-customer.** The draft gave each package a
`journey.yaml` listing its steps. Twelve copies of one list is the
must-agree duplication `CLAUDE.md` forbids, and the first customer made
that obvious: every sprint is the same six commands over whatever the
package declares. The sprints live once, in `lib/steps.mjs`; a customer
varies by its artifacts, contexts, history and personas, never by its
journey. The same reasoning replaced the draft's `acceptance/` directory
with `personas/<id>.gym.yaml`: a persona's acceptance oracle is a
modeling-gym exercise, so `barwise gym check` grades it and the rubric
vocabulary is the one the eval suite and the gym already share.

The generated artifacts do not live in git. A kernel is small and is
committed; an enterprise-tier DDL file is 40 MB and is regenerated
from kernel, skin and seed, with the manifest hash committed. This is
the same arrangement `regen-builtin-artifacts.mjs` uses for prompt
artifacts and `regen:examples` for example outputs: the source is
committed, the derivation is scripted, and a drift check proves the
derivation still yields the committed hash.

## Alternatives considered

- **Hand-author every artifact at enterprise scale.** Twelve customers
  times six artifact kinds at 1,000-table scale is not authorable by
  hand in weeks, and a hand-authored file cannot be regenerated at
  three tiers. Lost to the kernel-plus-generator design. The cost
  carried: a generator produces regular mess, and real mess is
  irregular; the skins and the seeded-defect keys are where the
  irregularity is injected on purpose.
- **Have an LLM generate the artifacts at trial time.** Fast to start,
  impossible to reproduce: a finding against a schema that no longer
  exists cannot be bisected. An LLM authors the kernels and the
  transcript corpus offline, once, under a persona brief, and the
  result is hand-edited, frozen and committed with its key -- which is
  how the three realistic eval transcripts were made.
- **Score customers with a rubric like the eval suite's.** The suite's
  rubric grades an extraction against a reference; the trial grades a
  journey against oracles, most of which have no reference at all
  (round-trip fixed points, consumer parses, parity). Where a reference
  exists (the seeded-defect key), the trial reuses the suite's check
  vocabulary (`requires_element`, `forbids_population`,
  `requires_ambiguity`) rather than inventing one.
- **Run everything keyed, every time.** Costs money per run, so it runs
  rarely, so its findings are not ratcheted. The offline lane is what
  runs on every PR; the keyed lane is what makes the offline lane's
  recordings.

## Workstreams (each independently shippable)

Ordered smallest blast radius first. Each keeps the suite green as its
own PR; each files its bd issue when it lands. Workstreams 2 through 6
are drafted ahead of their grounding and say so.

### 1. The lane, the package format, and one customer at small tier (landed)

`trial/` with `README.md`, `package-schema.json`, `run.mjs`, `gate.mjs`,
`trial-baseline.json` empty, and C01 at the small tier only: its kernel
(grown from `clinic-appointments`), a `journey.yaml` with sprints 1, 3
and 4, the round-trip and key-parity oracles, and the DDL loss set.
Acceptance: when `npm run trial:offline` runs against built bundles,
the system shall execute C01's sprint-1 steps and exit 0, 1 or 2 per
the contract; when the bundle is absent, it shall exit 2 and name the
build command. This workstream is the one that proves the shape;
everything after it is content.

### 2. Generators and skins for the SQL dialects, dbt, OpenAPI, Avro and NORMA (landed)

The amplifiers, each a pure function of kernel, skin and seed, with a
determinism test (two runs, one hash). Enterprise tiers for C01, C02,
C04, C07 and C09. This is where the first S1 findings are expected:
the DDL importer against Oracle and SQL Server idioms, the OpenAPI
importer against circular references. The workstream stops at
generating and importing; it does not fix.

### 3. The transcript corpus and the keyed lane (open)

`transcript-mess.mjs` (timestamps, crosstalk, speaker labels, reversal
injection over an authored clean transcript), the seeded-defect key
format, the recorder, and replay through the loopback-server pattern.
C11's 300,000-word corpus and C01's clinician-billing sessions. The
authoring rules are `eval-transcript-realism.spec.md`'s; the mess is
what that spec's decidability floor forbids for the suite and what the
trial exists to apply.

### 4. Governance, history and the change storm (landed)

`history.mjs` generating a commit series from a kernel (renames,
splits, tightened constraints, a bounded-context extraction), the
lossless-split oracle, and the dependency-graph oracle for `impact`.
C03, C10 and C12 enterprise tiers.

### 5. Code sources and downstream consumers (landed for the consumers; the code generator is small-scale)

`code.mjs` for Java, Kotlin and TypeScript repos at 800 to 1,500
classes; the `trial` dependency group with sqlglot; the OpenAPI and
Avro consumers. C05 and C06 enterprise tiers; sprint 4 for every
customer that has one.

### 6. Surfaces, personas, and the CI schedule (landed except the CI wiring and the agent journey)

The MCP rerun of sprints 1, 3 and 4 with the parity oracle; the C10
editor checklist with LSP timings; the C11 and K19 agent briefs under
`trial/personas/` run through the subagent channel
`docs/agent-eval-2026-08-09.md` used, recorded; and the CI wiring: the
small tier joins `ci.yml` and therefore `ci:local`, the medium tier
runs on a weekly schedule, the enterprise tier on demand.

## What the first run found

Twelve customers, 788 steps at the small tier, 136 failing. Every
failing step is classified into one of nineteen finding classes across
fourteen beads issues, each with a reproduction under
`trial/findings/<issue>/` and a row in `trial-baseline.json`.

| Outcome                                    | Steps |
| ------------------------------------------ | ----: |
| passed                                     |   620 |
| failed, silent wrong output (S1)           |    79 |
| failed, edit distance to acceptance (S5)   |    36 |
| failed, unnamed refusal (S3)               |    21 |
| refused: the product declined and said why |    31 |
| could not answer                           |     1 |

No step crashed or hung (no S2 at this tier). The one "could not
answer" is C08's keyed sprint with no provider key, which is the
contract working.

The findings, by what a customer would have hit first:

| Issue        | What a customer sees                                                                                                     | Sev                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| barwise-1032 | `import sql` returns the targets of FOREIGN KEY clauses, not the tables; 24% to 100% of tables dropped without a warning | S1                                           |
| barwise-1033 | `import model --format ddl` is one regex: schema-qualified, bracketed, backticked and unterminated statements all miss   | S3                                           |
| barwise-1034 | The OpenAPI and DDL importers write duplicate role ids, so every model they produce fails validation                     | S1                                           |
| barwise-1035 | The OpenAPI export writes a `/* */` header into a .json file, which nothing can parse back                               | S1                                           |
| barwise-1036 | DDL export then import is not a fixed point; the annotated export re-imports with zero fact types                        | S1                                           |
| barwise-1037 | The dbt importer throws when two relationship tests derive one reading, which its own export produces                    | S3                                           |
| barwise-1038 | dbt round trip loses value types and value constraints beyond the declared loss set                                      | S1                                           |
| barwise-1039 | NORMA round trip re-homes subset, exclusion and external-uniqueness constraints onto sibling fact types                  | S1                                           |
| barwise-1040 | `diff` reports six of fourteen object-type renames as a removal plus an addition, with no stated rule                    | S5                                           |
| barwise-1041 | The Kotlin importer returns an empty model for data classes and sealed classes                                           | S1                                           |
| barwise-1042 | `merge` exits 1 with "1 structural error(s)" on a fact-type rename and does not say which                                | S3                                           |
| barwise-1043 | The release CLI bundle cannot find its own gym catalog: `gym list` fails with a Node path error                          | S3                                           |
| barwise-1044 | `barwise diff a b                                                                                                        | head` ends in an unhandled EPIPE stack trace | S2 |
| barwise-1045 | OpenAPI round trip drops every value type's length, definition and value constraint                                      | S1                                           |

Four of these are what the trial was built to find and nothing else
would have: barwise-1032 and barwise-1041 are importers that exit zero
on an empty or partial result, barwise-1035 and barwise-1043 are
artifacts the product itself writes that the product itself cannot
read. The unit suites are green across all twelve packages while every
one of these holds.

**What held up.** The deterministic core did not fail once: validate,
verbalize, describe, schema, query and diagram completed on every model
at every tier, and `project split` was lossless on ten of twelve
customers and warned its dropped cross-domain constraints on the other
two. All 69 downstream-consumer checks passed, which means the exports
are well formed even where the round trip loses meaning. At the
enterprise tier C01 is a 1,710-object-type model from a 57-type kernel:
validate 1.7s, diagram 8.6s, every export under 4s, no budget breach.

## Implementation notes

Deviations from the draft, recorded so the next workstream starts from
reality (the `spec-writer` convention).

- **The journey moved out of the package**, and the acceptance oracles
  became gym exercises. See Target architecture.
- **A finding class, not a free-text note, is what classifies a
  failure.** The draft had an operator writing a note per baseline row.
  At 136 rows that is not a review, it is transcription, and the notes
  would drift from the issues. `findings/catalog.json` holds one class
  per issue with the matchers that recognise it (step pattern,
  importer, detail substring); `lib/classify.mjs` applies them; the
  gate writes the class's note. A failure no class matches stays
  unclassified and keeps the gate red, which is the property the draft
  wanted.
- **Persona failures are S5, not S1.** The draft's severity table read
  a failed acceptance check as silent wrong output. It is not: the
  model is visibly incomplete, and the number that matters is how far
  it is from acceptance. The exception is a failed `must_validate`,
  which means the importer wrote a structurally invalid model, and that
  is S1. `gradeAcceptance` splits on exactly that.
- **Three harness defects were filed as product findings before they
  were caught**, all the same shape: a history step that is a no-op (a
  duplicate mandatory constraint, a fact type that already exists, a
  subtype already declared) is not a delta, so `diff` reporting "No
  changes" is correct and the trial was wrong. `applyChange` now
  refuses each, and `trial/tests/history.test.mjs` pins all three. This
  is the trial's own version of the defect it exists to catch: an
  instrument that cannot tell "nothing happened" from "nothing was
  reported".
- **The lane's own subprocess buffer had to be raised** before the
  enterprise tier would run: `git show` on a 1.2 MB revision exceeds
  Node's 1 MiB default. Worth stating because the product sets no
  `maxBuffer` anywhere either, and the draft predicted `barwise history`
  would fail at that size. It did not: the enterprise change storm runs
  clean. The prediction was wrong and the row is removed rather than
  kept as a suspicion.
- **The Avro consumer reads a directory.** `barwise export --format
  avro` writes one `.avsc` per record, not one file; the draft's
  consumer assumed a file and crashed the runner on the first customer
  that reached sprint 4.
- **The lane stopped carrying its own format validators.** Sprint 4
  originally handed each export to a checker the lane owned: a sqlglot
  sidecar for DDL, and hand-written readers for OpenAPI, Avro, dbt and
  NORMA. That is scaffolding standing in for a product feature, and a
  trial whose harness writes its own parser is measuring the harness.
  The step is now `read-back:<format>`: export, then read it back with
  barwise's own importer and validate what comes back. Avro has no
  importer, so that step records could-not-answer rather than the lane
  inventing one. The rewrite immediately found barwise-1047, which the
  bespoke checkers could not have: they graded the file's syntax, and
  the defect is that barwise cannot read its own NORMA output into a
  valid model.

- **Late-arriving requirements are their own sprint.** Nobody ever has
  all the details in time, so a journey that models only the initial
  build is not the journey. Sprint 4b exports first (so a lineage
  manifest exists), lands one requirement the customer package declares,
  then asks barwise what went stale, what depends on the changed
  element, whether the change is visible to `diff`, whether it reached
  the re-exported artifact, and whether the personas still accept the
  model. Every command already ships, and `lineage` in particular was
  exercised by nothing else in the lane. All 128 of these steps pass
  across the twelve customers, which is the strongest single result the
  trial has produced.

- **The corrections ratchet fires on this spec, and could not fire
  before the spec was committed.** `audit:corrections` reads tracked
  files, so an untracked spec is invisible to it: `ci:local` passed on
  the very content CI then rejected. The six records this spec's
  implementation notes produce are classified in
  `correction-baseline.json`; two are the same correction recorded in
  two sections, and three are the detector being deliberately
  over-inclusive (a table row using "draft" to mean a draft model, a
  section heading, a risk entry). Nothing to fix in the gate: run it
  after committing, not before.

- **`--samples`, `--thinking-budget` and the MCP parity of
  `describe` are not exercised.** The first two belong to the keyed
  lane (workstream 3). The third is blocked by the MCP inline-output
  limit: `export_model` and `verbalize_model` spill to a cache file
  above 8192 bytes, so the parity oracle records "refused: not
  comparable inline" rather than pretending. Comparing spilled output
  means reading the cache file, which is a step the parity oracle should
  grow.

## Calendar

The first four rows landed in one session rather than four weeks: the
generators and the twelve packages are authoring work, and authoring
parallelises. What remains is the keyed lane and the scale tiers, which
do not.

| Week | Lands                                                       | Runs                                                | State                                    |
| ---- | ----------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| 1    | WS1, WS2, WS4; twelve kernels, 33 personas, 26 artifacts    | Small tier, sprints 1, 3, 4, 5, 6, twelve customers | Done: 788 steps, 136 findings, 14 issues |
| 2    | Fixes for the S1 importers (barwise-1032, 1023, 1030)       | `trial:offline` per PR; baseline rows come out      | Next                                     |
| 3    | WS3: the keyed lane, the recorder, the seeded-defect grader | Keyed sprint 2 for C01 and C11, then replay offline | Open; needs a provider key               |
| 4    | Medium and enterprise tiers for all twelve                  | Sprint 1 and 5 at scale                             | Open; proven for C01 and C10 only        |
| 5    | The agent journey (K19) and the C10 editor checklist        | Sprint 6 through the subagent channel               | Open                                     |
| 6    | CI wiring: small tier in `ci.yml`, medium weekly            | Every PR                                            | Open; see Open decisions                 |

## API and migration impact

- No package's public API changes. The lane consumes the CLI bundle,
  the MCP bundle and the extension as a customer would.
- `package.json` gains `trial:generate`, `trial:offline` and
  `trial:keyed`; `scripts/regen-root-package.mjs` regenerates the root
  forwarders and `check:root-scripts` proves it.
- `pyproject.toml` gains a `trial` dependency group; `uv.lock` is
  re-resolved once and `check:python-uv` keeps every invocation
  `--frozen`.
- `ci.yml` gains the small-tier gate in WS6; `ci:local` derives it.
- Disk: generated enterprise tiers are gitignored under
  `trial/customers/*/generated/`; the manifest of hashes is not.

## Open decisions (for review)

- **Twelve customers or six (resolved: twelve, built).** All nineteen
  stressor rows are covered, across nine SQL dialects, 686 object types
  and 710 fact types of hand-authored kernel. The authoring cost was
  lower than the draft assumed because the packages are independent.
- **Where generated artifacts live (resolved: regenerated).**
  `trial/customers/*/generated/` is gitignored; `trial:generate` rebuilds
  a tier from kernel, skin and seed, and writes a manifest of content
  hashes beside it. The runner exits 2 and names the command when a
  tier is absent. The committed lane is 3 MB; C01's enterprise tier
  alone is 15 MB of derived files.

- **The manifest hashes are written and not yet checked.** Nothing
  re-runs `trial:generate` and compares, so "the generator is
  deterministic" is a property the design rests on and no gate asserts.
  A drift check is a few lines and belongs in the CI wiring workstream;
  until it lands, treat the determinism claim as unverified.
- **How much of `trial:offline` runs per PR.** Measured: the small tier
  is about twelve minutes for twelve customers (788 steps, each a
  process spawn), the medium tier about four minutes for one customer,
  the enterprise tier about a minute per sprint for one. Twelve minutes
  per PR is too much for the pre-push hook and defensible in CI as its
  own job. Recommend one customer per PR (about a minute) in
  `ci:local`, the full small tier as a separate CI job, medium weekly,
  enterprise on demand. This is the one decision the implementation did
  not settle, because nothing is wired into `ci.yml` yet.
- **The agent channel for K19.** Claude Code subagents pinned to a
  model, as `docs/agent-eval-2026-08-09.md` did (no key, but one
  session channel and hand-run), or an API-driven harness that can
  record (a key, a runner to write). Recommend subagents in WS6 with
  the transcript saved as the recording, and revisit if K19 finds
  enough to want re-runs.
- **Refusal customers in or out.** C08's OWL and C12's DB2 test what
  barwise does when it cannot read the input. They cost two kernels
  and find S3 findings the other ten cannot. Recommend in; the
  argument against is that they are the two customers whose sprint 1
  is mostly one step.
- **Real-customer intake and redaction.** Whether `package-schema.json`
  carries a redaction manifest from WS1 (a real customer's schema drops
  in behind it) or that waits for a real customer. Recommend the schema
  reserves the field now and nothing implements it; an unused field is
  cheaper than a format migration.
- **Personas as acceptance oracles.** A persona's acceptance oracle is
  a list of checks in the suite's vocabulary ("the DBA accepts when
  every table has a key and every key survives export"). That is a
  deterministic stand-in for a human and it is only as good as its
  author. The alternative is an LLM-as-judge reading the model in the
  persona's voice, which is keyed and non-deterministic. Recommend
  checks as the gate and the judge as an advisory column in the keyed
  lane's report, never gated -- a judge is a shadow.

## Risks and testing

- **The generator produces regular mess.** A generator that emits
  1,500 tables from a 60-type kernel emits 25 variations of each type;
  a real ERP has 1,500 different tables. The skins carry hand-written
  irregularity lists (the SAP skin has 40 real table names and column
  idioms; the Epic skin has its ZC_ pattern and its 1:1 extension
  tables), and each kernel is authored with the irregular cases in,
  not amplified in. Tripwire: if sprint-1 findings at enterprise tier
  are all duplicates of small-tier findings, the amplifier is adding
  size and not difficulty, and WS2 should spend its remaining time on
  the skins.
- **Oracles that cannot fail.** The taxonomy document found four
  checks that could not fail across the specs, one written by an
  author who knew the rule. Every oracle in `trial/oracles/` ships
  with a mutation: a known-bad artifact it must reject, run by the
  lane's own test (`trial/tests/`), the way `mutate.mjs` proves gates.
- **The trial finds more than the team can fix.** Expected. The
  baseline is the backlog; the severity column orders it; S4 rows are
  roadmap, not debt. Tripwire: if S1 findings exceed ten in a week,
  stop authoring customers and fix, because ten silent wrong outputs
  is the product's problem, not the trial's.
- **The keyed lane's recordings go stale.** A prompt artifact change
  invalidates every recording made under it. Recordings are keyed by
  artifact hash; `trial:offline` reports recordings whose artifact no
  longer resolves as "could not answer" for that step, not as passed.
- **Behaviour that must not change.** Nothing in `packages/*/src`
  changes under this spec; the full suite is the guard. Each workstream
  runs `npm run ci:local` before push, as the pre-push hook already
  does.
- **Landing.** Six PRs, one per workstream. WS1 is the one to review
  for shape; if the package format is wrong there, the other five
  build on it.

## Non-goals

- No product capability is added, removed or changed by this spec.
- The eval suite's version, cases, weights and history are untouched.
- No claim about barwise's fitness for any named vendor product: the
  skins borrow naming idioms (Epic, SAP, Guidewire, Banner, TM Forum,
  CDISC), not schemas, and the trial does not assert compatibility with
  any of them.
- No real customer data. Every artifact is generated or authored; the
  redaction field is reserved and unimplemented.
