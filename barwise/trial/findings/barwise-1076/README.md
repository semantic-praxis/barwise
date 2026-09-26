# barwise-1076: OpenAPI import puts a property's constraints on the value role

```sh
barwise import model trial/findings/barwise-1076/api.json --format openapi --output /tmp/api.orm.yaml
barwise verbalize /tmp/api.orm.yaml
barwise export /tmp/api.orm.yaml --format ddl
```

Expected: `Customer has Name` with each Customer having at most one Name,
and at least one because `name` is required; `name` exports `NOT NULL`.

Observed (main at 2671c247, fresh bundle): the fact type reads
"Name has Customer", with "Each Name has at most one Customer." and
"Each Name has at least one Customer." -- both constraints on the value's
role. The DDL export makes `name` nullable. The same defect was fixed for
DDL import by docs/specs/ddl-import-fidelity.spec.md (#570).

The trial's OpenAPI acceptance rows (C01 fhir-openapi, C07 tmf-openapi)
are classified here: most of their failing persona checks are uniqueness
and mandatory constraints the imported model allows but should forbid.
Some checks in those rows (rings, deontic rules, ternary facts, external
uniqueness) are not expressible in OpenAPI at all, so a row can stay open
after this fix; it is then reclassified, not closed.
