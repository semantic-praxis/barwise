# barwise-3pc: an entity identified through another entity cannot be stated

```sh
barwise import model trial/findings/barwise-3pc/schema.sql --format ddl --output /tmp/m.orm.yaml
```

Expected: WorkOrder identified by its Batch, the key and the reference
one column, as the schema says.

Observed (2026-10-08): the key is imported as `WorkOrder has BatchNr`
and the reference is dropped, with the warning "key column batch_nr also
references batch; the key is imported, the reference is not". core has
no identification form for an entity identified through a one-to-one
relationship with another (`packages/core/src/model/identification.ts`),
so the importer has nothing faithful to build (key-reference-tables.spec.md).

The trial row classified here is C05's master-data lead:
`MAT_IS_PRODUCED_AT_WERK_IN_CHA` is WorkOrder's table, keyed on
`CHARG_ID` alone, so no fact type connects Material and Plant.
