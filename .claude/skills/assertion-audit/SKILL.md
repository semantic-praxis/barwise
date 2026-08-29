---
name: assertion-audit
description: Use when writing or reviewing a test that asserts a refusal, error, or rejection; when adding a capability to a surface (CLI command, MCP tool, VS Code command, prompt surface, format descriptor); or when auditing the suite for tests that pin the wrong behaviour as correct. Carries the two-pass audit method (limitation-pinned refusals, fixture-asserting tests) and the authoring rules that prevent both classes.
---

# Assertion Audit: tests that defend the wrong behaviour

Two defect classes let a green suite certify a bug. Both have shipped
here more than once, so this skill serves two moments: **authoring
time** (rules that prevent the defect) and **audit time** (the method
that finds the ones already in).

The precedents, for calibration:

- PR #338 / barwise-855: `prompt artifact` and `prompt schema` refused
  `--surface review` long after barwise-847 made review artifact-driven,
  because tests pinned the refusal ("extraction only") as if it were a
  requirement. A pinned limitation is worse than an untested gap: the
  gap is invisible, the pin reads as intent.
- The 2026-08-25 audit (`barwise/docs/test-suite-assertion-audit-2026-08-25.md`):
  deleting the `--max-tokens`/`--context-window` passthrough, or
  unregistering two MCP tools, left every test green. The tests that
  looked like coverage asserted `--help` text and a 4-of-17 sample.

## Authoring rules (the prevention)

**0. A gate is not verified until you have watched it go red.** The
whole skill is about checks that cannot fail; the same trap catches the
person checking. Three times in one session a probe came back green and
the green meant nothing:

- the probe was written as an **untracked** file, and the gate
  enumerates through `git ls-files` -- so it never saw the probe, and
  printed `OK`;
- the exit code was read through `echo | sh hook | tail`, which puts
  `echo` in `PIPESTATUS[0]` -- so the hook's real status was invisible
  and two readings came back `0`;
- `python3 -m pytest` failing was concluded as "this container cannot
  run the suite" and written into a commit message as fact, when the
  deps lived in the uv venv and `uv run pytest` gave 95 passed.

So: put the defect where the gate actually looks (staged or tracked, not
merely on disk), read the status with nothing in between, and establish
the failing reading BEFORE the passing one. A green you did not earn the
right to trust is worse than no check, because it is reported as
evidence. Tracked as barwise-906.

**1. Name and word refusal tests by why the input is invalid, never by
what is currently built.** `it("rejects a surface that is not a
surface")` survives any capability growth; `it("rejects a surface it
cannot print")` is a limitation wearing a requirement's name, and the
suite will defend it. If the honest name contains "yet", "only", "not
supported", or "cannot", you are pinning a limitation: either do not
write the test, or mark it with a comment naming the issue that will
remove it and what change flips it.

**1b. An assertion that cannot fail is not a test, and the same holds
for a scoring rubric, a lint rule, or any other check whose passes get
counted.** Before trusting one, construct the input that ought to fail
it. `must_validate` in the eval suite asserted "the model is
structurally valid" and passed on `{}` -- the only check a wholly empty
extraction passed was the one certifying soundness (barwise-902). The
test is cheap and the failure is invisible without it: a check that
always passes looks exactly like a check that is always satisfied.

**2. Before asserting an error string, apply the discriminator: does
`src` produce that string, or does your test supply it as fixture
data?** Fixture-supplied strings test relay behaviour and are fine.
A string that exists only in a production `throw` is being pinned as
forever-correct -- apply rule 1 to it.

**3. A flag or option is not covered until its value is observed at
the far end.** Asserting `--help` lists the flag, or that a bad value
is rejected, proves parsing -- not wiring. Assert on the wire: the
offline rehearsal (`cli/tests/commands/promptEvalOffline.test.ts`)
reads `fake.requests` off the loopback Ollama server; extend that
pattern, and add the mutation to its header table ("N breakages, each
caught by exactly one test").

**4. Registration lists are asserted complete, not sampled.**
`mcp/tests/serverSpawn.test.ts` pins the full sorted tool list with
`toEqual`; adding or removing an MCP tool means updating that list in
the same commit. The CLI gets this for free only because every command
has a test file driving it through `runCli` -- keep that invariant when
adding a command. VS Code's `ToolRegistration` has no pin yet (known
gap; see the 2026-08-25 audit's watch items).

**5. Two shapes that must not drift need one test that holds them
together.** When a producer and consumer live in different packages
and share no type (deliberately or not), each side's tests will feed
its own fixtures and a coordinated rename survives both. Write a
correspondence or round-trip test: `llm/tests/ConstraintCorrespondence.test.ts`
(validator vs conformance), the `withCallLog` round-trip in
`cli/tests/commands/llmUsage.test.ts` (emitter vs `llm-usage` reader).
Do not trust TypeScript to catch this: records built with conditional
spreads (`...(cond ? { field } : {})`) bypass excess-property checks
and compile clean under a field rename.

**6. When a surface gains a capability, grep the tests for the old
refusal before you ship.** barwise-847 wired review to the artifact
seam; the tests pinning "extraction only" outlived it twice. The
change that adds a capability owns deleting the tests that assert its
absence -- and updating the capability matrix in `CLAUDE.md`, per its
own rule.

## Audit method (finding the ones already in)

Run over a clean checkout of main. Deliverable is a dated findings doc
under `barwise/docs/` (see `test-suite-assertion-audit-2026-08-25.md`
for the format): method, findings with file:line evidence, and
negative results -- what was checked and cleared matters as much,
because it says what the pass covered.

**Pass 1 -- refusals that are limitations.**

```sh
grep -rn --include='*.test.ts' -E 'toContain\(|toMatch\(|toThrow\(' packages/*/tests \
  | grep -iE 'yet|only|not supported|unsupported|not implemented|cannot'
grep -rn --include='*.test.ts' -E '\bit\(\s*"(rejects|refuses|throws|errors|fails|does not)' packages/*/tests
```

For each hit, apply the discriminator (rule 2), then ask requirement
or limitation. Check the source before filing: three of four hits in
the first audit were the test feeding its own input.

**Pass 2 -- assertions that pass for the wrong reason.** Grep cannot
find these. Pick seams where tests feed a hand-written value that
production would compute (history rows, JSONL fixtures, registration
samples, flag guards), then mutate the producer and run the suites. A
mutation that survives green is the finding. Prioritise capability
seams: `llm` (artifacts, surfaces, conformance), `promptlab` (scorer,
stats, history), `cli` (flag passthrough), `mcp`/`vscode`
(registration), `core` (registry).

Operational rules for the mutation pass, each learned the hard way:

- **Commit real fixes before running any mutation.** Reverting a
  mutation with `git checkout -- <file>` discards your uncommitted
  fixes in the same file.
- **Rebuild before testing across a package boundary.** A package's
  tests read its dependencies' `dist`, so a mutation in `llm` is
  invisible to `cli` tests until `tsc` runs in `llm` (and the mcp
  spawn test runs the built server entry). An un-rebuilt mutation
  "surviving" is a false finding.
- **Verify the kill.** Every test added for a surviving mutation must
  be re-checked by re-running that exact mutation and watching the new
  test fail -- otherwise the fix may be the same decorative coverage
  it replaced.
- **Revert everything and prove it**: `git status` clean except
  intended changes, then full build + test + lint from `barwise/`.

**Pass 3 -- checks that cannot fail.** Pass 2 mutates the *producer*
to see whether a test notices. This pass mutates the *subject* to see
whether a check can fail at all. It applies wherever passes are
counted rather than merely observed -- an eval rubric, a conformance
suite, a validation gate: delete from the fixture the very thing the
check claims to require, re-run, and require it to fail. Run it as a
sweep, not a spot check; the 2026-08-29 pass over the 90-check eval
rubric took four minutes and no API calls, and found three defects
(barwise-894, -901, -902) in a rubric that had been trusted for two
recorded baselines.

Three rules, each of which caught a wrong conclusion in that one pass:

- **Use the mutation the check's own kind is about.** Deleting a
  constraint tells you nothing about a check that asks after an object
  type. Reporting one kind's control numbers as another kind's verdict
  is how 47 checks got counted as audited when none of them had been.
- **Single deletion reports redundancy as blindness.** 30 of 43 checks
  survived deleting any one constraint, which reads as "70% vacuous";
  deleting the whole class the check names showed the true figure was
  18. Always pair the single-element sweep with a whole-class control
  before believing either.
- **Verify the mutation mutated.** A payload edit that set
  `object_type` where the field is `player` left the score at a perfect
  1.000 and looked like proof that role declarations were ignored
  entirely. Assert the fixture actually changed shape before reading
  anything into the result.

**The deliverable of any of these passes is a script and a ratchet, not
a findings doc.** A sweep run by hand is a sweep that runs once: the
rubric audit above was nearly left as a throwaway, which would have let
the next rubric edit reintroduce all three defects with nothing to
notice. Follow `scripts/audit-duplication.mjs`: emit a baseline file
where every open finding carries a `tracked:<issue>` verdict, and make
`--check` fail BOTH on a new unclassified finding and on a stale entry
that no longer reproduces, so fixing one forces its row out. Then wire
it into CI. `scripts/audit-rubric.mjs` is the worked example.

Fix only what is small and unambiguous; file the rest (beads, `bd`)
with the evidence attached. Record caught mutations in the findings
doc so the next audit does not re-run them.
