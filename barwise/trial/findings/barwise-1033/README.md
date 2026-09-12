# barwise-1033: the `ddl` importer is one regex

```sh
barwise import model trial/findings/barwise-1033/messy.sql --format ddl
```

Four CREATE TABLE statements: schema-qualified with IF NOT EXISTS,
bracket-quoted, backtick-quoted, and one without a trailing semicolon.

Expected: four entity types, or a refusal naming each statement it
could not parse.

Observed (1.7.0): exit 0, "Imported 0 object types, 0 fact types",
confidence low, one warning "No CREATE TABLE statements found in
input". `DdlImportFormat.ts:149` is the regex. The same regex is what
makes the DDL round trip re-import with zero fact types (barwise-1036):
the exporter's own `-- TODO(barwise)` comments inside the column list
break the body capture.
