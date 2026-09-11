# barwise-1033: unhandled EPIPE when stdout closes early

```sh
barwise diff trial/customers/C02-bank/kernel.orm.yaml trial/customers/C02-bank/generated/small/scaled.openapi.back.orm.yaml | head -5
```

Any command that prints more than the reader wants will do; `diff` and
`verbalize` piped to `head` were how this was found.

Expected: the first five lines and a quiet exit.

Observed (1.7.0): the first five lines, then `Error: write EPIPE` with
a Node stack trace (`index.cjs:190802`) and an `Emitted 'error' event`
block. Handle EPIPE on `process.stdout` once, in the CLI entry point.
