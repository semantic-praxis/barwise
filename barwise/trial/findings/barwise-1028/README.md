# barwise-1028: NORMA export then import re-homes constraints

```sh
barwise export trial/customers/C02-bank/kernel.orm.yaml --format norma --output /tmp/bank.orm
barwise import norma /tmp/bank.orm --output /tmp/bank-back.orm.yaml
barwise diff trial/customers/C02-bank/kernel.orm.yaml /tmp/bank-back.orm.yaml
```

Expected: no deltas, or only the population deltas
`trial/loss-sets/norma.json` allows; the importer is documented as
nearly lossless.

Observed (1.7.0): "Party has KycStatus" gains a subset constraint and
"Party borrows under LoanAccount" loses one; an external uniqueness
moves from "DepositAccount has AccountNumber" to "DepositAccount is
routed by RoutingNumber"; an exclusion on "Transaction affects
DepositAccount" is removed and re-added. On C01 two definitions are
dropped and aliases change. 5 to 47 deltas per kernel.
