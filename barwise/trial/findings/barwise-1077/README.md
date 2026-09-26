# barwise-1077: DDL import replaces a composite primary key with an invented column

```sh
barwise import model trial/findings/barwise-1077/schema.sql --format ddl --output /tmp/s.orm.yaml
barwise export /tmp/s.orm.yaml --format ddl
```

Expected: the key `(student_id, course_id)` survives, as an external
uniqueness over the two columns' binaries (or an objectified relationship
when both are foreign keys).

Observed (main at 2671c247, fresh bundle): import warns, then the export
reads `enrollment_id TEXT NOT NULL ... PRIMARY KEY (enrollment_id)`; both
key columns are gone.

The trial's DDL acceptance rows (C09 sdtm-ddl) are classified here: their
failing persona checks include "The combination of Study, Site and
SubjectNumber is unique", which is this defect. Others in those rows
(subtypes, deontic rules, rings) are not expressible in DDL, so a row can
stay open after this fix; it is then reclassified, not closed.
