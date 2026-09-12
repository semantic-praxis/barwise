# barwise-1039: merge fails on a fact-type rename without saying why

```sh
barwise merge trial/findings/barwise-1039/base.orm.yaml trial/findings/barwise-1039/incoming.orm.yaml --output /tmp/merged.orm.yaml
```

`incoming` is `base` with "Material is component of Material" renamed
to "Material is part of Material" (a fact type carrying an acyclic ring
constraint), nothing else.

Expected: a merged model, or a diagnostic naming the structural error.

Observed (1.7.0): exit 1, `Merge produced 1 structural error(s);
nothing was written.` and no diagnostic.
