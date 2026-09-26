# Key-column data types survive dbt import, and export annotations stop reporting gaps that are not there

Status: Implemented 2026-09-26 -- WS1, WS2 and WS3 (see Implementation notes)

Created: 2026-09-24
Last-updated: 2026-09-26
Tracking: barwise-1057 (follow-up for the DDL importer: barwise-1058)

A dbt `data_type` on a primary-key or foreign-key column is dropped on
import, the relational mapper then types the key from whichever
attribute it finds first, and the export annotations report "defaulted
to TEXT" and "no column description" on columns that have both. The fix
is to import a key as what a reference mode abbreviates -- a typed
identifier value type in a preferred identifying binary -- to stop the
mapper borrowing an unrelated attribute's type, and to make each
annotation fire only on the gap it names.

## Principle

**Explicit over implicit.** The dbt YAML states each key's type
explicitly; the model the importer builds has nowhere to hold it, so
every consumer downstream infers one instead. The mapper's inference is
wrong in 90 of the 93 cases where it fires on this repository's own
models (measured below), and the annotation layer then reports the
inference's fallback as the user's omission. The information exists at
the source; the defect is that it is discarded at the first step and
guessed at every later one.

**Orthogonality.** `ExportAnnotationCollector` is shared by the dbt,
DDL, OpenAPI, Avro and diagram surfaces, but its messages were lifted
from the dbt annotator and still tell a DDL reader to "edit the dbt
YAML". A shared collector that speaks one format's language couples
every other format to it.

## What the user sees (reproduced 2026-09-24)

A two-model dbt project -- `customers(customer_id number PK,
customer_name varchar, is_active boolean, created_at timestamp_ntz)` and
`orders(order_id number PK, customer_id number FK, order_total
number(10,2))` -- imported with `barwise import dbt` and exported with
`barwise export --format ddl`:

| dbt column                 | In the `.orm.yaml`                     | DDL column type                       | Annotations emitted                                   |
| -------------------------- | -------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `customers.customer_id` PK | `reference_mode: customer_id`, no type | `TEXT`                                | "defaulted to TEXT", "no description"                 |
| `customers.customer_name`  | value type, `data_type: text`          | `TEXT`                                | "defaulted to TEXT" (false), "no description" (false) |
| `customers.is_active`      | value type, `data_type: boolean`       | `BOOLEAN`                             | "no description" (false)                              |
| `orders.order_id` PK       | `reference_mode: order_id`, no type    | `DECIMAL(10,2)` -- from `order_total` | "no description"                                      |
| `orders.customer_id` FK    | entity-to-entity fact type, no type    | `TEXT`                                | "defaulted to TEXT", "no description"                 |

The VS Code "Import from dbt Project" command calls the same
`importDbtProject`, so the editor produces the same model. The diagram's
right-hand Annotations panel shows the same "defaulted to TEXT" lines
(`collectAnnotationMap` filters out only the per-column description
nags), once per affected column, without saying which column.

## Scope

In scope, as EARS requirements:

- **R1.** When a dbt model has an identifiable primary-key column, the
  importer shall create an identifier value type for it carrying the
  column's resolved `data_type` (model column first, then source column,
  as `valueTypes.ts` already resolves non-key columns) and the column's
  description (explicit or inferred), and a binary fact type between
  the entity and that value type whose value-side uniqueness is
  preferred, with a uniqueness and a mandatory constraint on the entity
  side. It shall never reuse an object type of another kind or another
  data type as that identifier (D1).
- **R2.** When the relational mapper types a key for an entity with no
  preferred identifying binary, it shall take a data type only from a
  binary whose value player's snake-cased name equals the entity's
  reference mode, and otherwise use the configured fallback. It shall
  not take the type of an unrelated attribute.
- **R3.** When a column's type comes from a declared data type -- on its
  source value type, or on the key it references -- the collector shall
  not emit the "defaulted" TODO, whatever SQL string the type maps to.
  It shall emit that TODO only when the mapper actually used the
  fallback.
- **R4.** When a column's source value type (or identifier value type)
  has a definition, the collector shall not emit the "no column
  description" TODO.
- **R5.** The collector's messages shall name no export format. The dbt
  annotator may append its dbt-specific remedy when it renders a
  message.
- **R6.** When the diagram Annotations panel shows a column-level
  annotation, it shall name the column.

Out of scope:

- The DDL importer (`@barwise/formats`) has the same gap: it skips
  `PRIMARY KEY` columns and records only a reference mode. It adopts the
  R1 pattern in a follow-up (barwise-1058) once this lands, so one
  importer proves it first.
- Comparing a foreign key's declared dbt `data_type` with the type of
  the key it references. After R1 the FK column inherits the referenced
  key's type, which is what the mapper already does; a mismatch warning
  in the import report is a separate improvement.
- Composite primary keys. `pkMap` detects single-column keys only
  (`unique` + `not_null` on one column); models without one are skipped
  as entities today and stay that way.
- The other identifier heuristics. `identification.ts` notes four
  modules computing "the preferred identifier" with different rules;
  converging them is tracked separately. R2 changes only the mapper's
  fallback path.

## Inventory

| Module                                                       | Current state                                                                                    | Verdict                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `dbt/src/dbtMapping/entityTypes.ts`                          | Creates the entity with `referenceMode: pk.columnName`; the key's type is never read             | WS1: also create the identifier value type and its preferred binary                  |
| `dbt/src/dbtMapping/valueTypes.ts`                           | Skips PK and FK columns (lines 19-21); resolves `data_type` for the rest                         | WS1: share its data-type resolution with the key path; skip logic stays              |
| `core/src/mapping/RelationalMapper.ts` `referenceModePkType` | First binary with any value player supplies the key type                                         | WS2: accept only the value player the reference mode names                           |
| `core/src/mapping/RelationalSchema.ts` `Column`              | `dataType: string` only; nothing records whether it was declared or a fallback                   | WS3: add `dataTypeDefaulted` (see Decisions, D2)                                     |
| `core/src/annotation/ExportAnnotationCollector.ts`           | "defaulted" keyed on the SQL string `"TEXT"`; "no column description" unconditional; dbt wording | WS3: key on `dataTypeDefaulted` and the source definition; format-neutral messages   |
| `core/src/mapping/renderers/DbtExportAnnotator.ts`           | Renders collector messages verbatim                                                              | WS3: appends the dbt remedy to the neutral message                                   |
| `core/src/annotation/exportAnnotationMap.ts`                 | `TODO(barwise): <message>`; column dropped                                                       | WS3: `TODO(barwise): <column>: <message>` for column-level annotations               |
| `diagram/src/graph/ModelToGraph.ts`                          | Absorbs a preferred identifying binary into the entity's "(.ref_mode)" label                     | untouched -- verified at lines 99-135; the new binary renders as today's entity does |
| `vscode/src/commands/ImportDbtCommand.ts`                    | Calls `importDbtProject`                                                                         | untouched -- inherits WS1                                                            |

`DdlExportFormat`, the OpenAPI and Avro exporters, and the MCP and CLI
diagram commands consume the collector and the mapper unchanged; they
pick up WS2 and WS3 without edits beyond their tests' expected strings
(`formats/tests/{Ddl,OpenApi,Avro}ExportFormat.test.ts`,
`core/tests/mapping/DbtExportAnnotator.test.ts`).

## Should the importer write an identifier value type, or a data type on the entity? (resolved: identifier value type)

A reference mode is shorthand for an identifying binary between the
entity and a value type (`identification.ts`, `PreferredIdentifyingBinary`);
NORMA stores it the same way, with the data type on the implicit value
type. Barwise already reads the long form everywhere it matters: the
mapper names and types the key from the preferred binary
(`RelationalMapper.ts:111-122`) and marks that binary spent so it is not
mapped twice (barwise-967), and the diagram folds it back into the
"(.ref_mode)" label. Writing the long form therefore needs no schema
change and no consumer change. The short form -- a new
`reference_mode_data_type` field -- would need an `orm_version` bump,
serializer and JSON-schema work, a NORMA mapping, and a second path
through the mapper that answers the same question the preferred binary
already answers. See Alternatives.

## Target architecture

```
dbt YAML                        .orm.yaml (after WS1)
--------                        ---------------------
customers:                      Customers   entity, reference_mode: customer_id
  customer_id  number  PK   ->  CustomerId  value,  data_type: decimal
                                "Customers has CustomerId"
                                  uniqueness(CustomerId role, preferred)
                                  uniqueness(Customers role) + mandatory
  customer_name varchar     ->  CustomerName value, data_type: text   (unchanged)

RelationalMapper (unchanged path)          ExportAnnotationCollector (WS3)
  preferredIdentifyingBinary(Customers)      "defaulted"  iff column.dataTypeDefaulted
    -> pk column customer_id DECIMAL          "no description" iff source VT has no definition
  orders.customer_id FK copies DECIMAL        messages format-neutral; dbt annotator adds
                                              "or edit the dbt YAML"
```

## Alternatives considered

- **A data type on the entity (`reference_mode_data_type`).** Smaller
  diff in the importer, but it is a second representation of a fact the
  metamodel already represents, so every consumer that reads identifier
  types would have to check both. Rejected for the schema cost above
  and for DRY at the metamodel level, which is not the secondary kind.
- **Fix only the mapper's fallback (R2) and stop there.** Removes the
  wrong `DECIMAL(10,2)` but turns every dbt key into `TEXT`, which is
  still not what the YAML says. Necessary, not sufficient.
- **Delete the heuristic in `referenceModePkType` outright.** Measured
  across this repository's 76 loadable models (see Risks for the script): the heuristic fires for
  93 entities and names the right value type for 3. Keeping it guarded
  by the reference-mode name keeps those 3; deleting it would move them
  to the fallback for no gain.
- **Derive "defaulted" inside the collector** by walking from each
  column to its value type, or through the FK to the referenced key.
  Possible, but it re-derives in the collector a decision the mapper
  already made, and the two copies can drift. The mapper knows; it
  should say.

## Workstreams (each independently shippable)

Each workstream is written under the option chosen for the
decisions it depends on (D1-D3, below), and names them where it does.
A different call on a decision changes the named part and nothing else.

Order (D3): WS1, then WS2, then WS3. WS2 and WS3 are independent of WS1
and of each other; WS1 is the change the user feels most.

### 1. dbt importer writes typed identifiers

Identifier value types are created in a second pass over the dbt
models, after `createEntityTypes` has created every entity, so an
entity name can never be taken by an identifier created earlier. For
each model with a detected key:

- **Type.** Resolve the key column's data type by the model-then-source
  rule `valueTypes.ts` uses today. Extract that resolution into one
  function both paths call, so key and non-key columns cannot resolve
  differently, and record in the import report which source supplied
  it.
- **Definition.** Give the identifier value type the key column's
  `description`, or `inferColumnDescription(col, model)` with an
  import-report warning when there is none -- the rule non-key columns
  already follow. Without this, WS3's description TODO would fire on
  every key column.
- **Name and reuse (D1).** The candidate name is
  `toPascalCase(pk.columnName)`. Reuse the object type already holding
  that name only when it is a value type whose data type equals the one
  just resolved (name, length and scale). Otherwise -- an entity holds
  the name, or a value type with a different or missing data type does
  -- create `<Entity><Candidate>` (e.g. `OrdersId`) instead and emit an
  import-report warning naming both models, the two types, and the key
  column name the export will use (`orders_id` rather than `id`, since
  the mapper names a key from its preferred value type). This keeps
  every key's declared type; what a conflict costs is a column rename,
  which is reported. `OrmModel.addObjectType` refuses a duplicate name,
  so the kind check is also what stops the import throwing.
- **Fact type.** The binary `"<Entity> has <IdValueType>"`, with
  internal uniqueness on the value role marked `isPreferred: true`, and
  internal uniqueness plus mandatory on the entity role.

The same kind check applies to non-key columns: `valueTypes.ts` today
reuses whatever `getObjectTypeByName` returns, entity or not. The
shared resolver closes that for both paths.

When the key's column name does not survive the mapper's round trip --
`toSnake(toPascalCase(col)) !== col`, e.g. `customerID` -- emit an
import-report warning naming both spellings, since the exported key
column will be spelled the second way.

Acceptance: importing the two-model project above yields `CustomerId`
and `OrderId` value types with `data_type: decimal` and definitions,
and DDL export types `customers.customer_id`, `orders.order_id` and the
FK `orders.customer_id` as `DECIMAL`. Two models keyed `id number` and
`id varchar` import without throwing, keep both types, and report the
rename. A model whose entity name equals another model's candidate
identifier name imports without throwing. The diagram still shows
`Customers (.customer_id)` with no separate `CustomerId` node (a test
in `diagram` over the imported model).

### 2. Mapper stops borrowing an unrelated attribute's type

In `referenceModePkType`, accept a binary's value player only when
`toSnake(valuePlayer.name) === ot.referenceMode`; otherwise return
`fallbackPkType`. Update the docstring, which currently calls the first
binary "the reference-mode heuristic".

Acceptance: an entity `Order(order_id)` with a single attribute
`OrderTotal: decimal(10,2)` and no preferred binary maps its key as
`TEXT` (or the configured strategy type), not `DECIMAL(10,2)`. A mapper
test over the repository's models replaces
`packages/core/scripts/refmode-heuristic-audit.mjs` (see Risks), so the
counts are asserted rather than quoted.

This moves the key type of up to 90 entities in the repository's
example and output models; `npm run validate:examples` and the CLI
characterization goldens (`cli/tests/characterization/golden/*.ddl.txt`,
regenerated with `UPDATE_GOLDEN=1`) show the change. Each moved type
was taken from an unrelated attribute (e.g. `Doctor(provider_id)` typed
from `Specialty`), so the change is a correction, but the PR must list
the goldens it rewrites.

### 3. Annotations report only real gaps, in neutral words

How the collector learns a type was defaulted is D2. As resolved: add `dataTypeDefaulted: boolean` to `Column` in
`RelationalSchema.ts`. The mapper sets it where it writes a type: `true`
when `conceptualTypeToSql` received no `DataTypeDef` or when
`referenceModePkType` returned the fallback, and FK columns copy it from
the referenced key column alongside the type (the two
`pkCol?.dataType ?? "TEXT"` sites). Making it required lets the compiler
find every construction site.

In `ExportAnnotationCollector`: emit "defaulted" iff the column's type
was defaulted; emit the column-description TODO iff the column's source
value type is missing or has no definition; reword messages without a
format name ("Data type was not declared; exported as TEXT. Add a data
type to the value type."). `DbtExportAnnotator` appends " Or set it in
the dbt YAML." for the `data_type` and `description` categories.
`collectAnnotationMap` prefixes column-level lines with the column name.

Acceptance: in the reproduction above, after WS1-3 the DDL tab emits no
TODO on any column; with WS3 alone, `customer_name` and `is_active`
carry no TODO, and the remaining TODOs name no format.

## API and migration impact

- Per D2, `Column` gains a required
  `dataTypeDefaulted` field. `Column` is exported from `@barwise/core`;
  `@barwise/formats`, `@barwise/dbt` and `@barwise/mcp` read columns but
  none constructs one outside tests (to verify during WS3 with the
  compiler, not assumed).
- Annotation message text changes. Tests that pin the old strings update
  in WS3; nothing parses the messages.
- No `.orm.yaml` schema change and no `orm_version` bump. A model
  imported before WS1 keeps loading and keeps its untyped keys until
  re-imported.

## Decisions (resolved 2026-09-25)

All three were resolved by the requester, each as recommended. The
options are kept so a later reader can see what was rejected.

- **D1. Key columns that share a name across models (`id`).**
  (A) Share one identifier value type when the declared types agree;
  on a conflict or a name held by an entity, create a per-entity
  `<Entity><Name>` identifier and report that its exported column is
  renamed. Mapper unchanged. (B) Always per-entity identifiers, and
  change the mapper to name a key column from the entity's reference
  mode rather than its preferred value type -- no renames, but it
  reverses the mapper rule `RelationalMapper.ts:103-119` documents and
  moves key column names in shipped models where the two disagree
  (unmeasured). (C) Share by name unconditionally, first type wins --
  rejected: it exports one of the keys with the wrong type.
  **Resolved: A.** A conflict costs a reported rename, never a wrong
  type, and the mapper rule stays as it is.
- **D2. `dataTypeDefaulted` on `Column` versus derivation in the
  collector.** The field widens a public core type; derivation keeps the
  type but duplicates the mapper's decision (see Alternatives).
  **Resolved: the field.**
- **D3. Should WS2 land before WS1?** Landing it first moves
  example-model key types before the importer fix gives dbt users
  anything. **Resolved: order as written**; each is green on its own.

## Risks and testing

- **A non-key column that shares a key's name** (e.g. `orders.customer_id`
  with no `relationships` test) would reuse the identifier value type,
  whose node the diagram absorbs, leaving that attribute's fact type
  with a hidden player. WS1 adds a test for this case and, if the edge
  is lost, restricts absorption to the entity the binary identifies.
  Measured in WS1: the edge was lost. See Implementation notes.
- **Examples drift.** WS2 changes DDL for existing models; run
  `npm run validate:examples` and regenerate the characterization
  goldens with `UPDATE_GOLDEN=1`, reviewing the diff.
- Per workstream: `npm run build` from `barwise/` (WS3 crosses a package
  boundary), then the dbt, core, formats and diagram suites, then
  `npm run ci:local` before push.
- **The measurement.** `node packages/core/scripts/refmode-heuristic-audit.mjs`
  (after `npm run build`, from `barwise/`) reproduces every count this
  spec quotes and lists the 90 unrelated picks. Output at commit
  f8f90a5c: 84 tracked `.orm.yaml` files, 76 load; the fallback fires for
  93 entities, names the reference-mode value type for 3, and picks an
  unrelated attribute for 90. The script copies the mapper's private
  `toSnake`; WS2 replaces it with a test that uses the mapper itself.

## Non-goals

- No new CLI, MCP or VS Code surface; the capability matrix is unchanged.
- No change to how non-key columns are typed or described on import.
- No LLM involvement: every change is in the deterministic import,
  mapping and annotation path.

## Implementation notes

**WS1 (2026-09-26).** Landed as specified, with four details the spec
left open:

- A column's data type, its description, and which value type it plays
  are decided in one module, `dbt/src/dbtMapping/columnTypes.ts`. Both
  `identifierTypes.ts` (keys) and `valueTypes.ts` (other columns) call
  `claimValueType` for the last of these; they create what it decides
  and word their own report messages.
- D1's rule reached ordinary columns too (found in review of PR #564).
  An ordinary column used to share any same-named value type, so a
  `varchar(36)` attribute named like a numeric key exported as
  `DECIMAL`, and a column named like its own entity's renamed identifier
  made the import throw on a duplicate fact type. `claimValueType` now
  shares a name only with a value type, never one this entity already
  plays, and -- for an ordinary column -- only when the column declares
  no type or the same type. An ordinary column with no type of its own
  still shares, as before. A column that cannot share gets
  `<Entity><Name>` and a reported rename, as a key does under D1.
- The "will export as X" warning is not predicted from a copy of the
  mapper's private `toSnake`. `exportedColumns.ts` runs
  `RelationalMapper` over the imported model and compares each column it
  emits with the dbt column it came from, matched on the entity-side
  role both record. One check covers every cause -- a D1 rename, the
  ordinary-column rename above, and a spelling such as `customerID` --
  and it cannot drift from what export does.
- The diagram risk under Risks and testing was real: a value type that
  identifies one entity and is also an attribute of another lost the
  attribute's edge. `ModelToGraph` now keeps such a value type as a node
  and still folds the identifying fact type into the entity's
  "(.ref_mode)" label. A value type that plays no other role is absorbed
  as before.

Reproduction after WS1, through the CLI: `customers.customer_id`,
`orders.order_id` and the foreign key `orders.customer_id` all export as
`DECIMAL`. The false "defaulted" and "no description" TODOs remain until
WS3.

**WS2 (2026-09-26).** Landed as specified. Three details:

- `packages/core/tests/mapping/referenceModePkType.test.ts` replaces
  `scripts/refmode-heuristic-audit.mjs`, as the spec asked. It does not
  copy `toSnake` to classify each key. It maps every tracked model under
  two fallback strategies, and a key whose type does not move with the
  fallback took its type from a value type. Restricted to what
  `referenceModePkType` types (a single key column named for the
  reference mode, not an objectified entity, not a subtype), that list is
  exactly the three keys the audit counted as "named", and the test pins
  it. Against the old mapper all three sweep and rule tests fail.
- `core/tests/mapping/dbt.test.ts` asserted the defect as correct: a
  `Customer(customer_id)` key typed `VARCHAR(100)` from its `Name`
  attribute. It now asserts `TEXT`.
- The predicted golden churn did not happen. The characterization
  goldens are built from `examples/transcripts/` and `test-plan/fixtures/`
  models whose entities have preferred identifying binaries, so the
  fallback never reaches them; `examples/output/clinic-appointments.orm.yaml`,
  where the audit found `Doctor(provider_id)` typed from `Specialty`, has
  no DDL golden. `npm run test` passed with no golden rewritten.

**WS3 (2026-09-26).** Landed as specified under D2, with three details:

- `dataTypeDefaulted` is set at the five places the mapper writes a type.
  A declared data type gives `false` and none gives `true`. A key typed by
  the preferred-identifier strategy gives `true`, so a defaulted `INTEGER`
  or `UUID` key is now reported; the old `=== "TEXT"` check missed it. A
  foreign key, including a subtype's shared key, copies the referenced
  column's flag, and a unary fact type's `BOOLEAN` gives `false`. As the
  API section asked, the compiler confirmed that no package outside core
  builds a `Column`. Five core test files do, and their literals gained
  the field (core's `tsc` does not see tests, barwise-944).
- R4 needed one rule the spec did not state: a foreign-key column has no
  value type of its own. It is described by the value type behind the
  key it references, so `orders.customer_id` is described by
  `CustomerId`'s definition. Without that rule, the acceptance check (no
  TODO on any column of the reproduction) could not pass.
- The CLI characterization goldens changed only in annotation text, as
  expected (`UPDATE_GOLDEN=1`, 11 files): 27 column-description TODOs
  became 13, each on a value type that has no definition, and the 13
  defaulted-type TODOs stayed at 13 with the neutral wording, because
  those fixtures do have untyped value types. Avro fields that had
  carried a false TODO in `doc` now carry the default `"Primary key"`.

Reproduction after WS1-3, through the CLI: `barwise export --format ddl`
emits no TODO on any column. `--format dbt` on a model with real gaps
appends "Or set it in the dbt YAML." to each data-type and description
TODO; the DDL export of the same model does not.

Review of PR #567 found three places where WS3's rules missed a column,
each now covered by a test that fails without its fix. A key typed from
a named but non-preferred binary recorded no source role, so its
definition was not found (`reviewer.employee_id` in
`examples/transcripts/pii-redaction.orm.yaml`). A foreign key into an
objectified entity's composite key needs more than one hop to reach a
value type. And an identified subtype's single shared key column kept
its own phase-0 type instead of the supertype key's, which after WS2
could leave a `TEXT` column referencing an `INTEGER` key. The same
review surfaced barwise-1074: the named binary is still mapped a second
time as an attribute column, which this spec does not cover.
