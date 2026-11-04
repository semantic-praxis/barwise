# Subject areas: named groups within one model

Status: Draft -- no workstream implemented

Created: 2026-10-22
Last-updated: 2026-10-22
Tracking: barwise-a76

## Principle

A model declares its subject areas in `model.subject_areas`, each with an id,
a name and a description, and every object type and fact type may name the
one area it belongs to. It ships in the format the version gate selects
(`orm-format-3.spec.md`, Open decision 12). A large model is organized into
subject areas, and that organization should be part of the model rather than
of its formatting. Today seven of the twelve
trial kernels divide their lists with comments, `# ---- identity ----`,
`# ---- financial aid ----`, six to twelve sections per list. That is 109 of
the 288 comment lines the 2026-10-22 audit found. Barwise cannot see them,
so no surface can use them, and the next save erases them.

Explicit over implicit says a grouping the modeller states is declared, not
inferred from where an element sits in a file. Orthogonality says it is its
own concern: neither a diagram view, which is about what is drawn and where,
nor a domain, which is a bounded context in its own file.

## Is a subject area a diagram view, or a domain? (resolved: neither)

Barwise already has two groupings, and each answers a different question.

| Concept                | Answers                                   | Holds                                                                                | Lives                                              |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Diagram view           | What is drawn, and where?                 | Object type ids, positions, orientations; fact types derived                         | `model.diagrams`                                   |
| Domain (project)       | Which bounded context owns this language? | A whole `.orm.yaml` file; cross-domain references via mappings                       | `.orm-project.yaml`                                |
| **Subject area** (new) | Which part of the business is this about? | An id, a name and a description; each object type and fact type names its area by id | `model.subject_areas`, and a field on each element |

A view stores no fact types; it derives them from the object types it shows
(`diagramView.ts` `viewMembership`). The kernels file fact types on their own
terms: C10's object-type section "academics" becomes four fact-type sections
("student", "catalog", "sections and terms", "grades and programs"). Deriving
a fact type's area from its players would lose that, so each fact type names
its own. A domain is the stronger boundary: the same term may mean different
things in two domains, and elements cross between them only through a
mapping. Inside one domain, a subject area is a filing decision.

## Does an area list its members, or does each element name its area? (resolved: each element names its area)

The corpus evidence is single membership: a divider places each element in
exactly one section, because a YAML list holds each element once. A field on
the element states that directly. It cannot dangle, needs no cascade when an
element is removed, travels with the element through split and merge for
free, and shows in a diff as a change to the element it belongs to. The
declared list (`model.subject_areas`) holds what belongs to the area itself,
its id, name and description, and the element's field names an area by id, so
an area is declared, not inferred from a spelling (explicit over implicit).
Overlap, if a model ever needs it, is the same field widened to a list;
nothing in the corpus asks for it (decision 2).

## Scope

In scope:

- When a model declares subject areas and its object types and fact types
  name them, the system shall keep the areas and every element's area
  through load, save, diff, merge and split.
- When an object type or fact type names an area the model does not
  declare, validation shall report it as an error naming both.
- When an area is removed, the system shall clear it from every element that
  named it.
- When the VS Code sidebar, `describe` or `query` shows a model with areas,
  it shall be able to group or filter by area.

Out of scope:

- Grouping by kind ("reference-mode value types", "attribute value types").
  Six of the seven kernels end their object types with such sections. The
  model already knows an element's kind, and the sidebar already groups by
  it; storing it again would be a second copy.
- Ordering the file by area on save. The writer keeps its order; areas are
  data, not layout.
- NORMA groups. NORMA files carry ORM2 groups, which barwise neither reads
  nor writes today (no match in `formats/src/norma`); a later workstream may
  map them.
- DDL schemas or dbt folders per area (decision 5).

## Inventory

Verified on 2026-10-22.

| Area                                                            | Current state                                                                                                                          | Verdict                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `core/src/model/OrmModel.ts`                                    | Model-level collections with add/remove and cascades (definitions, diagrams, constraints)                                              | gains `subjectAreas` (declarations) with the same shape of API                                                   |
| `core/src/model/ObjectType.ts`, `FactType.ts`                   | Optional `definition` and `note` on both; `sourceContext` on object types only                                                         | each gains `subjectAreaId?: string`                                                                              |
| `core/schemas/orm-model.schema.json`                            | No group, tag, category or area of any kind; `domain_context`, `source_context` and a definition's `context` are bounded-context names | gains `model.subject_areas`                                                                                      |
| `core/src/model/graph.ts`, `validation/referenceDiagnostics.ts` | `graphOf` (:198) finds unresolved id references, keyed by id; `referenceDiagnostics` maps them to diagnostics                          | the graph learns area references, so an element naming an undeclared area is reported the way a dangling role is |
| `core/src/diff/`, `ModelMerge.ts`                               | Diff and merge every model-level collection by name or id; element fields are listed by name in merge (barwise-937)                    | a declaration matched by id, then by name; the element field compared and carried like `note`                    |
| `core/src/project/splitModel.ts`                                | Takes `SplitConfig {domains: context -> object type names}`; uses no grouping inside the model; drops diagrams with a warning          | a domain declares the areas its elements name; an area may seed a split config (decision 4)                      |
| `vscode/src/sidebar/ModelTreeProvider.ts`                       | Fixed categories by kind, each sorted by label                                                                                         | gains a Subject Areas category (workstream 2)                                                                    |
| `core/src/describe`, `core/src/query`                           | No area option; `describe` focuses on an element or a keyword; `query` filters by kind and arity                                       | `describe --focus` accepts an area; `query` gains `in-area` (workstream 2)                                       |
| `core/src/verbalization`                                        | One flat list in model order                                                                                                           | optionally sectioned by area (workstream 2, provisional)                                                         |
| Diagram package                                                 | Views filter by `viewMembership`                                                                                                       | untouched; workstream 3 adds "view from area"                                                                    |

## Target architecture

```ts
// model/SubjectArea.ts
interface SubjectArea {
  readonly id: string;
  /** Unique within the model; what a person reads. */
  readonly name: string;
  readonly description?: string;
}
// ObjectType and FactType each gain:
//   readonly subjectAreaId?: string; // the id of a declared area
```

```yaml
# the selected format version
model:
  subject_areas:
    - id: sa-financial-aid
      name: financial aid
      description: Awards, disbursements and the satisfactory-progress rule.
  object_types:
    - id: ot-award
      name: Award
      kind: entity
      reference_mode: award_id
      subject_area: sa-financial-aid
```

An area has an id, as every element 3.0 refers to does: a rename then
touches one declaration, not every element filed under it. Diff and merge
match areas by id and fall back to the name, which is what two models built
apart (an LLM sample, an import) share, the same id-then-content rule
constraints follow. An element is in one area or none.

## Alternatives considered

- **Each area lists its members by id**, as a view lists object types. It
  allows overlap, but nothing in the corpus overlaps, and it brings what the
  element field avoids: references that dangle, a cascade on every removal,
  members to prune in split and merge, and a member change that reads as a
  change to the area rather than to the element that moved.
- **Extend diagram views to carry fact types and use them as areas.** It
  merges two concerns that change for different reasons: rearranging a
  diagram would change the model's organization, and an area with no diagram
  would need a view with no positions. Workstream 3 links them instead.
- **Split the model into domains instead.** Domains are bounded contexts with
  their own files and mappings; a subject area inside one context is not a
  translation boundary, and splitting would force mappings between areas that
  share their language.
- **Fact types derived from object types, as views do.** Rejected above: the
  kernels group fact types differently from the object types they relate.

## Workstreams (each independently shippable)

### 1. The element, end to end in core

`SubjectArea` declarations on the model, `subjectArea` on object types and
fact types, the schema, the serializer, the undeclared-area diagnostic,
removing an area clears it from its elements, diff (declarations by id, then name; an
element's area as a change to that element, rated `safe`), merge (both
carried, barwise-937), and split (each domain declares the areas its
elements name).

Acceptance: a round-trip law over areas; a test for the undeclared-area
error; a merge test that carries an element's area from either side; a split
test where one area's elements land in two domains.

### 2. Surfaces read them (provisional: not yet grounded)

The VS Code sidebar's Subject Areas category, `describe --focus <area>`,
`query in-area <name>`, and verbalization sectioned by area when the model has
any. `describe` and `query` are tools on all three surfaces, so the MCP
`describe_domain` and `query_model` tools and their VS Code language-model
registrations gain the same area parameter; the capability matrix rows stay
`none`.

### 3. Views and splits from areas (provisional: not yet grounded)

A VS Code command creating a diagram view from an area's object types, and
`barwise project split` taking areas as the split's starting configuration.

### 4. The trial kernels (provisional: not yet grounded)

Turn the topic dividers (not the kind dividers) into areas, with
orm-format-3 WS5's corpus rewrite.

## API and migration impact

- A new model-level collection; no existing field changes.
- Format: the version `orm-format-3.spec.md` Open decision 12 selects.
- Downstream: nothing breaks; every consumer of areas is new.

## Open decisions (for review)

1. **Format version.** Decided once, for this spec and its two siblings, by
   `orm-format-3.spec.md` Open decision 12.
2. **One area per element, or several.** (a) Recommended: one, the field
   above, because the corpus shows only single membership. (b) A list of
   areas per element, which costs nothing structurally but invites filing
   everything everywhere. Widening (a) to (b) later is a schema change that
   keeps every existing file valid if the field accepts both a string and a
   list.
3. **Nesting.** (a) Recommended: flat. No kernel nests its sections, and a
   flat list composes with views and splits without a tree to walk. (b) A
   `parent` on an area, for models in the hundreds of elements. Can be added
   later as an optional field without breaking anything.
4. **Areas and project split.** (a) Recommended: an area may seed a split
   configuration (workstream 3), and the split keeps areas as areas. (b) Treat
   each area as a proposed domain automatically, which confuses a filing
   decision with a bounded context.
5. **Areas in exports.** (a) Recommended: not yet. A DDL schema or dbt folder
   per area is a physical design choice with naming and dependency
   consequences, and nothing asks for it. (b) An opt-in `--schema-per-area`
   on DDL export.
6. **Constraints and populations.** (a) Recommended: no area of their own. A
   constraint is filed where its fact types are; a population with its fact
   type. (b) A field on constraints too, for an external constraint spanning
   two areas. No corpus file needs it.

## Risks and testing

- **Two models name one area differently.** Matched by id first, then name,
  so an LLM sample calling it "Financial Aid" and the base calling it
  "financial aid" pair only when the ids agree. Name matching is
  case-sensitive, as definitions' term matching is; a test pins it.
- **Filing goes stale.** A new fact type is in no area until someone files
  it. That is honest, and `describe` can list unfiled elements; no automatic
  filing.

## Non-goals

- No access control, ownership or stewardship on areas.
- No validation rule that every element is in an area.
- No change to diagram views or domains in workstream 1.
