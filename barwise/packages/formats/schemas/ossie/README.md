# The pinned Apache Ossie ontology schema

Copied unchanged from apache/ossie at commit
`01a5488d840deda309aac68cc0b312c195369b8d`, the commit
`docs/specs/ossie-ontology-format.spec.md` pins:

- `ontology.json` -- `ontology/ontology.json`
- `ossie-schema.json` -- `core-spec/ossie-schema.json`, which `ontology.json`
  references by URL on Ossie's `main`; `src/ossie/ossieSchema.ts` registers
  it under that URL, so validation needs no network and cannot drift from
  the pin.

These are the one copy: the importer reads them at run time to name fields
the schema does not define (`docs/specs/ossie-unknown-fields.spec.md`), and
the export test validates exports against them. Moving the pin replaces
both files in one commit.

Both are licensed under the Apache License, Version 2.0, by the Apache
Software Foundation (http://www.apache.org/licenses/LICENSE-2.0). JSON
cannot carry a license header, so this file does.
