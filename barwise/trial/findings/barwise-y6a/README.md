# barwise-y6a: code cannot express objectification

Not a defect in the importer, and not one in the harness: a format
limit, and a question about how to grade it.

## Reproduction

```sh
npm run trial:generate -- --customer C06 --tier small
cat trial/customers/C06-logistics/generated/small/platform-typescript-repo/src/main/com/trial/domain/Booking.ts
npm run trial:offline -- --customer C06 --sprint 1,6
```

C06's kernel objectifies the ternary `Shipper books Shipment with
Carrier` as `Booking`, with a uniqueness constraint on the Shipment role
(each shipment is booked once). Since barwise-kt7's code-generator half
was fixed, the generated TypeScript holds it the way a team writes it:

```ts
export class Booking {
  bookingNumber: string;
  shipper: Shipper;
  shipment: Shipment;
  carrier: Carrier;
  ...
}
```

The TypeScript importer reads that faithfully: `Booking has Shipper`,
`Booking has Shipment`, `Booking has Carrier`, and no objectified fact
type. `import:platform-typescript` passes (22 of 22 expected names).

`acceptance:integration-architect:platform-typescript` fails one of five
checks: "The model has no fact type connecting Shipment and Carrier".

## Why this is a limit, not a bug

A class with three references is indistinguishable in TypeScript from an
entity that happens to reference three things. The importer cannot know
`Booking` stands for a ternary, and the uniqueness on the Shipment role
has nowhere to be written in code at all. What survives is a path
(Shipment - Booking - Carrier), not the fact type the check asks for.

## Two ways to close it

Recorded in the issue's design field: make persona checks declare which
artifact kinds can satisfy them, or have the code importers infer an
association class. The issue recommends the first.
