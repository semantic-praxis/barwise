# The enterprise trial lane

Simulated enterprise customers, each a reproducible package, driven
through the built CLI and MCP bundles the way a customer would drive
them; every failure ratcheted in `../trial-baseline.json`. The design
is `docs/specs/enterprise-trial.spec.md`; the package format is
`AUTHORING.md` beside this file.

Not an npm package, not in the Turborepo graph, and no `@barwise/*`
import anywhere under `lib/`: the lane reads the bundles as a customer
does (`test-plan/` made the same call), so a bundle that cannot find
its own catalog fails here and nowhere in the unit suites.

## Run it

```sh
npm run build && npm run --workspace=@barwise/cli bundle && npm run --workspace=@barwise/mcp bundle
npm run trial:generate                      # every customer, small tier
npm run trial:offline                       # sprints 1, 3, 4, 5, 6, then the gate
npm run trial:generate -- --tier medium --customer C01
npm run trial:offline  -- --tier medium --customer C01 --sprint 1,5
npm run trial:gate     -- --tier small      # the ratchet alone
npm run trial:keyed    -- --customer C11    # sprint 2; needs a provider key
```

Exit codes follow `docs/specs/gate-refusal-contract.spec.md`: 0 the
run completed and every failure is classified, 1 a new or stale
finding, 2 the lane could not answer (no bundle, nothing generated).

## Where things are

| Path                      | What                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `customers/Cxx-<slug>/`   | One package per customer: `customer.yaml`, `kernel.orm.yaml`, `personas/`, `skins/`, `transcripts/` |
| `customers/*/generated/`  | Derived tiers, gitignored; `trial:generate` rebuilds them from kernel, skin and seed                |
| `lib/run.mjs`, `gate.mjs` | Entry point and ratchet                                                                             |
| `lib/steps.mjs`           | The six sprints as functions over one customer at one tier                                          |
| `lib/oracles/grade.mjs`   | Pure graders; each has a planted-failure test in `tests/`                                           |
| `lib/generators/`         | Kernel + skin + seed -> DDL, OpenAPI, dbt, code, NORMA, OWL, Avro, a scaled model, a history repo   |
| `loss-sets/<format>.json` | What a round trip through that format may drop; a delta outside it is a finding                     |
| `loss-sets/<format>.json` | What a round trip through that format may drop; a delta outside it is a finding                     |
| `findings/<issue>/`       | Minimal reproduction per open finding                                                               |
| `results/<tier>.json`     | The latest run, gitignored                                                                          |

## Reading a result line

```
C01 small s1 import:clarity-ddl-regex   FAIL S1   429ms  exit 0 but 65 of 65 expected names are absent ...
```

`FAIL S1` silent wrong output, `S2` crash or hang, `S3` a refusal that
does not say what was refused, `S5` ergonomics; `REFUSED` the product
declined and named why (a roadmap row, not a bug); `N/A` the lane could
not answer that step (no key, nothing generated). Severity meanings and
what happens to each are the spec's severity table.

## Classifying a finding

`npm run trial:offline -- --write` appends each new failure to the
baseline as an unclassified row. The gate stays red until the row has a
`note` saying why it is open and an `issue` naming the beads issue, and
until a reproduction sits under `findings/<issue>/`. When the fix
lands, the row goes and the reproduction moves into the owning
package's tests, in the fixing PR.
