# A gate's exit status always reaches the reader

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-40a
Touches: +barwise/scripts/hooks/gate-status-guard.mjs,
+barwise/scripts/lib/shell-tokens.mjs, +barwise/scripts/lib/gate-status-rules.mjs,
+barwise/scripts/tests/gate-status-guard.test.mjs,
barwise/scripts/tests/expected-counts.json, .claude/settings.json, CLAUDE.md

In one sentence: a PreToolUse hook lets an agent's Bash command run a
gate only in a shape that keeps the gate's exit status visible, and
refuses every other shape, because a status overwritten by a pipe or a
later command reads green from a gate that was red.

## Principle

A gate that cannot report its own failure reads the same as one that
passed. The repo's contract says so for the gates themselves (exit 2 for
"could not answer", `gate-refusal-contract.spec.md`); this is the same
failure one layer out, at the call site. A Bash command reports the
status of its last command, so in `npm run test:scripts | tail -2` the
status is `tail`'s, and in `npm run test:scripts > log; tail log` it is
`tail`'s too.

It is not hypothetical. barwise-906 names it as trap (b), from its
instance (2): the pre-push hook's status read as `PIPESTATUS[0]` of
`echo | sh hook | tail`, which is `echo`'s. On 2026-10-23 it happened
twice more in one session (barwise-40a): `mutate.mjs ... | tail -1; echo
$?` printed 0 while mutate had refused with exit 2, and `npm run
test:scripts | tail -2; echo $?` printed 0 with a test failing. Both were
caught only because the printed text disagreed with the status. Writing
the trap down did not stop it, so the call site refuses the command
rather than the next reader being told to remember it. That is "define
errors out of existence" applied to the caller, as `python-uv-guard.mjs`
already does for bare interpreters (barwise-1060).

## Allow known shapes, or refuse known masks? (resolved: allow known shapes)

Two rounds of plan review (`/code-review`, 2026-10-23) settled this.
The first draft refused a gate on the left of a pipe, and moved the
failure: an agent refused there writes `gate > log; tail log`, which
masks the status the same way. The second listed the ways a status is
masked, and each list had holes: a backgrounded gate, `|&`, a `pipefail`
pipeline followed by another command, `s=$?` never printed, a
`PIPESTATUS` index naming the wrong stage, `if`/`for` bodies. Bash has
more ways to lose a status than a hook can enumerate.

So the hook inverts it. It recognises a few shapes that provably keep
the status, and refuses any command that runs a gate in any other shape,
including shapes it cannot parse. A parse it does not understand then
fails closed for gates rather than open, and a gap in the hook costs a
rewrite, not a wrong reading.

## The shapes that keep the status

A Bash command is a list of pipelines joined by `;`, newline, `&&`,
`||` or `&`. A gate's pipeline keeps its status when it has one of these
shapes, and the hook allows nothing else around a gate:

1. **Last.** The gate's pipeline is the last in the list, and the gate is
   its last stage or `pipefail` is in force (an earlier top-level `set`
   whose options include `-o pipefail`, with no later `set +o
   pipefail`). The command's status is then the gate's.
2. **An `&&` chain to the end.** The gate's pipeline is followed by `&&`
   and every separator after it is `&&`, with the same stage condition as
   shape 1. A failure stops the chain, so the command exits with the
   gate's status.
3. **Printed at once.** The gate is the pipeline's only stage, it is
   followed by `;` or a newline, and the next command is `echo` or
   `printf` whose text contains `$?` outside single quotes. Or the gate
   is stage `i` of a longer pipeline and the next command is `echo` or
   `printf` naming `${PIPESTATUS[i]}` with that exact `i`. The status is
   then in the output, named.
4. **Captured and re-raised.** As shape 3, but the next command is
   `NAME=$?` and the last command of the list is `exit $NAME` (quoted or
   not). This is the form the refusal suggests:
   `<gate> > <log> 2>&1; s=$?; tail -20 <log>; exit $s`. It keeps the
   full log and makes the command's own status the gate's, so the Bash
   tool reports it with nothing to read.
5. **Handled.** The gate is the pipeline's only stage and is followed by
   `||`: a written decision about failure (`gate || echo FAILED`).

A gate inside a subshell or brace group, `( ... )` or `{ ...; }`, keeps
its status into the group when it has shape 1 or 2 within the group's
own list; the group is then judged as the gate at the outer level. So
`(cd packages/core && npx vitest run) > log 2>&1; echo "exit=$?"` is
allowed and `(cd packages/core && npx vitest run) | tail` is not.

Refused whatever else is true: a gate in a compound command (`if`,
`while`, `until`, `for`, `case`, `!`, `[[ ]]`, a function body); a gate
followed by `&`; a gate in a pipeline joined with `|&` unless shape 1
or 3 applies; a gate inside `$( ... )` or backticks; and any command that
contains a gate and that the tokenizer cannot parse (an unclosed quote,
paren or heredoc).

## Which commands are gates? (resolved: every script, minus declared data scripts)

Deciding what is a gate by name failed the same way listing masks did:
any rule over names missed one (`trial:gate`) or caught a writer
(`fmt-root.mjs`). Under an allowlist of shapes, a false "gate" costs only
a rewrite into a shape that is better anyway, so the definition is
conservative: a gate is any command whose exit status a script in this
repo defines.

- `npm` running a script: `npm test`, `npm t`, `npm run <name>`, `npm
  run-script <name>`, with any options before the subcommand. Every npm
  script counts, except those declared in the rules module as returning
  data, not a verdict. The list starts with one: `bd` (the tracker
  CLI). It is declared rather than inferred because nothing in a script
  body says whether its status is a verdict.
- `node` running `--test`, or a file whose basename a `package.json`
  script body names (root and workspaces, read on each check), except
  the files of declared data scripts. So `node
  "$(git rev-parse --show-toplevel)/barwise/scripts/at-root.mjs"
  test:scripts` and `node barwise/scripts/mutate.mjs` are both gates,
  whatever the path prefix.
- A tool a `package.json` script body runs, matched by name: a body's
  command head that is an executable in `barwise/node_modules/.bin`
  (today: depcruise, dprint, eslint, husky, jscpd, knip, oxlint, publint,
  tsc, turbo, vitest, vscode-test), and `pytest`, which a body runs
  through `uv run`. Read from the bodies and `.bin` on each check, so a
  new tool used by a script is covered when the script lands.
- `git commit` and `git push`, which run the husky hooks, and any path
  under `.husky/` run directly or through `sh`/`bash`.

A command is matched at its head, or after any of the commands that run
another (`env`, `timeout`, `nice`, `nohup`, `time`, `exec`, `command`,
`stdbuf`, `sudo`, `npx`, `uv run`, `xargs`), by scanning its remaining
words for a gate head rather than parsing each launcher's options.
Scanning means `timeout -s KILL 600 npm run test:scripts` matches
without knowing that `-s` takes a value, which is the hole PR #575 found
in a name-only match. The list differs from `python-uv-rules.mjs`'s
`WRAPPER` on purpose: `WRAPPER` must parse each wrapper's options to
find where the interpreter sits, while this list only names commands
that run another, and nothing here depends on the two agreeing. A
command that is not at a head or after a launcher is not a gate: `grep
vitest log | head` is allowed.

## Scope

In scope:

- When an agent's Bash command runs a gate in a shape outside the five
  above, the hook shall exit 2 and print the line, the gate, the reason,
  and the suggested form.
- When every gate in a command has one of the five shapes, or the
  command runs no gate, the hook shall exit 0.
- When the command is a single simple command (one pipeline of one
  stage, no group), the hook shall exit 0 without reading any file: a
  lone command's status is the command's status.
- When the hook cannot read its input or a `package.json`, it shall exit
  1: shown to the user, not blocking, the "could not answer"
  `python-uv-guard.mjs` uses under Claude Code's hook contract.
- Quoted text is not a command, but a quoted word keeps its content for
  matching, and a redirection (`2>&1`, `>&2`, `&>`, `<&`, `>>`) is part
  of the command it follows. A heredoc body and a comment are not
  commands.

Out of scope: shells other than bash (the Bash tool here runs bash);
tracked scripts and workflows, whose pipes are reviewed with them and
linted by `check:shell`.

## Inventory

| Path                                          | Today                                                | After                                                                                    |
| --------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `barwise/scripts/lib/shell-tokens.mjs`        | Does not exist                                       | A bash tokenizer: words with quotes removed, raw text kept, operators, groups, compounds |
| `barwise/scripts/lib/gate-status-rules.mjs`   | Does not exist                                       | The gate matcher read from the defining files, and the shape check, both pure            |
| `barwise/scripts/hooks/gate-status-guard.mjs` | Does not exist                                       | Reads hook input, calls the rules, applies the hook exit contract                        |
| `barwise/scripts/lib/python-uv-rules.mjs`     | Splits commands with a regex over quote-blanked text | Unchanged                                                                                |
| `.claude/settings.json`                       | One PreToolUse Bash hook                             | Two, each its own entry                                                                  |
| `CLAUDE.md`                                   | Monorepo Commands names the pgrep self-match trap    | One sentence beside it naming this hook and the suggested form                           |

Why a tokenizer, not `commandSegments`: it splits on `/&&|\|\||[;|&]/`
over text with quotes blanked. Measured, `commandSegments("npx vitest
run 2>&1 | tail -30")` returns `["npx vitest run 2>", "1 ", " tail
-30"]`, so the gate's segment ends in `&` and the pipe belongs to `1`;
and blanking turns a quoted script path into quote characters no gate
can match. The uv rules tolerate both because they look for an
interpreter word, not at what joins commands. `python-uv-rules.mjs`
keeps its splitter: moving a working gate onto the tokenizer is a
behaviour change no failure has asked for, filed as a follow-up.

## Target architecture

```
scripts/lib/shell-tokens.mjs
  parse(command) -> { ok: true, list } | { ok: false, why }
    list  = [{ pipeline: Stage[], pipes: ("|" | "|&")[], sep, line, raw }]
    Stage = { kind: "simple", words, raw } | { kind: "group", list }
          | { kind: "compound", raw }          // if / for / while / case / ! / [[ / function

scripts/lib/gate-status-rules.mjs
  gateMatcher({ root }) -> (words) => gate name | null    reads package.json files, .bin
  unkeptGates(list, isGate) -> [{ line, gate, why }]     the five shapes, nothing else

scripts/hooks/gate-status-guard.mjs
  stdin JSON -> parse -> single simple command? exit 0
             -> gateMatcher -> unkeptGates -> exit 0 / 2 / 1
```

## Alternatives considered

- **Refuse a gate on the left of a pipe** (first draft). Moves the
  failure to `gate > log; tail log`.
- **Refuse a list of masking shapes** (second draft). Each list missed
  shapes bash allows; see the resolved question.
- **Require a gate to be the last command.** Refuses `gate > log 2>&1;
  echo "exit=$?"; tail log`, which keeps the status and is the form
  recent sessions use.
- **Name gates with a pattern over script names.** Missed `trial:gate`
  and caught writers; the conservative definition makes a false match
  cost a rewrite instead.
- **A bash parser from npm.** A new dependency in a hook that starts on
  every Bash call, for a grammar subset a tokenizer covers, and the
  shapes check would still be ours.
- **Fold this into `python-uv-guard.mjs`.** Saves one node start per Bash
  call; the rules share no concern.
- **Accept the risk and close barwise-40a.** It recurred after being
  written down; the owner chose the hook on 2026-10-23.

## Workstreams (each independently shippable)

### 1. The hook

The tokenizer, the rules, the hook, its test, the `.claude/settings.json`
entry and the CLAUDE.md sentence, in one PR. The test drives the hook as
Claude Code does (JSON on stdin). Each refusal asserts its message, and
each rule is watched failing with it removed:

- refused: both commands recorded in barwise-40a; barwise-906's `echo |
  sh .husky/pre-push | tail; echo ${PIPESTATUS[0]}` (wrong index);
  `gate 2>&1 | tail`; `gate |& tail`; `gate > log; tail log`; `gate >
  log; s=$?; tail log` (captured, never raised); `set -o pipefail; gate |
  tail; grep x log`; `gate &`; `gate && echo ok; tail log`; `gate | tail
  && echo ok`; `timeout -s KILL 600 npm run test:scripts | tail`; the
  `at-root.mjs` spelling; a quoted script path; `(cd pkg && npx vitest
  run) | tail`; `if npm test; then echo ok; fi`; `git push 2>&1 | tail`;
  an unclosed quote around a gate;
- allowed: each of the five shapes, including the suggested form and
  ``${PIPESTATUS[1]}`` naming the right stage; `(cd pkg && npx vitest run)
  > log 2>&1; echo "exit=$?"``; a lone gate; ``git log | head``; ``grep
  > vitest log | head``; ``node barwise/scripts/beads-crud.mjs list | head`
  > (a declared data script); a gate named only inside quotes or a heredoc
  > body;
- derivation: a script added to a fixture `package.json`, and a tool its
  body runs, are both gates with no change to the hook;
- could not answer: an unreadable `package.json` exits 1 for a command
  that needs it, and a lone command exits 0 with it unreadable.

## Open decisions (for review)

None. The owner chose the hook on 2026-10-23; the two plan-review
rounds' questions are resolved above.

## Risks and testing

- **False refusals.** `npm run audit:specs | head`, for viewing, and
  `npm run fmt | tail` are refused. The cost is a rewrite to the
  suggested form, which keeps the full log; the refusal prints it.
- **False passes.** A gate no script in the repo defines (a tool run
  directly that no `package.json` body names) is not seen.
- **Harness contract.** Exit 2 blocks and hands stderr to the agent; any
  other non-zero status is shown without blocking, so a crash fails open,
  as its sibling does. A parse failure around a gate is a refusal, not a
  crash.
- **Cost per command.** A lone command reads no file. The rest read the
  `package.json` files and list `.bin`; measured in the PR.

## Non-goals

- Linting shell scripts in the repository (`check:shell` does that).
- Changing any gate's own exit contract.
