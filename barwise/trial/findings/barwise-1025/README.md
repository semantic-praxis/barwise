# barwise-1025: DDL export then import is not a fixed point

```sh
barwise export examples/transcripts/clinic-appointments.orm.yaml --format ddl --output /tmp/a.sql
barwise import model /tmp/a.sql --format ddl --output /tmp/a.orm.yaml
barwise diff examples/transcripts/clinic-appointments.orm.yaml /tmp/a.orm.yaml
barwise export examples/transcripts/clinic-appointments.orm.yaml --format ddl --no-annotate --output /tmp/b.sql
barwise import model /tmp/b.sql --format ddl --output /tmp/b.orm.yaml
barwise diff examples/transcripts/clinic-appointments.orm.yaml /tmp/b.orm.yaml
```

Expected: the re-imported model differs from the original only by the
loss set in `trial/loss-sets/ddl.json` (definitions, populations,
subtypes, objectification).

Observed (1.7.0) on a 57-object-type trial kernel: the annotated export
re-imports with 24 entity types and zero fact types (the comments
inside the column list break the importer's body regex); the
unannotated export re-imports with 46 object types and 39 fact types,
14 object types and 39 fact types removed, 21 fact types added under
different readings. Also: the column comments in a DDL export read "Add
one to the dbt YAML".
