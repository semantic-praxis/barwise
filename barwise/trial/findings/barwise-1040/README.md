# barwise-1040: a rename reported as removal plus addition

```sh
barwise diff trial/findings/barwise-1040/before.orm.yaml trial/findings/barwise-1040/after.orm.yaml --format json
```

`after` is `before` with the object type Listing renamed to Offer (and
its fact-type names updated), nothing else.

Expected: a synonym candidate Listing -> Offer, as the same command
reports for Producer -> Agency and Encounter -> Visit in the trial's
other histories.

Observed (1.7.0): REMOVED Object type Listing [breaking], ADDED Object
type Offer, `synonymCandidates: []`. Six of the trial's fourteen
object-type renames are reported this way; the rule that decides which
is not stated.
