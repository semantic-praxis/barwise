# barwise-nul: OpenAPI discriminator subtypes are not imported

```sh
node packages/cli/dist/bundle/index.cjs import model \
  trial/findings/barwise-nul/api.json --format openapi --output /tmp/nul.orm.yaml
grep -c 'subtype:' /tmp/nul.orm.yaml
```

Expected: `EmergencyEncounter` imports as a subtype of `Encounter`,
because `Encounter`'s `discriminator.mapping` names it.

Observed (2026-09-26): 0 subtype facts, and one warning, "Schema
"Encounter" has a discriminator - subtype relationships may need manual
modeling". Both schemas import as unrelated entities.

In the enterprise trial this is the one failing check left on C01's
`acceptance:clinical-informaticist:fhir-openapi` row, after the checks
OpenAPI cannot express were declared `not_expressible` (barwise-1079):
TraumaEncounter is not an EmergencyEncounter in the imported model, so
the persona's mandatory on `EmergencyEncounter has TriageAcuity` has a
counterexample.
