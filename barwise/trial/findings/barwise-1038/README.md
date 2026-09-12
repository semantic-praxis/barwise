# barwise-1038: dbt export then import loses more than the loss set

```sh
barwise export examples/transcripts/pii-redaction.orm.yaml --format dbt --output /tmp/pii-dbt
barwise import dbt /tmp/pii-dbt --output /tmp/pii-back.orm.yaml
barwise diff examples/transcripts/pii-redaction.orm.yaml /tmp/pii-back.orm.yaml
```

Expected: only the deltas `trial/loss-sets/dbt.json` declares
(populations, definitions, subtypes, objectification).

Observed (1.7.0) on the trial kernels where the importer did not throw
(barwise-1037): 52 to 139 deltas, among them removed value types
(PartyId, TransactionId, RateId) and changed value constraints.
