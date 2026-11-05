# barwise-j82: the CLI and MCP lay a verbalization out differently

```sh
barwise verbalize trial/findings/barwise-j82/customer.orm.yaml
```

and the MCP tool `verbalize_model` with
`{ "source": "trial/findings/barwise-j82/customer.orm.yaml" }`.

Expected: the same text on both surfaces, as the capability matrix says
verbalize has no divergence.

Observed (1.7.0): the CLI indents a fact type's constraint readings by
two spaces under its readings; MCP joins every reading flat.

```text
CLI:                                          MCP:
Customer has CustomerName                     Customer has CustomerName
CustomerName is of Customer                   CustomerName is of Customer
  Each Customer has at most one CustomerName. Each Customer has at most one CustomerName.
```

The trial lane saw this only once its parity step stopped skipping
results that spilled past MCP's inline limit (PR #922); every customer's
verbalization had spilled before.
