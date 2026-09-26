# barwise-1079: acceptance checks a format cannot express have no seat

```sh
node trial/findings/barwise-1079/repro.mjs
```

Expected: a persona can declare, for one artifact kind, any rubric check
that kind cannot satisfy by construction, as AUTHORING.md describes for
`not_expressible`.

Observed (2026-09-26): `not_expressible` matches a check by its
`element`, which only `requires_element` checks have. A
`requires_verbalization` or `forbids_population` check cannot be named:
the runner refuses the entry ("matches 0 rubric checks").

Rows classified here are acceptance rows on OpenAPI and dbt artifacts
whose remaining failures are mostly such checks -- rings, deontic rules,
external and value-side uniqueness, n-ary fact types, subtypes,
relationship verbs -- after barwise-1076 and barwise-bvl were fixed.
Each row may also carry an importer or generator gap (C01's `allOf`
subtype mandatory, C03's ternary written as three separately unique
columns); those are to be split into their own issues when the format
limits are declared, not declared away.
