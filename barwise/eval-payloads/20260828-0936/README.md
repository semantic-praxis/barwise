# Payloads of the 2026-08-28 eight-arm baseline

One directory per arm; files are named `<caseId>-run<N>.json` for the
run that produced them. Retention at recording time was suite 2.5.0's
best/worst-per-case (per-mode retention arrived with barwise-891).

## Seven stale files were deleted from this record

The recording day's arms reused `/tmp` payload directories, and the
discarded suite-2.4.0 attempts (a stale checkout, and a run refused for
unretried `terminated` failures) left files the recorded reruns did not
overwrite. The 2026-08-28 offline audit (see the 2.6.0 appendix in
`docs/prompt-baseline-2.5.0-2026-08-28.md`) re-scored every file with
the 2.6.0 tiers disabled, which must reproduce the arm log's recorded
score for a fresh non-vendor file; seven did not -- leftovers of the
discarded attempts whose run-number names were false provenance -- and
were removed (they remain in git history before this commit):

- `haiku45-dev/incident-response-run4.json`
- `haiku45-dev/subscription-billing-run3.json`
- `haiku45-dev/subscription-billing-run4.json`
- `haiku45-train/clinic-appointments-run2.json`
- `haiku45-train/conference-reviews-run1.json`
- `haiku45-train/freight-corrections-run3.json`
- `haiku45-train/university-enrollment-run2.json`

Every remaining file reproduces its logged score exactly. Since this
round, each round gets a fresh dated directory, which removes the
overwrite hazard.
