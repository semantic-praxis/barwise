# barwise-1079: OpenAPI import ignores discriminator and allOf

```sh
barwise import model trial/findings/barwise-1079/api.json --format openapi --output /tmp/s.orm.yaml
barwise verbalize /tmp/s.orm.yaml
```

Expected: EmergencyEncounter is a subtype of Encounter, and each
EmergencyEncounter has exactly one TriageAcuity.

Observed: the import warns that the discriminator "may need manual
modeling" and imports the schemas as unrelated entities, so no subtype
exists. In the trial this is the OpenAPI acceptance distance (C01
fhir-openapi, C07 tmf-openapi). The rest of that distance -- composite
uniqueness, ring and deontic rules -- cannot be stated in OpenAPI and
is not an importer defect.
