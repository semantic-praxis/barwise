# Apache Ossie fixtures

Copied unchanged from apache/ossie at commit
`01a5488d840deda309aac68cc0b312c195369b8d`, the commit
`docs/specs/ossie-ontology-format.spec.md` pins:

- `flights.ontology.yaml` -- `examples/flights.ontology.yaml`
- `ontology.json` -- `ontology/ontology.json`
- `ossie-schema.json` -- `core-spec/ossie-schema.json`, which `ontology.json`
  references by URL on Ossie's `main`; the export test registers it under
  that URL so validation needs no network and cannot drift from the pin.

All three are licensed under the Apache License, Version 2.0, by the Apache
Software Foundation (http://www.apache.org/licenses/LICENSE-2.0). The YAML
keeps its license header; JSON cannot carry one, so this file does.
