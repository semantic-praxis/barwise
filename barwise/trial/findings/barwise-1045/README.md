# barwise-1045: OpenAPI export then import drops lengths, definitions and value constraints

```sh
barwise export trial/customers/C02-bank/kernel.orm.yaml --format openapi --no-annotate --output /tmp/bank.json
barwise import model /tmp/bank.json --format openapi --output /tmp/bank-back.orm.yaml
barwise diff trial/customers/C02-bank/kernel.orm.yaml /tmp/bank-back.orm.yaml | head -20
```

Expected: only the deltas `trial/loss-sets/openapi.json` declares
(populations, subtypes, objectification).

Observed (1.7.0): every value type reads `definition changed`,
`data type: text(20) -> text`, and enumerated ones `value constraint
changed`; 143 to 183 deltas per 55-object-type kernel. The exported
document carries `maxLength`, `description` and `enum` for these
properties, so the importer's property reader is what drops them.
