# barwise-1034: the dbt importer throws on two relationships to one model

```sh
barwise import dbt trial/findings/barwise-1034
```

A leg has an origin port and a destination port: two relationships
tests from `stg_leg` to `stg_port`.

Expected: two fact types (Leg has origin Port, Leg has destination
Port), or one named as skipped.

Observed (1.7.0): exit 1, `Error: Fact type "Leg has Port" already
exists in model "dbt Import"`, no model written. barwise's own dbt
export produces this shape from any ring constraint or any table with
two foreign keys to the same table, so the dbt round trip fails on
most models.
