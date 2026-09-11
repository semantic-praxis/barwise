# Open findings

One directory per open beads issue the trial surfaced, holding the
smallest input that reproduces it and a `README.md` with the command,
what a customer expects, and what barwise does today. The baseline
rows in `../../trial-baseline.json` name the issue; the catalog in
`catalog.json` is how the gate classifies a new row into one of these.

When the fix lands, the reproduction moves into the owning package's
tests and the directory goes, in the fixing PR.
