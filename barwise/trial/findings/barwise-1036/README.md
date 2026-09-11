# barwise-1036: the NORMA round trip drops the population sample flag

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
37 on C11, the two trial customers whose kernels carry populations.

## The cause, isolated

The kernel's populations carry `sample: true`; after the round trip the
flag is absent. A sample population is positive evidence only
(`docs/specs/sample-populations.spec.md`), so its instances stay out of
`buildObjectUniverse` and mandatory constraints do not fire on them.
Without the flag the instances become significant, `P-1001` enters the
universe as a Product, and every mandatory role a Product must play
reports a violation.

Decisive test: take the round-tripped model, set `sample: true` on its
six populations, change nothing else, and validation goes from 49
errors to 0.

The mechanism is a format gap, not a transport bug. NORMA carries the
instances as `EntityTypeInstance`, `FactTypeInstance` and
`ValueTypeInstance` elements and they survive intact, non-ASCII values
included, but NORMA has no notion of a _sample_ instance, so the flag
has nowhere to live in the file.

This is a bug rather than documented loss, because the round trip turns
a model that validates into one that does not. Three ways out: preserve
the flag through a NORMA annotation, decline to emit populations that
cannot round-trip, or re-import instances as samples by default.

## What this issue used to say, and why it was wrong

The first version blamed role-identity rewriting, because the error
names a role id with a leading underscore. Role ids are rewritten to
NORMA's guid form, but harmlessly: the population rows follow them
correctly. That diagnosis came from reading an error message rather
than isolating a variable, and it would have sent a fix at the wrong
code.

## The rest of the NORMA diff, which is not this issue

A round trip over five kernels also shows, in every one of them:

- `source_context` dropped from every object type, and the model-level
  `domain_context` with it.
- The glossary (`definitions`) dropped entirely: five terms on C04.
  Per-element definitions survive, 11 of 11 fact-type definitions.
- Reference modes expanded into an explicit value type and identifying
  fact type on re-import (`Product_product_id`,
  `ProductHasProduct_product_id`) alongside the originals, leaving
  Product with two `is_preferred` identifiers.

Those are separate questions: the first two are candidates for the
declared loss set, the third is a modeling defect of its own. None of
them causes the validation failure above.
