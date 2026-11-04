# Apache Ossie fixtures

Copied unchanged from apache/ossie at commit
`01a5488d840deda309aac68cc0b312c195369b8d`, the commit
`docs/specs/ossie-ontology-format.spec.md` pins:

- `flights.ontology.yaml` -- `examples/flights.ontology.yaml`

The schemas from the same commit are not fixtures: the importer reads them
at run time, so they live in `formats/schemas/ossie/` and the tests read
that one copy.

Licensed under the Apache License, Version 2.0, by the Apache Software
Foundation (http://www.apache.org/licenses/LICENSE-2.0). The YAML keeps its
license header.
