# Move mechanically derivable extraction repairs from prompt text to code

Status: Accepted (implemented with this spec; see Implementation
notes)
Created: 2026-08-09
Last-updated: 2026-08-09
Tracking: follow-up to `docs/prompt-eval-remeasure-2026-08-09.md`
(leads audit: "are we fixing things via llm that should be fixed in
code?"); parent spec
`docs/specs/prompt-optimization-harness.spec.md`. No bd issue yet (bd
unavailable in this session).

## Principle

Determinism in the core, LLM at the boundary: prompt text should
carry only what requires judgment about the transcript; anything
mechanically derivable from the payload belongs in the deterministic
layers. The re-measurement audit found one violation and two gaps:

- The sonnet5-1/2 variant instructs the model to keep example
  populations consistent with identifier mandatory constraints -- but
  the missing identifier instance is _entailed_, not judged: an
  entity instance denoted "S-100" has identifier value "S-100" by
  definition of its reference mode. Asking the LLM to enforce an
  invariant a pure function can enforce spends prompt tokens on the
  wrong layer, and only helps configs that carry the tuned variant
  (the default artifact bled 2-3 validation errors per case on
  exactly this).
- The gym evaluator's element and population matching is
  exact-name-only, so a candidate that models the right concept under
  a recorded synonym fails rubric checks that grade semantics.

What stays in the prompt is unchanged by this spec: constraint
siding, ring capture, objectification -- judgments about what the
transcript means, which no deterministic layer can make.

## Scope

- When an extraction's population gives a value for a role played by
  an entity type that has an identifier fact type, and no population
  of that identifier fact type contains that value in the entity
  role, `enforceConformance` shall append the entailed identifier
  instance (entity value = identifier value) and record a
  `missing_identifier_population` correction per appended instance.
- When a gym rubric names an object type (a `requires_element` query
  or a `forbids_population` mapping), the evaluator shall match a
  candidate object type by its name or any of its aliases, exact name
  taking precedence.

Out of scope, deferred and named:

- Slimming the variant's population rules: the incomplete-instance
  and constraint-conflict guidance stays (omitting a partial example
  is judgment); only the identifier-instance clause becomes
  redundant, and removing it is a future variant revision to be
  measured, not bundled here.
- Promoting population/ring rules into the default artifact: still
  the maintainer's re-baselining call, unchanged by this spec.
- Rubric-side alias declarations (letting an eval case list
  acceptable names): not needed once candidate-side aliases work;
  the transcript-derivable-name authoring rule stands.

## Inventory

| Area                                           | Change                                                          | Verdict   |
| ---------------------------------------------- | --------------------------------------------------------------- | --------- |
| `llm/src/ExtractionConformance.ts`             | New repair: synthesize entailed identifier-population instances | modify    |
| `learn/src/evaluate/checks/requiresElement.ts` | Name-or-alias matching                                          | modify    |
| `learn/src/evaluate/populationMapping.ts`      | Name-or-alias matching                                          | modify    |
| `llm/src/parse/objectTypes.ts`                 | None: aliases already pass through (see Implementation notes)   | untouched |
| `core`                                         | No changes (`ObjectType.aliases` already exists)                | untouched |
| Prompt artifacts                               | No changes this round (see out of scope)                        | untouched |
| Seed answer keys and pins                      | Must stay byte-identical (verified below)                       | untouched |

## Workstreams (each independently shippable)

### 1. Identifier-population repair in `enforceConformance`

Fires only when the identifier fact type exists (an orphaned
reference mode stays detect-only, as today). Appends to an existing
population of the identifier fact type or creates one, reusing the
triggering population's source references. One correction per
appended instance, so the scorer still charges the model for the
omission -- the repair restores validity, not the score.

### 2. Alias-aware matching in the evaluator

`requires_element` (both query forms) and the forbidden-population
mapping resolve a rubric name against candidate names and aliases.
Reference-side names are authored, never aliased.

## Risks and testing

- **Answer-key pins must not move.** The seed keys either carry no
  populations or (freight-corrections) carry populations without
  identifier fact types, where the repair cannot fire; the pinned
  scores in `promptlab` guard this in CI.
- **The repair must not fabricate.** It synthesizes only the
  identity bijection instance for values already present in the
  payload; it never invents entity values. Unit tests cover: repair
  fires, repair is idempotent (existing identifier instance
  suppresses it), orphaned reference mode still detect-only.
- **Alias matching must not over-match.** Ambiguity (two candidate
  types claiming the same name/alias) resolves to exact name first;
  tests cover alias hit, exact-name precedence, and no-match.
- Full gate: `llm`, `learn`, `promptlab` suites, then the monorepo
  build and tests.

## Implementation notes (2026-08-09)

- **The drafted parser workstream was a non-finding.** The brief
  claimed `DraftModelParser` drops extracted aliases; grounding
  showed object-type construction lives in `llm/src/parse/objectTypes.ts`,
  which already passes `aliases` through. The workstream was removed
  rather than implemented -- the grep that motivated it searched the
  wrong file.
- The repair lives in `repairIdentifierPopulations`, runs after
  `cleanPopulations`, and charges one `missing_identifier_population`
  correction per appended instance. Coverage is checked against every
  role value of existing identifier-population instances, so payloads
  that key `role_values` by role name instead of player name still
  suppress the repair rather than causing a duplicate.
- Alias matching is a shared helper
  (`learn/src/evaluate/nameResolution.ts`): exact name wins, then the
  first alias in the other side's vocabulary. The population mapping
  canonicalizes candidate player names into the reference vocabulary
  before multiset and role-group correspondence, so an aliased player
  matches without loosening the correspondence rules.
- Pins verified unmoved: promptlab 27/27 (the freight key's
  populations have no identifier fact types, so the repair cannot
  fire on any answer key), llm 252/252 (+3), learn 55/55 (+4).
