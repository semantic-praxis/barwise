# A gate's exit status is never read through a pipe

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Touches: +barwise/scripts/hooks/pipe-status-guard.mjs,
+barwise/scripts/lib/pipe-status-rules.mjs, +barwise/scripts/lib/shell-lines.mjs,
barwise/scripts/lib/python-uv-rules.mjs, barwise/scripts/hooks/python-uv-guard.mjs,
+barwise/scripts/tests/pipe-status-guard.test.mjs,
barwise/scripts/tests/expected-counts.json, .claude/settings.json, CLAUDE.md

In one sentence: a PreToolUse hook refuses an agent's Bash command that
pipes a gate into another command, because the pipeline's status is the
last command's and a red gate then reads green.

## Principle

A gate that cannot report its own failure reads the same as one that
passed. The repo's contract says so for the gates themselves (exit 2 for
"could not answer", `gate-refusal-contract.spec.md`); this is the same
failure one layer out, at the call site. `npm run test:scripts | tail -2;
echo $?` prints `tail`'s 0 whatever the suite did.

It is not hypothetical. barwise-906 named it as its case 4. On
2026-10-23 it happened twice in one session (barwise-40a): `mutate.mjs
... | tail -1; echo $?` printed 0 while mutate had refused with exit 2,
and `npm run test:scripts | tail -2; echo $?` printed 0 with a test
failing. Both were caught only because the printed text disagreed with
the status. Writing it down did not stop it: the case was already
recorded in barwise-906 when it recurred. So
the call site refuses the pipe, rather than the next reader being told
to remember it. That is "define errors out of existence" applied to the
caller, as `python-uv-guard.mjs` already does for bare interpreters
(barwise-1060).

## Should the hook refuse every pipe? (resolved: no, only a gate's)

Piping is how an agent reads long output, and almost every pipe is
harmless: `git log | head` has no status anyone acts on. The failure
needs a command whose exit status IS the answer, on the left of a pipe.
Refusing every pipe would refuse dozens of harmless commands a session
and teach the agent to ignore the hook.

So the hook refuses only a pipeline whose non-final stage runs a gate,
and the set of gates is **derived, not listed**:

- every npm script `ci.yml` runs, from `scripts/lib/ci-gates.mjs`, the
  parser `ci-local.mjs` and `fault-matrix.mjs` already share, plus
  `ci:local` itself and `test` (the pre-push and the per-package runs);
- the scripts those npm scripts invoke, read from `barwise/package.json`,
  so `node barwise/scripts/check-review-tiers.mjs | tail` is caught the
  same as `npm run check:review-tiers | tail`;
- `mutate.mjs`, whose whole output is its status, and the test and type
  runners a package-local check uses: `vitest`, `node --test`, `tsc`.

A new CI gate is covered the day it lands, with nothing to edit here.

The hook allows the pipe when the command keeps the status: `set -o
pipefail` before it, or `PIPESTATUS` read after it. The suggested form
in the refusal is the one this repo's sessions already use,
`<gate> > <log> 2>&1; echo "exit=$?"; tail <log>`.

## Scope

In scope:

- When an agent's Bash command contains a pipeline (`|`, not `||`) whose
  stage before the last runs a gate as defined above, and the command
  neither sets `pipefail` before that pipeline nor reads `PIPESTATUS`
  after it, the hook shall exit 2 and name the line, the gate and the
  redirect-to-file form.
- When the gate's output is redirected to a file and read afterwards,
  the hook shall allow the command.
- When the hook cannot read its input, or cannot derive the gate set
  (`ci.yml` or `package.json` unreadable), it shall exit 1: shown to the
  user, not blocking, the same "could not answer" `python-uv-guard.mjs`
  uses under Claude Code's hook contract.
- Quoted text, heredoc bodies and comments are not commands: a commit
  message that mentions `npm run test | tail` is not refused.

Out of scope: tracked scripts and workflows (a script's pipe is its
author's, reviewed with the script; `check:shell` lints them); commands in a
subshell or function body the hook cannot see into; judging whether an
agent then misreads a status it did keep.

## Inventory

| Path                                          | Today                                             | After                                                                   |
| --------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `barwise/scripts/lib/python-uv-rules.mjs`     | Holds the shell-line helpers and the Python rules | Python rules only; imports the helpers                                  |
| `barwise/scripts/lib/shell-lines.mjs`         | Does not exist                                    | The shell-line helpers, shared by both hooks                            |
| `barwise/scripts/lib/pipe-status-rules.mjs`   | Does not exist                                    | The gate set and the pipeline finding, pure, exported for tests         |
| `barwise/scripts/hooks/pipe-status-guard.mjs` | Does not exist                                    | Reads the hook input, calls the rules, applies the hook's exit contract |
| `.claude/settings.json`                       | One PreToolUse Bash hook                          | Two, each its own entry                                                 |
| `CLAUDE.md`                                   | Monorepo Commands names the pgrep self-match trap | One sentence beside it naming this hook                                 |

The shell helpers (`blankQuoted`, `logicalLines`, `commandSegments`,
`withoutHeredocBodies`) are not about Python. Importing them from
`python-uv-rules.mjs` would make a pipe check depend on the Python
module, which is the hidden coupling the orthogonality principle names;
moving them is a pure relocation with the uv suite as its guard.
`commandSegments` keeps its signature and gains the separator that ended
each segment, which a pipeline check needs and the uv rules ignore.

## Target architecture

```
scripts/lib/shell-lines.mjs        blankQuoted, logicalLines, withoutHeredocBodies,
                                   commandSegments (+ sep: "|", "||", "&&", ";", "&", "")
scripts/lib/python-uv-rules.mjs    imports shell-lines; unchanged rules
scripts/lib/pipe-status-rules.mjs  gateMatchers({ workflow, pkg }) -> predicates
                                   pipeFindings(command, matchers) -> [{ line, gate, raw }]
scripts/hooks/pipe-status-guard.mjs  stdin JSON -> pipeFindings -> exit 0 / 2 / 1
```

## Alternatives considered

- **One hook for both rules.** Saves one node start (about 40 ms) per
  Bash call. Rejected: the two rules share helpers, not a concern, and
  one file would make a change to either re-test both.
- **A hand-written list of gate names.** Simpler, and stale the day a
  gate is added. The list already exists in `ci.yml`, and
  `ci-gates.mjs` parses it for two callers.
- **Accept the risk and close barwise-40a.** It recurred after being
  written down, twice in one session, and each time produced a wrong
  claim that only luck caught. The hook sits beside an existing one and
  reuses its parsing.
- **Refuse only when `$?` is read after the pipe.** Misses the main
  case: the Bash tool reports the whole command's status, so a trailing
  `gate | tail` with no `$?` reads green too.

## Workstreams (each independently shippable)

### 1. The hook

Move the shell helpers, add the rules module, the hook and its test,
register the hook in `.claude/settings.json`, and add the CLAUDE.md
sentence. One PR; the move has no behaviour change and the uv suite
guards it. The test drives the hook as Claude Code does (JSON on stdin)
and covers: each recorded command from barwise-40a refused; the
redirect-to-file form, `pipefail` and `PIPESTATUS` allowed; a gate
named only in quoted text or a heredoc allowed; a non-gate pipe allowed;
a gate added to a fixture `ci.yml` caught with no change to the hook;
an unreadable `ci.yml` exiting 1. Every refusal test asserts its
message, and each is watched failing with its rule removed.

## Open decisions (for review)

None. The owner chose the hook over accepting the risk on 2026-10-23.

## Risks and testing

- **False refusals.** A gate piped for viewing (`npm run audit:specs |
  head`) is refused even when nobody reads its status. The cost is one
  rewrite to the redirect form, which also keeps the full log; the
  refusal message gives the form.
- **Harness contract.** Exit 2 blocks and hands stderr to the agent;
  anything else other than 0 is shown without blocking. A bug that
  threw would show, not block: the hook fails open, as its sibling does.
- **Cost per command.** One node start and two small file reads per Bash
  call; measured in the PR.

## Non-goals

- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
