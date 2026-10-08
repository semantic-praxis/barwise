# barwise-1078: a primary key that is also a foreign key imports the key but not the reference

```sh
barwise import model trial/findings/barwise-1078/schema.sql --format ddl --output /tmp/m.orm.yaml
```

Expected: GraduateStudent a subtype of Student, or at least related to it,
since `graduate_student.student_id` is both its key and a reference to
`student`.

Observed (2026-10-08): `GraduateStudent has StudentId` and no subtype or
relationship, with the warning "key column student_id also references
student; the key is imported, the reference is not (barwise-1078)".

The trial row classified here is C10's ir-analyst over the Banner DDL,
whose `GRADUATE_SGBSTDN` is keyed on `SGBSTDN_ID` referencing `SGBSTDN`,
so "GraduateStudent is a subtype of Student." has nothing to verbalize.
Its other failures went with barwise-rlv (the generator) and its reading
check is declared not_expressible for ddl.
