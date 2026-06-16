# Anchors View and Reasoning Trail

Status: draft
Owner: design conversation (sensemaking initiative)
Tracking: implements initiative #4 / WS6 of
`implicit-sensemaking.spec.md`, which drafted it provisionally. File bd
issues per workstream when this lands.

## Principle / Problem

A model's **anchors** -- the load-bearing facts it rests on -- are exactly
what the sensemaking discipline says to verify first: each entity type's
identification scheme, its key (preferred-identifier) uniqueness, and its
mandatory participation. A wrong or missing anchor distorts every fact
type built on it. Barwise can compute these deterministically, but never
surfaces them as a set, and never flags an entity that has no identifier
at all. Separately, the _reasoning_ behind a generated model -- the forks
it faced, the framings it discarded, the assumptions still unconfirmed --
is produced at import time and then thrown away.

Two pillars. **Determinism in core**: a model's anchors are a pure
function of the model, so the anchors view belongs in `core`.
**Composability**: the anchors view is a new query-DSL command, so it
rides the existing `query_model` tool and `barwise query` command with no
new surface; the reasoning trail rides the existing MCP resource pattern.

## Should the anchors view be a new query command or a dedicated tool? (resolved: a query command)

A query-DSL command. `query_model` (MCP) and `barwise query` (CLI) already
parse the DSL and dispatch to `queryModel`; adding an `anchors` command
surfaces it through both for free. A dedicated `anchors` tool/command
would duplicate that plumbing for no gain -- the antithesis of the
composability pillar.

## Scope

In scope (WS-A, the concrete piece):

- A deterministic `anchors` query-DSL command in `core`. For each entity
  type (or one named entity), report its identification scheme (reference
  mode), its preferred-identifier uniqueness constraint, and its mandatory
  roles -- and flag any entity type that has no identifier as a missing
  anchor.
- Surfaced through the existing `query_model` tool and `barwise query`
  command (no new tool or command).

Provisional (WS-B, heavier -- see Open decisions):

- A reasoning-trail artifact: the anchors plus the import-time ambiguities,
  discarded framings, and low-confidence assumptions, persisted and served
  as an MCP resource.

Out of scope:

- Changing the `.orm.yaml` format.
- Auto-fixing a missing or ambiguous anchor (the view reports; the modeler
  decides).

## Inventory

| Area                                  | Change                                                           | WS | Verdict                           |
| ------------------------------------- | ---------------------------------------------------------------- | -- | --------------------------------- |
| `core/src/query/types.ts`             | Add `{ kind: "anchors"; entity? }` to `ModelQuery` + result type | A  | Additive                          |
| `core/src/query/parse.ts`             | Add `"anchors"` to `QUERY_COMMANDS` and parse it                 | A  | Additive                          |
| `core/src/query/evaluate.ts`          | Dispatch + `anchors()` on `QueryContext`                         | A  | Additive, deterministic           |
| `core/src/query/format.ts`            | Human-readable rendering of the anchors result                   | A  | Additive                          |
| `mcp/src/tools/queryModel.ts`         | None -- rides the DSL                                            | A  | No change                         |
| `cli/src/commands/query.ts`           | None -- rides the DSL                                            | A  | No change                         |
| `llm` trail assembly + `mcp` resource | Persist + serve the reasoning trail                              | B  | Provisional: persistence decision |

## Target architecture

```
# WS-A: anchors as a query kind, deterministic and pure.
ModelQuery |= { readonly kind: "anchors"; readonly entity?: string; }

interface EntityAnchors {
  readonly entity: string;
  readonly referenceMode?: string;            # identification scheme, if any
  readonly preferredIdentifier?: {            # the preferred-uniqueness anchor
    readonly factType: string;
    readonly identifierTypes: readonly string[];
  };
  readonly mandatoryRoles: readonly string[]; # fact types the entity must play
  readonly missingIdentifier: boolean;        # true when no identifier exists
}
# QueryResult gains an anchors variant: readonly EntityAnchors[].

# Ridden by the existing surfaces, no new tool/command:
#   MCP  query_model(source, "anchors")  /  query_model(source, "anchors Customer")
#   CLI  barwise query <file> anchors    /  barwise query <file> anchors Customer

# WS-B (provisional): reasoning trail.
# Raw material already exists on DraftModelResult: ambiguities,
# alternatives (CandidateFraming[]), low-confidence constraintProvenance.
# Anchors are recomputable from the model. The open question is where the
# import-time material is persisted so a resource can serve it later.
#   MCP  reasoning-trail://{path}  ->  { anchors, ambiguities, discardedFramings, assumptions }
```

## Alternatives considered

- **A dedicated `anchors` MCP tool and CLI command.** Rejected: it
  duplicates the query plumbing the DSL already provides. The anchors view
  is a query; it should be a query command.
- **Embed the reasoning trail in the `.orm.yaml`.** Deferred: it changes
  the file format and the round-trip contract, and the trail is
  import-time history, not model structure. A sidecar keeps the format
  clean.
- **Keep the trail ephemeral (only in the import response).** Rejected for
  WS-B's goal: a resource has to serve it after the import call returns, so
  something must persist.

## Workstreams

- [ ] **WS-A -- Anchors query (core).** Add the `anchors` command to the
      query DSL: types, parse, dispatch, a deterministic `anchors()`
      evaluator, and human-readable formatting. The evaluator walks each
      entity type's fact types for its preferred-identifier uniqueness and
      mandatory roles, reads its reference mode, and flags a missing
      identifier. Unit tests over a model with and without identifiers.
      Surfaced automatically through `query_model` and `barwise query`.
- [ ] **WS-B -- Reasoning-trail artifact.** Assemble anchors + import-time
      ambiguities, discarded framings, and low-confidence assumptions, and
      serve them as a `reasoning-trail://` MCP resource. _(provisional: not
      yet grounded -- depends on the persistence decision below.)_

## API and migration impact

All WS-A changes are additive and non-breaking: a new query kind and
result variant; existing query callers are unaffected, and the MCP tool
and CLI command need no change. WS-B adds an opt-in artifact and a
read-only resource; it does not alter existing behavior.

## Open decisions

- **Missing-anchor reporting.** _Recommend_ including entity types that
  lack any identifier as flagged anchors (`missingIdentifier: true`) --
  this is the highest-value sensemaking signal, since a missing anchor is
  exactly the wrong-frame smell. Alternative: list only entities that have
  an identifier.
- **Reasoning-trail persistence (gates WS-B).** _Recommend_ a sidecar
  artifact (`<model>.trail.json`) written at import time when alternatives
  or ambiguities are present, served by the resource. Alternatives:
  embed in the `.orm.yaml` (changes the format) or keep ephemeral (no
  resource). This is the reviewer's call and blocks WS-B.
- **Trail contents.** _Recommend_ anchors (recomputed) + ambiguities +
  discarded framings (the WS-A/#3 `CandidateFraming` rationales) +
  low-confidence constraints. Discarded framings require the import to have
  run with `alternatives: true`.

## Risks and testing

- **Determinism.** The anchors view is a pure function of the model;
  tested for referential transparency and over models with present,
  partial, and missing identifiers.
- **Scope creep into WS-B.** WS-A ships and is useful on its own; WS-B is
  held behind the persistence decision so the clean deterministic piece is
  not blocked by the artifact-lifecycle question.
- **Formatting.** Same pre-push gate as the parent spec; `dprint
  fmt:check` runs in CI but not in this environment.

## Non-goals

- Auto-repairing missing or ambiguous identifiers.
- A new query or resource engine -- reuse the DSL and the resource pattern.
- Changing the `.orm.yaml` format.
