# barwise-1023: the OpenAPI importer writes duplicate role ids

```sh
barwise import model trial/findings/barwise-1023/api.json --format openapi --output /tmp/api.orm.yaml
barwise validate /tmp/api.orm.yaml
```

Expected: a valid draft model, three entity types, two fact types.

Observed (1.7.0): the import exits 0 with confidence medium; validate
reports `structural/duplicate-role-id` because both `related` roles
carry the id `<patientUuid>-related-role`. On a FHIR-shaped document
this is 57 errors at 55 schemas and 444 at 550. The DDL importer has
the same collision on column names (C09 sdtm-ddl, 29 errors).
