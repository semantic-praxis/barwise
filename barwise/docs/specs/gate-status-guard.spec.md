# A gate's exit status always reaches the reader

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Touches: +barwise/scripts/hooks/gate-status-guard.mjs,
+barwise/scripts/lib/shell-tokens.mjs, +barwise/scripts/lib/gate-status-rules.mjs,
+barwise/scripts/tests/gate-status-guard.test.mjs,
barwise/scripts/tests/expected-counts.json, .claude/settings.json, CLAUDE.md

In one sentence: a PreToolUse hook refuses an agent's Bash command in
which a gate's exit status is overwritten before anyone reads it -- by a
pipe, or by a later command -- because the reader then sees green from a
gate that was red.

## Principle

A gate that cannot report its own failure reads the same as one that
passed. The repo's contract says so for the gates themselves (exit 2 for
"could not answer", `gate-refusal-contract.spec.md`); this is the same
failure one layer out, at the call site. A Bash command reports the
status of its last command, so in `npm run test:scripts | tail -2` the
status is `tail`'s, and in `npm run test:scripts > log; tail log` it is
also `tail`'s.

It is not hypothetical. barwise-906 names it as trap (b), from its
instance (2): the pre-push hook's status read through `echo | sh hook |
tail`. On 2026-10-23 it happened twice more in one session
(barwise-40a): `mutate.mjs ... | tail -1; echo $?` printed 0 while mutate
had refused with exit 2, and `npm run test:scripts | tail -2; echo $?`
printed 0 with a test failing. Both were caught only because the printed
text disagreed with the status. Writing the trap down did not stop it,
so the call site refuses the command rather than the next reader being
told to remember it. That is "define errors out of existence" applied to
the caller, as `python-uv-guard.mjs` already does for bare interpreters
(barwise-1060).

## What does "the status reaches the reader" mean? (resolved: one of three shapes)

The property is not "no pipes". Piping is how an agent reads long
output, and a pipe from `git log` has no status anyone acts on. Nor is
it "a gate is the last command": `gate > log 2>&1; echo "exit=$?"; tail
log` keeps the status, in text, and is the form this repo's sessions
already use. The property is that a gate's status is either the
command's own status or captured before anything overwrites it. A gate's
status reaches the reader when:

1. **it is the command's status**: the gate is in the last stage of the
   last pipeline, or followed only by `&&` (a failure stops the chain
   and the command exits with the gate's status), or the pipeline sets
   `pipefail` (`set -o pipefail`, `set -euo pipefail`) before it;
2. **it is captured at once**: the next command reads `$?`, or, for a
   gate inside a pipeline, `PIPESTATUS` (`echo "exit=$?"`, `s=$?`,
   `echo ${PIPESTATUS[0]}`). "Next" is literal: `PIPESTATUS` describes
   the most recent pipeline only, so a read two commands later reads
   someone else's status;
3. **it is handled**: the gate is followed by `||`, which is a written
   decision about failure (`gate || echo FAILED`, `gate || true`).

Anything else is a masked status: a gate in a non-final pipeline stage
with neither `pipefail` nor an immediate `PIPESTATUS`, or a gate followed
by `;`, `&` or a newline and then a command that does not read `$?`.

The form the refusal suggests is `<gate> > <log> 2>&1; s=$?; tail -20
<log>; exit $s`, which keeps the full log and makes the command's own
status the gate's, so the Bash tool reports it with no text to read.

## Which commands are gates? (resolved: derived from the scripts that define them)

A gate is a command whose exit status is its answer. The set is read
from the files that define those commands, on each check, so a new gate
is covered the day it lands:

- **Gate names**: every npm script `ci.yml` runs (from
  `scripts/lib/ci-gates.mjs`, the parser `ci-local.mjs` and
  `fault-matrix.mjs` already share), plus every script in
  `barwise/package.json` and each workspace `package.json` whose name
  matches one declared rule, `^(test|check|audit|lint|build|typecheck|validate|ci:|mutate|fault-matrix)`.
  The rule is declared rather than derived because on-demand gates
  (`mutate`, `fault-matrix`, `trial:gate`) appear in no workflow; it is
  the one hand-written part, and it names kinds, not scripts.
- **Gate commands**: the commands those scripts run, taken from their
  bodies. A body is split into commands; each contributes its head and,
  where the head is a launcher (`node`, `bash`, `sh`, `uv run`, `npx`),
  the script or tool it launches; otherwise its head and first
  subcommand. So `turbo run`, `dprint check`, `knip`, `vitest run`, `tsc`,
  `node scripts/check-review-tiers.mjs` and `uv run ... pytest` are
  gates because a gate script runs them, and `dprint fmt` is not.
- **Fixed additions**, each a launcher form the bodies cannot show:
  `node --test`; `node <path>/at-root.mjs <name>` with `<name>` a gate
  name (root CLAUDE.md's prescribed spelling); `sh` or `bash` on a file
  under `.husky/` (barwise-906's own instance).

A command is matched after its wrappers are removed: leading `VAR=value`
assignments, `env`, `timeout`, `nice`, `time`, `command`, `npx`, and the
flags of `uv run`. `npm` is matched on its subcommand after its options
(`--prefix`, `-w`, `--workspace=`, `--silent`, `-s`): `npm test` and `npm
run <gate name>`. A group, `( ... )` or `{ ...; }`, is a gate stage when
it contains a gate, so `(cd packages/core && npx vitest run) | tail` is
caught.

## Scope

In scope:

- When an agent's Bash command runs a gate whose status does not reach
  the reader in one of the three shapes above, the hook shall exit 2 and
  print the line, the gate, why its status is lost, and the suggested
  form.
- When every gate in a command is in one of the three shapes, the hook
  shall exit 0.
- When the command has no pipeline stage before another and no command
  followed by `;`, `&` or a newline and then another, the hook shall
  exit 0 without reading any file: such a command cannot mask a status.
- When the hook cannot read its input, or a command it must judge needs
  the gate set and `ci.yml` or a `package.json` cannot be read, it shall
  exit 1: shown to the user, not blocking, the "could not answer"
  `python-uv-guard.mjs` uses under Claude Code's hook contract.
- Quoted text is not a command, but a quoted word keeps its content for
  matching: `node "$CLAUDE_PROJECT_DIR/barwise/scripts/mutate.mjs"` is
  `mutate.mjs`. A heredoc body and a comment are not commands.
- A redirection is part of the command it follows: `2>&1`, `>&2`, `&>`
  and `<&` are not separators.

Out of scope: the inside of a command substitution `$( ... )` (its
status is not the command's in most uses); tracked scripts and
workflows, whose pipes are reviewed with them and linted by
`check:shell`; shells other than bash (the Bash tool here runs bash; zsh
spells the array `pipestatus`, which the capture rule also accepts, but
nothing tests zsh).

## Inventory

| Path                                          | Today                                                | After                                                                          |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `barwise/scripts/lib/shell-tokens.mjs`        | Does not exist                                       | A small bash tokenizer: words with quotes removed, operators, groups, lines    |
| `barwise/scripts/lib/gate-status-rules.mjs`   | Does not exist                                       | The gate set from the defining files, and the masked-status finding, both pure |
| `barwise/scripts/hooks/gate-status-guard.mjs` | Does not exist                                       | Reads hook input, calls the rules, applies the hook exit contract              |
| `barwise/scripts/lib/python-uv-rules.mjs`     | Splits commands with a regex over quote-blanked text | Unchanged                                                                      |
| `.claude/settings.json`                       | One PreToolUse Bash hook                             | Two, each its own entry                                                        |
| `CLAUDE.md`                                   | Monorepo Commands names the pgrep self-match trap    | One sentence beside it naming this hook and the suggested form                 |

Why a tokenizer, not `commandSegments`: that function splits on a regex
`/&&|\|\||[;|&]/` over text with quotes blanked. Both properties defeat
this check, measured: `commandSegments("npx vitest run 2>&1 | tail -30")`
returns `["npx vitest run 2>", "1 ", " tail -30"]`, so the gate's segment
ends in `&` and the pipe belongs to `1`; and blanking turns
`node "$CLAUDE_PROJECT_DIR/barwise/scripts/check-review-tiers.mjs"` into
a run of quote characters no gate can match. The uv rules tolerate both
because they look for an interpreter word, not at what joins commands.

`python-uv-rules.mjs` keeps its splitter. Moving it onto the tokenizer
would be a behaviour change to a working gate (`check:python-uv` and
its hook both import it) for no failure anyone has seen; it is filed as
a follow-up rather than done here, and the two splitters are not a
must-agree copy -- they answer different questions and neither is
derived from the other.

## Target architecture

```
scripts/lib/shell-tokens.mjs
  parse(command) -> List
    List  = [{ pipeline: Stage[], sep: "&&" | "||" | ";" | "&" | "\n" | "", line, raw }]
    Stage = { words: string[], line } | { group: List, line }
  (quotes removed inside words, $( ) kept verbatim, heredoc bodies and comments dropped,
   redirections attached to their command)

scripts/lib/gate-status-rules.mjs
  mayMask(list) -> boolean                              no file reads
  gateSet({ workflow, packages }) -> { isGate(words) }  reads ci.yml, package.json files
  maskedGates(list, gateSet) -> [{ line, gate, why }]

scripts/hooks/gate-status-guard.mjs
  stdin JSON -> parse -> mayMask? -> gateSet -> maskedGates -> exit 0 / 2 / 1
```

## Alternatives considered

- **Refuse only a gate on the left of a pipe** (the first draft). The
  review of this spec showed it moves the failure rather than removing
  it: an agent refused on `gate | tail` writes `gate > log; tail log`,
  which loses the status the same way and would be allowed.
- **Require a gate to be the last command.** Simpler to state, and it
  refuses `gate > log 2>&1; echo "exit=$?"; tail log`, a form that does
  keep the status and that every recent session uses.
- **A hand-written list of gate names.** Stale the day a gate is added;
  the defining files already list them.
- **A bash parser from npm.** A real parser for a 150-line need, a new
  dependency in a hook that starts on every Bash call, and the
  maintained candidates do not model the operators this needs any better
  than a tokenizer written for it.
- **Fold this into `python-uv-guard.mjs`.** Saves one node start per
  Bash call. Rejected: the two rules share no concern, and one file
  would make a change to either re-test both.
- **Accept the risk and close barwise-40a.** It recurred after being
  written down. The owner chose the hook on 2026-10-23.

## Workstreams (each independently shippable)

### 1. The hook

The tokenizer, the rules, the hook, its test, the `.claude/settings.json`
entry and the CLAUDE.md sentence, in one PR. The test drives the hook as
Claude Code does (JSON on stdin) and covers, each refusal asserting its
message and each watched failing with its rule removed:

- refused: the two commands recorded in barwise-40a, barwise-906's
  `echo | sh .husky/pre-push | tail`, `gate 2>&1 | tail`, `gate > log;
  tail log`, `timeout 600 npm run test:scripts | tail`, the `at-root.mjs`
  spelling, a quoted script path, `(cd pkg && npx vitest run) | tail`,
  and `gate | tail; grep x; echo ${PIPESTATUS[0]}` (a late read);
- allowed: the suggested form, `echo "exit=$?"` after a redirect,
  `pipefail`, an immediate `PIPESTATUS`, `gate && next`, `gate || echo
  FAILED`, a gate as the last command, `dprint fmt | tail`, `git log |
  head`, and a gate named only in a quoted string or a heredoc body;
- derivation: a gate added to a fixture `ci.yml`, and a command a
  fixture gate script runs, are both caught with no change to the hook;
- refusal to answer: an unreadable `ci.yml` exits 1 for a command that
  needs it, and a pipe-free command exits 0 with `ci.yml` unreadable.

## Open decisions (for review)

None. The owner chose the hook on 2026-10-23, and the design questions
the plan review raised are resolved above.

## Risks and testing

- **False refusals.** `npm run audit:specs | head`, for viewing, is
  refused even when nobody reads its status. The cost is one rewrite to
  the suggested form, which also keeps the full log.
- **False passes.** A gate the defining files do not reveal (a tool run
  directly that no script runs) is not seen. The derivation narrows that
  to tools nobody uses as a gate here.
- **Harness contract.** Exit 2 blocks and hands stderr to the agent; any
  other non-zero status is shown without blocking, so a crash fails open,
  as its sibling does.
- **Cost per command.** Most commands exit before any file read. The
  rest read `ci.yml` and the `package.json` files; measured in the PR.

## Non-goals

- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
