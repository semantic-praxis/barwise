# barwise-1077: DDL import replaces a composite primary key with an invented column

```sh
barwise import model trial/findings/barwise-1077/enrollment.sql --format ddl --output /tmp/e.orm.yaml
barwise export /tmp/e.orm.yaml --format ddl
```

Expected: `enrollment` keyed by `(student_id, course_id)`, both columns
kept; in ORM terms an external uniqueness over the two key binaries,
marked preferred.

Observed: the importer warns that the composite key was not imported,
drops both key columns, and the export keys the table by an invented
`enrollment_id TEXT`. In the trial this is C09's sdtm-ddl artifact: the
clinical-data-manager persona's checks "The combination of Study, Site
and SubjectNumber is unique" and "The combination of Subject and
VisitNumber is unique" fail. The same persona set also asks for a
subtype (barwise-1078, a key that is also a foreign key) and deontic
rules, which DDL cannot state.
