# barwise-2z1: an unannotated table whose every column is a role imports as an entity

```sh
barwise import model trial/findings/barwise-2z1/schema.sql --format ddl --output /tmp/m.orm.yaml
```

Expected: one fact type over the table's three columns (Meter records
ReadingValue at IntervalTimestamp), unique on meter and timestamp.

Observed (main after #600): entity `MeterRecordsReadingValueAtIntervalTimestamp`
with three attributes and an external uniqueness, and a warning that
the entity is identified by an invented `..._id` (barwise-ezn). Without
a barwise line, the import reads a table as a relationship only when its
key is foreign keys alone.

The trial rows classified here are C08's metering data engineer (this
table) and C09's biostatistician, whose `SUBJECT_RECEIVES_DOSE_OF_TREATMENT`
is keyed on its two foreign keys with `DOSE` outside the key, so the
import builds a relationship over the foreign keys with Dose as an
attribute and "For each Subject and Treatment combination, at most one
Dose applies" has no ternary to verbalize.
