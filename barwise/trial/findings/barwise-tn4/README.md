# barwise-tn4: code importers skip common class names without saying so

## Reproduction

```sh
npm run trial:generate -- --customer C06 --tier small
npm run trial:offline -- --customer C06 --sprint 1
```

C06's generated TypeScript repo has a domain class:

```ts
/** A timestamped occurrence recorded against a shipment, container or vehicle. */
export class Event {
  eventId: string;
  eventTimestamp: string;
}
```

`barwise import model <repo> --format typescript` exits 0 with 36
object types. `ScanEvent`, `ShipmentEvent` and three `*Kind` aliases are
among them; `Event` is not. Stderr carries one warning, the language
server fallback, and does not name `Event`.

## Cause

`packages/code-analysis/src/formats/TypeScriptImportFormat.ts` skips any
class or interface whose name is in `UTILITY_TYPES` ("Skip common
non-entity types"), and `Event` is on the list, as are `Request`,
`Response`, `Result`, `Error` and `Context`. `jvmModelBuilder.ts` carries
a longer copy of the list for Java and Kotlin, so the two already
disagree.

## Why the trial did not see it before

The import oracle treated an expected name as present when any imported
name ended with it, so `ScanEvent` satisfied `Event`. Copilot flagged
that matcher on PR #509; with the prefix tolerated only at an
identifier boundary, the drop surfaced as
`C06/small/1/import:platform-typescript` (S1, 1 of 22 names silently
dropped).
