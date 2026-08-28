# Payloads of the 2026-08-28 eight-arm baseline

One directory per arm; files are named `<caseId>-run<N>.json` for the
run that produced them. Retention at recording time was suite 2.5.0's
best/worst-per-case (per-mode retention arrived with barwise-891).

## Seven files are stale -- do not read them as run records

The recording day's arms reused `/tmp` payload directories, and the
discarded suite-2.4.0 attempts (a stale checkout, and a run refused for
unretried `terminated` failures) left files the recorded reruns did not
overwrite. The 2026-08-28 offline audit (see the 2.6.0 appendix in
`docs/prompt-baseline-2.5.0-2026-08-28.md`) re-scored every file with
the 2.6.0 tiers disabled, which must reproduce the arm log's recorded
score for a fresh non-vendor file; these seven do not, and are
leftovers of the discarded attempts:

- `haiku45-dev/incident-response-run4.json`
- `haiku45-dev/subscription-billing-run3.json`
- `haiku45-dev/subscription-billing-run4.json`
- `haiku45-train/clinic-appointments-run2.json`
- `haiku45-train/conference-reviews-run1.json`
- `haiku45-train/freight-corrections-run3.json`
- `haiku45-train/university-enrollment-run2.json`

They are genuine haiku45-2 model output, so they are kept, but their
run-number names are false provenance: no score, delta, or claim
should be derived from them as samples of the recorded runs. Every
other file reproduces its logged score exactly. Since this round, each
round gets a fresh dated directory, which removes the overwrite
hazard.
