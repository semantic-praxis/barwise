# barwise-kt7: the trial's generators render some model structure unfaithfully

This is a defect in the trial harness, not in barwise. It was first
filed as a TypeScript importer defect, which was wrong: the importer
cannot recover a relationship the generated code never contained.

## 1. The code generator keeps only the first two roles of a fact type (fixed)

Fixed on PR #509: an objectified or n-ary fact type is now a class with
one field per role, and `trial/tests/code.test.mjs` checks every role of
every fact type in all twelve kernels. With the input fixed, the C06
check below still fails, for the reason predicted at the end of this
section: code cannot express objectification. That is barwise-y6a. The
record of the original defect follows.

```sh
npm run trial:generate -- --customer C06 --tier small
cat trial/customers/C06-logistics/generated/small/platform-typescript-repo/src/main/com/trial/domain/Booking.ts
```

C06's kernel has the ternary fact type `Shipper books Shipment with
Carrier`, objectified as `Booking`. The persona `integration-architect`
checks for a fact type between Shipment and Carrier, because "the
objectified booking rests on this fact".

Expected: code a team would write -- `Booking` holding its shipper,
shipment and carrier.

Observed: `Booking` has `bookingNumber`, `bookingStatus` and `incoterm`,
and no role at all. `Shipment` never mentions `Carrier`. The cause is
`trial/lib/generators/code.mjs`, `const [r0, r1] = ft.roles`: every
fact type is rendered as a field from its first role's player to its
second's, so a third role is dropped and an objectification gets no
fields. The TypeScript, Java and Kotlin repos all come from this one
generator.

So `C06/small/6/acceptance:integration-architect:platform-typescript`
fails on the harness's input, not on barwise's output. Once the
generator renders `Booking`'s roles, re-check whether the rubric can be
met from code at all: code has no notion of objectification, so an
importer reading it faithfully produces `Booking` with three binary fact
types, not one ternary. If the rubric still fails then, that is a
genuine limit of code import and worth its own issue.

## 2. The NORMA generator omits per-fact constraint references

```sh
grep -c InternalConstraints trial/customers/C09-pharma/generated/small/legacy-norma.orm   # 0
```

A NORMA file lists each internal constraint under its fact, in
`<orm:InternalConstraints>`. The generator writes the constraints at
model level only, so the "legacy" NORMA file is less realistic than what
the NORMA tool itself produces.

Fix this together with barwise-nm4, not before it: this omission is what
exposes nm4, and nm4's reproduction is a committed file for exactly
that reason.
