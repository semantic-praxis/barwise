# barwise-1036: the NORMA round trip orphans populations from their mandatory roles

```sh
barwise export trial/customers/C04-marketplace/kernel.orm.yaml --format norma --output /tmp/m.orm
barwise import norma /tmp/m.orm --output /tmp/m.back.orm.yaml
barwise validate trial/customers/C04-marketplace/kernel.orm.yaml   # 0 errors
barwise validate /tmp/m.back.orm.yaml                              # 49 errors
```

Expected: barwise can read back what barwise wrote, into a model that
passes barwise's own validation.

Observed (1.7.0): both commands exit 0 and the re-imported model fails
validation with 49 `population/mandatory-violation` errors on C04 and
37 on C11, the two trial customers whose kernels carry populations:

```
ERROR Mandatory constraint on role "_r-product-has-productid-product" in
fact type "Product has ProductId" is violated: "P-1001" appears in the
model but does not play this mandatory role.
```

The populations are not lost: six go in, six come out, with the same
`is_sample` value. What changes is role identity, and the leading
underscore in the role id above is the tell. The population rows end up
referencing roles the mandatory constraints no longer recognise.

Sibling of barwise-1028, which is the same round trip re-homing subset,
exclusion and external-uniqueness constraints onto other fact types.
Probably one root cause in how the NORMA leg assigns role ids, but the
two have different symptoms and want different tests.

Found by sprint 4's `read-back:norma` step, which exists because the
trial stopped carrying its own format validators and now asks barwise to
read its own exports instead.
