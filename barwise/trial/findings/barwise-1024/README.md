# barwise-1024: the OpenAPI export writes a comment header into JSON

```sh
barwise export trial/findings/barwise-1024/one-reading.orm.yaml --format openapi --output /tmp/one.json
head -3 /tmp/one.json
barwise import model /tmp/one.json --format openapi
```

The model has one warning (a binary fact type with a single reading).

Expected: a JSON document a JSON reader accepts, and the importer reads
it back.

Observed (1.7.0): the file begins with `/* Validation warnings:`; the
importer exits 0 and writes a model with no `object_types` key. With
`--no-annotate` the file is JSON. A JSON target cannot carry comments;
annotate through an `x-barwise-diagnostics` extension or refuse to.
