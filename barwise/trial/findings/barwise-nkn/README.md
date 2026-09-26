# barwise-nkn: dbt acceptance checks dbt can express still fail

```sh
npm run build && npm run --workspace=@barwise/cli bundle && npm run --workspace=@barwise/mcp bundle
npm run trial:offline -- --customer C03 --tier small
npm run trial:offline -- --customer C04 --tier small
npm run trial:offline -- --customer C11 --tier small
node trial/lib/gate.mjs --tier small
```

Expected: every acceptance check on a dbt artifact passes. None is
declared `not_expressible`, because dbt can state all of them. Even a
ring constraint fits in a singular test, which is SQL (PR #575 review).

Observed (2026-09-26), on the rows this issue classifies:

- C03 `actuarial-analyst:claims-dbt`: "For each Coverage and Risk
  combination, at most one PolicyPeriod applies." A multi-column
  uniqueness; `dbt_utils.unique_combination_of_columns` states it.
- C03 `claims-data-steward:claims-dbt`: "It is obligatory that each
  Reserve is approved by at least one Adjuster." A test with
  `severity: warn` is dbt's form of an obligation. Also no fact type
  between Subrogation and Contact.
- C04 `analytics-engineer:warehouse-dbt`: no `Seller` object type, no fact
  type between Order and Buyer, and no ternary "Order includes
  ProductVariant in Quantity" from the composite-key model.
- C11 `data-platform-lead:metrics-dbt`: no `FunnelStep precedes
  FunnelStep` fact type, and no singular test stating that the ordering
  never loops.

Each is a generator gap (`trial/lib`) or an importer gap
(`@barwise/dbt`). Which one has not been traced yet; each should become
its own issue once it is.
