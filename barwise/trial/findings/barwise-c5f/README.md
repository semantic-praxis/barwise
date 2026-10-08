# barwise-c5f: a schema with no FOREIGN KEY imports no relationship

```sh
barwise import model trial/findings/barwise-c5f/schema.sql --format ddl --output /tmp/m.orm.yaml
```

Expected (if inference lands): a fact type connecting NetworkDevice and
Site, since `network_device.site_id` names `site`'s key and has its type.

Observed (2026-10-08): `NetworkDevice has SiteId`, a value attribute.
The import reads a reference only where the DDL declares one.

The trial row classified here is C07's network-inventory architect over
the BigQuery DDL: the skin's `no_foreign_keys` idiom writes none, as
warehouse schemas commonly do, so "NetworkDevice is installed at Site"
and its mandatory role are not in the import. Whether to infer the
reference is the open question; explicit over implicit argues for at
least reporting each inferred one.
