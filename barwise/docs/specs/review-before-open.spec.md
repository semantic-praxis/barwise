# A pull request opens only after this session reviewed the commit it proposes

Status: Draft -- no workstream implemented

Created: 2026-11-20
Last-updated: 2026-11-20
Tracking: barwise-953
Touches: +barwise/scripts/hooks/pr-open-guard.mjs,
+barwise/scripts/hooks/review-recorder.mjs,
+barwise/scripts/lib/gh-command.mjs, +barwise/scripts/lib/review-record.mjs,
barwise/scripts/hooks/merge-guard.mjs,
+barwise/scripts/tests/pr-open-guard.test.mjs,
barwise/scripts/tests/expected-counts.json, .claude/settings.json,
barwise/docs/adr/review-policy.md, barwise/docs/adr/tested-in.json,
.claude/skills/pr-creation/SKILL.md, .claude/skills/pr-review/checklist.md,
CLAUDE.md

In one sentence: in a session that loads the project hooks, a call that
opens a pull request is refused unless that session's own record shows
`/code-review` was invoked and `pr-review/checklist.md` was read whole
while HEAD was the commit the pull request proposes; the owner's
instruction to open without review travels as an `Opened-without-review:`
line in the body and is logged.

The owner chose refusal on 2026-11-20. This spec designs it; it does not
reopen the choice. Its price is stated once here: every commit made
after a review needs both steps again before the pull request can open.

## Principle

Review before opening is a rule nothing holds. `pr-creation`'s readiness
gate asks for `/code-review` and the checklist on the author's own diff,
and `docs/adr/review-policy.md` records that "nothing records that
`/code-review` or `/security-review` ran (barwise-953)". The rule has
been stated in a skill since 2026-09-07 and broken four times since:

| When       | Pull request | What ran before opening                      | Who noticed            |
| ---------- | ------------ | -------------------------------------------- | ---------------------- |
| 2026-09-07 | #448         | gates and mutation checks, no review         | the owner, asked twice |
| 2026-09-11 | #501         | no `pr-creation`, no review                  | a later skill read     |
| 2026-09-17 | #525         | checklist headings read earlier, from memory | the owner              |
| 2026-11-13 | #1028        | `pr-creation`, `pr:risk`, `/code-review`     | the owner              |

The first three are barwise-953's notes on `main`. The fourth is a note
on #1028's branch, which has not merged; it is the case where
`/code-review` ran and the checklist did not, and the review the owner
then asked for found seven defects in the spec.

Root `CLAUDE.md` says a finding closes by a mechanism, and barwise-953's
acceptance criteria say a restatement in prose does not close it. The
merge end already has its mechanism: `merge-guard.mjs` refuses a merge
call with no verdict on the pinned head. The opening end has none. This
spec builds that counterpart, on the same footing: a `PreToolUse` hook
that refuses the call, reading a record that something other than the
author's say-so wrote.

"Explicit over implicit" decides the record's shape. Every earlier
occurrence had a body or a reply that said, or implied, the review was
done. So the record is written by a hook when the review step happens,
keyed to the commit it happened on, and the guard believes nothing else.

## What counts as "the review ran"? (resolved: a `/code-review` invocation and a whole-file read of the checklist, each on the proposed commit)

Two observations, both made by a `PostToolUse` hook, both stamped with
`git rev-parse HEAD` at the moment they happen.

**`/code-review`: the `Skill` tool was called with skill `code-review`.**
Measured in this session (Claude Code 2.1.329, 2026-11-20) with a
probe, a temporary hook that wrote each input it received to a file: a
`Skill` call for `spec-writer` fired `PostToolUse` with
`tool_name: "Skill"`, `tool_input: {"skill": "spec-writer"}` and
`tool_response: {"success": true, "commandName": "spec-writer"}`.
(Provisional: measured for a project skill, not yet for the built-in
`code-review`. This spec's plan review invokes it with the probe in
place; if its `tool_input.skill` is some other name, the recorder
matches the measured name and this paragraph is corrected before
implementation.)

**The checklist: the `Read` tool returned all of
`.claude/skills/pr-review/checklist.md` to the main conversation.**
Measured the same way: a `Read` fires `PostToolUse` with
`tool_input.file_path` and
`tool_response.file.{startLine, numLines, totalLines}`. A read with
`limit: 5` reported `numLines: 5` of `totalLines: 428`; a read with no
limit reported `startLine: 1` and `numLines` equal to `totalLines`. A
second whole-file read of the unchanged file returned the whole file
again, so a repeat is a real read and not a stub.

The alternative was to observe a `pr-review` skill invocation. The read
is chosen for three reasons:

- The #1028 occurrence ran a skill and `/code-review` and still skipped
  the checklist. An invoked skill loads `SKILL.md`, which tells the
  session to run the checklist; it does not put the checklist in front
  of it. The read does.
- The #525 occurrence applied headings "read earlier in the session ...
  from memory". Keying the read to the proposed commit refuses that
  case: a read on an earlier commit does not count.
- Both routes to a checklist run produce the read: the author's own pass
  (`pr-creation`, section 1) and the full `pr-review` skill (its section 3). One observation covers both, and the author's pass does not have
  to become a full `pr-review` run that the merge end then repeats.

The read must be whole because a partial read cannot be told from
reading the headings, which is the #525 case. It must come from the main
conversation (no `agent_id` in the hook input) because a subagent's tool
calls carry the parent's `session_id` (measured: an `Explore` subagent's
`Read` arrived with this session's id plus `agent_id` and `agent_type`),
and an exploring subagent that happens to read the file is not this
session running the checklist. A `/code-review` invocation is recorded
wherever it fires: nothing invokes it by accident, and refusing a
delegated review would cost a second full review.

**What the record cannot see.** It is a shadow of the property, in root
`CLAUDE.md`'s sense, and it diverges where the step is started and not
done:

- That a review was started on this commit is recorded; that it
  finished, what it found, and whether the findings were fixed are not.
  The `Skill` call returns when the skill loads, before any reviewing.
- `/code-review`'s effort level and target are not read. A review of
  another path, at `low`, on this commit counts.
- A read is not an application. Which checklist groups were run, and
  against what, is not recorded.
- The checklist reaching the session another way is not a read: `cat` in
  Bash, a `Grep`, a subagent's summary. The refusal names the `Read`
  tool so the remedy is one call.
- A `/code-review` the user types is expanded without the `Skill` tool
  (documented: `PreToolUse` on `Skill` "fires only when Claude calls the
  tool"), so it is not recorded. Open decision 1.

All four recorded occurrences are the kind the shadow sees exactly: a
step that was never started on the commit. The spec claims that much and
no more. The merge end still requires a posted verdict on the merged
head, so a review started and abandoned here is caught there or not at
all.

## Which commit? (resolved: the tip of the head branch on the remote, asked at the moment of the call)

A pull request proposes whatever the head branch points at on GitHub.
The guard asks for exactly that: `git ls-remote origin
refs/heads/<head>`, where `<head>` is the call's `head` argument (or,
for `gh pr create` without `--head`, the current branch). Measured here:
`git ls-remote origin refs/heads/main` answers through the session's
proxy in under a second.

The local `HEAD` is not used at the guard. It can be ahead of the push,
or on another branch. The remote-tracking ref is not used either: it is
this clone's memory of the remote, and `steward` section 6 records three
ways it goes stale. The recorder does use local `HEAD`, because that is
what the review read; the two meet as shas, and equality is the whole
test. A commit made after the review has a different sha, so "a run on
an earlier commit does not count" needs no clock and no ancestry rule.

A branch the remote does not have is a refusal ("push first"), and so is
a head in another repository (`fork:branch`, or a call whose
`owner/repo` is not `origin`'s): the guard cannot resolve either.

## How does the owner open one without review? (resolved: an `Opened-without-review:` line in the body)

When the owner says to open a pull request without the review, the
agent puts the instruction in the body, quoted:

```
Opened-without-review: "open it now, I will review it myself" (owner, 2026-11-20)
```

The guard allows a call whose body carries that line with text after the
colon, and logs it in two places: the body itself, which every reader of
the pull request sees and GitHub's search finds
(`"Opened-without-review:" in:body`), and an `override` entry in the
session record. A line with no text is refused: an empty override
records no instruction, as `check:merge-record` already rules for an
empty `Owner-directed:` trailer.

The key is not `Owner-directed:` because that one already means "merge
without the review trailers" in a merge commit message
(`merge-delegation.md#owner-overrides`), and a repository set to build
merge messages from the pull request description would carry a body line
into the merge commit and excuse the merge as well.

The override defers the review; it does not remove it. `merge-guard`
still refuses the merge until a verdict is posted on the head, unless
the owner directs that too. Nothing can check that the owner said it: a
session acts as the owner (barwise-4q0). The `pr-review` checklist gains
one item so the reviewer at the merge end asks.

## Scope

In scope, as requirements:

1. When a `PostToolUse` event reports the `Skill` tool with
   `tool_input.skill` equal to `code-review`, the recorder shall append
   an entry of kind `code-review` carrying `git rev-parse HEAD` (run in
   the event's `cwd`) to the session's review record.
2. When a `PostToolUse` event with no `agent_id` reports a `Read` of
   `<repository root>/.claude/skills/pr-review/checklist.md` whose
   response has `startLine` 1 and `numLines` equal to `totalLines`, the
   recorder shall append an entry of kind `checklist` the same way.
3. When the recorder has matched an event and cannot write its entry (no
   usable `session_id`, a base directory `checkBase` refuses, `git`
   cannot name `HEAD`, a failed write), it shall exit 2 with the reason
   on stderr and append nothing. `PostToolUse` shows that to the model
   and blocks nothing. For any other event it exits 0 and prints nothing.
4. When a tool call opens a pull request, the guard shall exit 2 unless
   the session's record holds a `code-review` entry and a `checklist`
   entry whose sha is the proposed commit. The calls are:
   `mcp__github__create_pull_request`; in Bash, `gh pr create` (not with
   `--help`, `-h` or `--dry-run`) and a `gh api` write to
   `repos/<owner>/<repo>/pulls`.
5. When the guard refuses under 4, the message shall name the proposed
   sha, which of the two entries is missing, the sha each was last
   recorded on if any, the two actions that create them, and the
   override.
6. When the guard cannot answer -- the tool call cannot be parsed, the
   input has no usable `session_id`, the base directory or the record
   cannot be read, the head branch cannot be named or resolved -- it
   shall exit 2 and name what it could not see. It never exits 0 or 1 in
   that state (`docs/adr/gate-refusal-contract.md`; exit 2 is also what
   blocks a `PreToolUse` call).
7. When the record holds lines the guard cannot parse and the entries it
   needs are not among the lines it can, the refusal shall say how many
   lines were unreadable. A line that parses is believed; an unreadable
   line can hide an entry and cannot invent one.
8. When the body of a pull-request-opening call carries a line
   `Opened-without-review:` followed by text, the guard shall append an
   `override` entry to the record and exit 0. When it cannot append the
   entry, or the line has no text, it shall exit 2.
9. When a Bash command runs `gh api graphql` with a `createPullRequest`
   mutation, the guard shall exit 2: it cannot read a head out of a
   query string. This is `merge-guard`'s rule for `mergePullRequest`.
10. A draft is a pull request: `draft: true` and `--draft` change
    nothing. `pr-creation` section 5 already says a branch that is not
    ready does not get one.

Out of scope:

- `pr-creation`, `session-review` and `/security-review` are not
  recorded or required. The owner's mechanism names `/code-review` and
  the checklist. The refusal message points at `pr-creation`.
- `mcp__github__create_pull_request_with_copilot` hands a task to
  Copilot, which writes the commits; no commit of this session exists to
  review when it is called.
- A detective half. Nothing reads opened pull requests afterwards (Open
  decision 3).
- A stopping rule for the review loop (barwise-q93). See Risks.
- barwise-7k4, the gate-layer consolidation. This spec moves
  `merge-guard`'s command parser into a shared module because the owner
  asked for one parser, and changes nothing else in that hook.

## Inventory

| File                                               | Current state                                                   | Verdict                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `barwise/scripts/hooks/merge-guard.mjs`            | parses `gh` commands in six module-private functions            | imports them from `lib/gh-command.mjs`; behaviour unchanged               |
| `barwise/scripts/lib/gh-command.mjs`               | does not exist                                                  | new: the moved parser, plus `repoFromRemote`                              |
| `barwise/scripts/lib/exit-log.mjs`                 | owns `exitBase`, `checkBase`, `SESSION_ID`                      | untouched; imported                                                       |
| `barwise/scripts/lib/review-record.mjs`            | does not exist                                                  | new: the record's path, append and read                                   |
| `barwise/scripts/hooks/review-recorder.mjs`        | does not exist                                                  | new: the `PostToolUse` writer                                             |
| `barwise/scripts/hooks/pr-open-guard.mjs`          | does not exist                                                  | new: the `PreToolUse` guard                                               |
| `.claude/settings.json`                            | `PreToolUse` on Bash and the merge tools; `PostToolUse` on Bash | gains the recorder on `Skill` and `Read`, the guard on Bash and create-PR |
| `barwise/scripts/tests/merge-guard.test.mjs`       | drives the hook as a process, every refusal planted             | untouched; the regression net for the move                                |
| `barwise/scripts/tests/pr-open-guard.test.mjs`     | does not exist                                                  | new: every refusal planted, the override, the recorder, the wiring        |
| `barwise/docs/adr/review-policy.md`                | says nothing records that `/code-review` ran                    | gains decision `review-before-open` and loses that sentence               |
| `.claude/skills/pr-creation/SKILL.md`, `CLAUDE.md` | state the author-side review as practice                        | point at the ADR decision instead of restating it                         |
| `.claude/skills/pr-review/checklist.md`            | no item on an overridden opening                                | one item under "Every PR"                                                 |

`merge-guard.mjs` cannot simply be imported: it runs on import (it reads
stdin at module scope), and its parser functions are not exported. Hence
the move. `REVIEW.md` is not touched: its lane table already says who
runs `/code-review` and when, and `check:review-workflows` holds that
table to `review-lanes.json`; the enforcer belongs in the ADR that
table points to.

## Target architecture

```
.claude/settings.json
  PostToolUse  Skill|Read                       -> hooks/review-recorder.mjs
  PreToolUse   Bash                             -> hooks/pr-open-guard.mjs   (beside python-uv-guard, merge-guard)
  PreToolUse   mcp__github__create_pull_request -> hooks/pr-open-guard.mjs

<os.tmpdir()>/barwise-exit-<uid>/<session id>/      (the directory masked-exit already uses)
  exits.jsonl      masked-exit's log, untouched
  state.json       masked-exit's read position, untouched
  reviews.jsonl    one JSON object per line, append-only:
                     {"t": 1795180000000, "kind": "code-review", "sha": "<40 hex>"}
                     {"t": 1795180100000, "kind": "checklist",   "sha": "<40 hex>"}
                     {"t": 1795180200000, "kind": "override",    "sha": "<40 hex>", "text": "..."}

scripts/lib/gh-command.mjs      ghCalls, subcommand, flagValue, apiFields, repoFromRemote
                                (moved from merge-guard.mjs; both hooks import them)
scripts/lib/review-record.mjs   reviewLogPath(base, session)
                                appendReview(base, session, entry)
                                readReviews(base, session) -> { entries, unreadable }

review-recorder.mjs (PostToolUse)        pr-open-guard.mjs (PreToolUse)
  not a matching event -> exit 0           not a PR-opening call -> exit 0
  sha = git rev-parse HEAD (cwd)           override line in the body -> log, exit 0
  appendReview(...)                        sha = git ls-remote origin refs/heads/<head>
  cannot record -> exit 2, says why        both kinds on sha -> exit 0
                                           otherwise -> exit 2, says why
```

Both hooks are wired as `env -u BARWISE_EXIT_DIR node ...`, as every
hook in the file is, so their own exits stay out of masked-exit's log.

The recorder filters events itself and is not narrowed with the hook
handler's `if` field. The harness evaluates `if` where no test here can
see it, and a pattern that silently stopped matching would turn every
opening into a refusal with nothing pointing at the wiring. The cost is
one node start per `Read` (about 30 ms here, `time node -e 0`).

## Alternatives considered

- **A reminder instead of a refusal.** The same `PreToolUse` hook could
  exit 0 and hand the model a note ("you have not run `/code-review` on
  this commit") through `additionalContext`. It is the cheapest build
  and never blocks legitimate work. It lost on the history: in all four
  occurrences the skills were known and discoverable, so the missing
  thing was not information, and the note arrives beside the result of a
  call that has already opened the pull request. A reminder that fires
  before the call and requires a second call to proceed is a refusal
  with one free pass. The owner decided "refuse" on 2026-11-20.
- **A CI gate on the body's Session review section.** barwise-953's own
  candidate 2: fail a pull request whose body lacks the section or names
  no ledger issue. It runs for every author, including sessions that
  load no hooks, which this design cannot do. It lost because it reads
  text the author writes: #525's body asserted "Checklist groups run:
  Every PR; When a spec was added or revised" and the checklist had not
  been run. It also fires after the pull request is open, and it checks
  the presence of a different thing (the session review) from the two
  steps the owner named.
- **A record the agent writes itself**, with a command such as
  `node scripts/review-record.mjs --ran code-review`. No `PostToolUse`
  wiring and no dependence on tool payload shapes. It lost for the same
  reason as the body gate: it records a claim, and the claim is what
  failed.
- **No record: read the session transcript at the guard.** The hook
  input carries `transcript_path`, and the transcript holds every tool
  call, so the guard could look for the `Skill` call and the `Read`
  there and need no recorder. It lost on two counts. The transcript is
  the harness's private file format, where the hook input is its
  documented interface. And the transcript has no sha: "after the last
  commit" would have to be inferred from timestamps against the commit's
  date, which a fast-forward to an older commit or an amended date gets
  wrong in the direction of allowing.
- **Gate the push, not the opening.** A pre-push git hook can read the
  same record (`CLAUDE_CODE_SESSION_ID` is in the Bash environment). It
  lost because pushing is not proposing: root `CLAUDE.md` requires every
  session to push its work before it ends, reviewed or not.
- **Let a review on an ancestor count when little changed since.** It
  would end the re-review after a one-line fix. It lost because the
  owner's rule is that a run on an earlier commit does not count, and
  any "little" is a threshold with no stated relation to an outcome.

## Workstreams (each independently shippable)

### 1. The parser move, the recorder, the guard and their wiring

One pull request, read by commit:

1. Move `withoutHeredocBodies`, `segments`, `ghCalls`, `VALUED`,
   `subcommand`, `flagValue`, `apiFields` and `repoFromRemote` from
   `merge-guard.mjs` to `lib/gh-command.mjs`, byte for byte, and import
   them back. `merge-guard.test.mjs` passes unchanged.
2. Add `lib/review-record.mjs`, `hooks/review-recorder.mjs` and
   `hooks/pr-open-guard.mjs`, wire them in `.claude/settings.json`, and
   add `tests/pr-open-guard.test.mjs`. The tests drive both hooks as
   processes with JSON on stdin, against a temporary clone with a bare
   repository as `origin` and `TMPDIR` pointed at a temporary directory,
   so `git ls-remote` and the record are real and nothing is stubbed.
   Each requirement in Scope has a test that plants its violation; the
   refusal tests assert the message, not only the exit code (root
   `REVIEW.md`, failure mode 3). One test reads `.claude/settings.json`
   and fails if either hook is unwired.
3. Add decision `review-before-open` to `docs/adr/review-policy.md`
   with `Enforced-by: tests (review-before-open)`, the tests tagged
   `[adr:review-policy#review-before-open]`, and the plant line in the
   pull request body that `adr-writing.md` asks for. Replace the
   restatements in `pr-creation` section 1 and the root `CLAUDE.md`
   conventions with pointers to the decision, and add the checklist item
   on `Opened-without-review:`.

Acceptance, beyond the suite: in the session that builds it, the guard
is watched refusing a real `mcp__github__create_pull_request` call for
that pull request, and then allowing the same call once both steps have
run on that head. barwise-953's acceptance criteria require the first
half. The hooks are live in the building session as soon as
`.claude/settings.json` is edited (measured: a probe hook added
mid-session fired on the next tool call).

barwise-953 closes in a tracker-only pull request after this one merges.

## API and migration impact

- No package changes; nothing under `barwise/packages/` is touched.
- `merge-guard.mjs` keeps its behaviour and its tests. Its parser gains
  a second caller, so a change to `lib/gh-command.mjs` is a change to
  both hooks (checklist, "A change to a shared function names each
  caller").
- Every session that loads `.claude/settings.json` gains one node start
  per `Read` and per `Skill` call, and one more per Bash call.

## Open decisions (for review)

1. **A `/code-review` the user types.** It bypasses the `Skill` tool, so
   the recorder does not see it, and a pull request opened afterwards is
   refused until the session invokes the skill itself or the owner
   overrides. The documented event for it is `UserPromptExpansion`, with
   `command_name`. Options: (a) wire the recorder to that event now,
   from the documented input shape; (b) leave it out and file it.
   Recommended: (b). An agent session cannot type a slash command, so
   the event's real input cannot be observed here, and a test written
   against a guessed fixture is the "fixture with the shape the real
   producer emits" defect in advance. The failure is a refusal, which is
   the safe direction. In remote sessions, where most pull requests here
   are opened, a `/code-review` in the user's message reaches the agent
   as a request to call the `Skill` tool, which is recorded.
2. **An unparsable tool call on the Bash wiring.** The guard cannot tell
   whether it opens a pull request. Options: (a) exit 2, which blocks
   every Bash call while the harness sends input the guard cannot parse;
   (b) exit 1, as `merge-guard` and `python-uv-guard` do, which lets the
   call through with a note only a verbose transcript shows.
   Recommended: (a). `gate-refusal-contract.md` asks for it, the state
   has not been observed, and a session blocked loudly is found sooner
   than a guard that has silently stopped guarding. `merge-guard`'s
   exit 1 is left alone here; changing it belongs with barwise-7k4.
3. **No detective half.** A session that loads no project hooks, or a
   person, opens a pull request unguarded and nothing reports it
   afterwards. Options: (a) accept and state it in the ADR, as
   `merge-delegation.md` states the same limit for `merge-guard`;
   (b) add a check that reads opened pull requests. Recommended: (a).
   The record lives in a session's temporary directory, so a later
   check would have nothing to read but the body, which is the rejected
   alternative above.

## Risks and testing

- **Every fix after a review needs the review again**, including the
  checklist read, because the fix is a new commit. That is the owner's
  rule and it is also barwise-q93's unresolved problem moved to a place
  where it now blocks: local `/code-review` has no stopping rule, and
  the ways out of the loop are a round that needs no fix or the
  override. Tripwire: sessions that routinely need a third round before
  opening mean q93 has to be decided before anything else leans on this
  guard.
- **The guard adds pressure to the thing it observes.** Before it,
  nothing was gained by invoking a skill and ignoring it. Tripwire: one
  pull request whose record was complete and whose review visibly did
  not happen (opened in the same turn as the `Skill` call, or with
  `/code-review`'s findings untouched) reopens "What counts", and the
  next observation to consider is what the review produced, not that it
  started.
- **The record is lost with the container.** It lives under
  `os.tmpdir()`, and a resumed session in a fresh container starts with
  none. The guard refuses and the steps run again; nothing is opened on
  a record that is gone.
- **The harness changes a payload shape.** If `tool_response.file` is
  renamed, the recorder stops matching whole-file reads and every
  opening is refused. The tests cannot see that: they hold the hooks to
  the shapes measured on 2026-11-20. The refusal message says what the
  recorder looks for, which is where a session would start.
- **`git ls-remote` fails.** The guard refuses. Opening the pull
  request needs the same remote, so the refusal loses nothing
  (`merge-guard` makes the same argument for its API read).
- Testing: `npm run test:scripts` runs the new file, and its count goes
  in `expected-counts.json`. Each refusal test is watched failing with
  its guard removed, through `barwise/scripts/mutate.mjs`. The moved
  parser is covered by `merge-guard.test.mjs`, unchanged.

## Non-goals

- Judging the review. The guard holds that it was started on the right
  commit, and says so in those words.
- Guarding sessions that load no project hooks, the GitHub web
  interface, `curl`, or `gh` reached through `xargs`, `eval` or a
  variable (`merge-guard`'s known limits, inherited with its parser).
- Any change to when a pull request may merge.
