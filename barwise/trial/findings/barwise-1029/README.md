# barwise-1029: `import sql` reads foreign-key targets, not tables

```sh
barwise import sql trial/findings/barwise-1029/schema.sql --dialect postgres
barwise import sql trial/findings/barwise-1029/schema.sql --dialect oracle
```

Expected: three entity types (Customers, Orders, AuditLog) with their
keys, or a refusal naming what was not read; `--dialect oracle` refused
the way `export --dialect oracle` is.

Observed (1.7.0): exit 0, "Imported 2 object types, 0 fact types",
confidence medium, one warning "Foreign key references customers
(customer_id)". The two object types are `Customers` (the FK target)
and `Status`; `orders` and `audit_log` are absent and unmentioned.
`--dialect oracle` gives the same result with no complaint. Across the
trial: 24% to 54% of tables silently dropped per customer, 100% on the
BigQuery-idiom file with zero warnings.
