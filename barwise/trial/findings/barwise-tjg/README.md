# barwise-tjg: dbt references to a composite-key model import column by column

```sh
barwise import dbt trial/findings/barwise-tjg --output /tmp/m.orm.yaml
```

Expected: `coverage_applies` read as the ternary over Coverage, RiskCode
and PolicyPeriod, unique on its key, since its two `policy_period_*`
columns together are one reference to `policy_period`'s two-column key.

Observed (2026-10-08): two references, "CoverageApplies has policy
period PolicyPeriod" and the same name suffixed with
`(policy_period_term_id)`, and the model objectified with them as
attributes: the composite-key rule counts two columns beside the key.

The trial row classified here is C03's actuarial analyst over the claims
dbt project, whose "For each Coverage and Risk combination, at most one
PolicyPeriod applies." needs the ternary. The DDL importer has the
sibling defect for a composite FOREIGN KEY outside the key (barwise-f2n).
