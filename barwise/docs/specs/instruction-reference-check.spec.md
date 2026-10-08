# A gate that resolves the paths, scripts and check names instruction files cite

Status: Draft -- no workstream implemented

Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-52b

## Principle

An instruction file is code that runs in an agent's head, and the
references it makes are must-agree copies of facts the repository owns:
a path names a file, `npm run x` names a script, "the required status
check is `ci`" names a job in `ci.yml`. The convention for a must-agree
copy is that it gets a check in the same commit (root `CLAUDE.md`,
`docs/specs/duplication-drift-guards.spec.md`). These copies have none.
The 2026-10-04 prompt audit (`barwise/docs/prompt-audit-2026-10-04.md`)
found 26 stale facts by hand, among them a removed check name
(`ci (22)`), a removed symbol, and `node scripts/beads-crud.mjs` at five
sites where it does not resolve from the directory the text says to run
it from. A sweep run by hand runs once. This spec turns the mechanical
part of that sweep into a gate.

## Can a reference be resolved without a declaration at every site? (resolved: yes, by four rules and a short allowlist)

A prototype of the rules below, run over the 34 instruction files on
main 2d80d6c0, settles this. Every figure in this section is its output;
the script is in the PR #616 description, and it is replaced by the
gate in WS1.

Of 329 path candidates, 50 are rooted (`barwise/...`). Requiring every
reference to be rooted would mean rewriting the other 279, which are
written as basenames (`ci.yml`) or package-relative paths
(`cli/src/commands/`). Under the four rules instead:

- **12 do not resolve.**
  - 2 are real defects: `cli/workspace/io.ts` and
    `mcp/workspace/resolve.ts` in `pr-review/checklist.md`. Both omit
    `src/`, so a reader looking for them finds nothing at the path given.
  - 10 are legitimate mentions of files that are not tracked, in 9
    distinct (file, token) pairs: a template placeholder
    (`path/thing.ts`), a user's `.vscode/settings.json` (in two files),
    the optimizer's runtime `report.json`, and six build outputs under
    `dist/` named by the vscode and optimizer `CLAUDE.md` files. These
    become allowlist rows, each with its reason.
- **4 are ambiguous**: an unrooted token that more than one tracked path
  ends with, and that is not in the citing file's own directory. All
  four are in the pr-review skill (`verbalize.ts`, `merge.ts` and
  `structural.ts` each exist twice; `tests/helpers/` four times). WS1
  qualifies each one or allowlists it.

All 59 `npm run` references resolve, and all 8 `node <path>` commands
resolve: 7 from the repo root, and `node esbuild.mjs` from its package
`CLAUDE.md`'s own directory, which is where that file says to run it.
The gate therefore starts green after fixing two paths, qualifying or
allowlisting four tokens, and nine allowlist rows. It ratchets from a
known zero rather than a backlog.

## Scope

In scope:

- When an instruction file (`CLAUDE.md` or `AGENTS.md` at any depth, or
  any `.md` under `.claude/`) contains a backticked token that the rules
  below classify as a path, and the token resolves under none of them,
  the gate shall exit 1 and name the file, line and token.
- When an unrooted path token matches more than one tracked path, and
  none of them is in the citing file's own directory, the gate shall
  exit 1 as ambiguous and list the candidates.
- When an instruction file contains `node <path>` (in a code span or a
  fenced block), and the path resolves neither from the repo root nor
  from the instruction file's own directory, the gate shall exit 1.
- When an instruction file contains `npm run <script>`, and no
  `package.json` in the workspace defines `<script>`, the gate shall
  exit 1.
- When an instruction file names a CI check or job ("status check is
  `x`", "the `x` check", "job `x`"), and no job in
  `.github/workflows/ci.yml` has that id or `name:`, the gate shall
  exit 1. Only `ci.yml` is the authority: it is the workflow whose jobs
  report the pull-request checks, so a job in `release.yml` cannot
  satisfy a citation of a required check.
- When an allowlist entry matches no finding, the gate shall exit 1, so
  a fixed site forces its row out (the `check-book-citations.mjs`
  pattern).
- When the gate cannot list its input (git answers nothing, or the
  instruction-file set comes back empty), it shall exit 2 and print no
  PASS (`docs/specs/gate-refusal-contract.spec.md`).
- When the gate runs from the repo root, from `barwise/`, or from a
  package directory, it shall give the same answer (`lib/tracked.mjs`).

Out of scope:

- **Prose claims about when a step runs** (path filters, docs-only
  skips, "CI does not run it"). These are not resolvable by name. Before
  barwise-52b closes, they are filed as their own issue and named in its
  notes, as its acceptance criteria require.
- **Layout trees in fenced blocks that omit directories.** The audit
  found these too. A check would compare a tree to the filesystem in the
  other direction (what exists but is not listed), which is a different
  instrument with a different false-positive profile. It is a follow-up,
  not part of this gate.
- **Symbols** (`registerBuiltinFormats`). Resolving an identifier means
  parsing source, and an identifier in prose is often a word, not a
  reference. Not attempted.
- **Specs and other docs under `barwise/docs/`.** barwise-52b names
  instruction files, and this spec keeps to that set. Living specs are
  revised as their workstreams land, so they would be reasonable to add
  later as a filter change; archived specs and dated point-in-time
  documents would stay excluded, because they record what existed when
  they were written (`check-book-citations.mjs` excludes the archive for
  that reason).

## Resolution rules

A backticked token is a path candidate if it has no whitespace or glob
or placeholder characters (`* < > { } $ |`), is not a URL, a scoped
package (`@x/y`) or a slash command (`/code-review`), and either starts
with `barwise/`, `.claude/`, `.github/` or `.beads/` (rooted), starts
with `./` or `../` (relative), or contains `/` and ends in a known file
extension or `/`, or is a bare filename with a known extension. A `:N`
or `:N-M` line suffix is stripped first. Three kinds of token are not
candidates:

- a bare file-type name (`.orm.yaml`, `.orm-project.yaml`);
- a bare directory name (`tests/`, `src/`), which names a kind of
  directory rather than a location;
- an unrooted token with `/` and no extension (`react-dom/server`,
  `structural/dangling-role-reference`), which is an import specifier or
  a rule id.

| Candidate kind | Resolves when                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rooted         | a tracked file or directory has exactly that path                                                                  |
| Relative       | it resolves from the instruction file's own directory                                                              |
| Unrooted       | it resolves from the instruction file's own directory, or exactly one tracked path equals it or ends with `/` + it |

A relative token with no file extension (`./theme`, `../../`) is a
module specifier or a direction, not a file reference, and is skipped.

Untracked files never resolve, ignored or not. `git check-ignore` proves
only that git suppresses a path, not that it exists or is meant: this
repository ignores whole classes (`dist`, `node_modules`, `.env`), so a
typo like `dist/no-such.js` would pass. A legitimately untracked file
(build output, a user's local file, a runtime artifact) is an allowlist
row with its reason, which the stale-row rule keeps exact.

## Inventory

| Path                                         | Current state                                   | Verdict                                               |
| -------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `barwise/scripts/check-instruction-refs.mjs` | does not exist                                  | new gate (WS1, extended in WS2)                       |
| `barwise/scripts/lib/tracked.mjs`            | owns the cwd-proof tracked-file listing         | reused unchanged                                      |
| `barwise/package.json`                       | no `check:instruction-refs` script              | adds it (WS1)                                         |
| `.github/workflows/ci.yml`                   | no step for it                                  | adds a step with no `if:`, beside `check:beads` (WS1) |
| `barwise/scripts/tests/gates.test.mjs`       | holds the other gates' red and cwd tests        | adds this gate's (WS1, WS2)                           |
| `.claude/skills/pr-review/checklist.md`      | two paths missing `src/`; three ambiguous names | fixed or qualified (WS1)                              |
| `.claude/skills/pr-review/SKILL.md`          | one ambiguous name (`verbalize.ts`)             | qualified (WS1)                                       |
| `barwise/scripts/ci-local.mjs`               | derives its gate list from `ci.yml`             | untouched; picks the new step up by construction      |

`ci-local.mjs` needs no change because it parses `ci.yml`'s steps. A
step with no `if:` runs for every change class, so a docs-only push runs
it locally as CI does.

## Target architecture

```
check-instruction-refs.mjs
  files    = trackedFiles() filtered to CLAUDE.md | AGENTS.md | .claude/**/*.md
  index    = tracked files + their parent directories (one Set)
  for each file, each line:
    path tokens    -> rules above; dead or ambiguous      (WS1)
    node commands  -> root or file's own dir              (WS1)
    npm run x      -> any workspace package.json scripts  (WS2)
    check/job x    -> job ids and names in ci.yml only    (WS2)
  minus ALLOWLIST [{file, token, why}]; a stale row is a finding
  exit 0 clean | 1 findings (file:line: token -- rule) | 2 cannot see input
```

The `ci.yml` parse in WS2 reads job ids at the `jobs:` indent and their
`name:` lines with the same line-based approach `lib/ci-gates.mjs` uses,
not a YAML dependency, because the check runs on the docs-only path.

## Alternatives considered

- **Require rooted paths everywhere.** Simplest resolver and no false
  passes, but 279 references would be rewritten, and the shorter forms
  are how people write. A gate that forces a style nobody uses is a gate
  people learn to fight.
- **Accept any suffix match.** The first draft of this spec. It lets
  `merge.ts` pass because some file ends with it, even when the text
  meant a file that moved and another file of that name remains. Unique
  matching costs four sites today and closes that hole.
- **Accept gitignored paths as build outputs.** Also the first draft. It
  saves nine allowlist rows and makes any typo under an ignored
  directory pass. Rejected for that reason (see Resolution rules).
- **Declare references explicitly** (a marker, or a manifest of cited
  paths). Explicit over implicit argues for it, but every reference is
  already a declaration: the backticks are the marker. A second
  declaration would be a copy of the first that could itself drift.
- **Fold this into `audit:duplication`.** That audit classifies copies
  by judgment against a baseline; this check is mechanical and has a
  single right answer per token. Combining them would put a pass/fail
  question behind a judgment ratchet.

## Workstreams (each independently shippable)

### 1. Paths and node commands

Adds the gate with the path and `node <path>` rules, the allowlist (nine
rows plus any of the four ambiguous sites left unqualified, each with
its reason), the npm script, the `ci.yml` step, and the pr-review fixes.

Each resolution branch is seen both passing and failing, because the
corpus alone does not exercise all of them: its one relative file
reference (`../compile-runner.sh`, in `barwise/optimizer/CLAUDE.md`)
resolves, so the corpus never shows that branch failing. Tests, in a
sandbox repo:

- rooted: a live path passes; a planted dead one fails;
- relative: a live `./x.md` beside the instruction file passes; a
  planted dead `../no-such.md` fails;
- unrooted: a unique basename passes; a dead one fails; one matching two
  tracked files fails as ambiguous and lists both; the same token
  resolves when one candidate is in the citing file's own directory;
- `node <path>`: a live and a planted dead command, from root and from
  the file's own directory;
- a stale allowlist row fails; an untracked path that git ignores still
  fails when not allowlisted;
- exit 2 when the git listing is empty; the same answer from three cwds.

First because it carries almost all the findings and the whole resolver.

### 2. npm scripts and CI check names (provisional: not yet grounded)

Adds the `npm run` and check-name rules to the same gate. Tests:

- `npm run`: a live script passes; a planted `npm run no-such-script`
  fails;
- check names, against a sandbox `ci.yml`: a citation of a job id
  passes; a citation that matches only a job's `name:` passes, and fails
  once that `name:` is removed, so the display-name path is exercised on
  its own; a planted "the required status check is `ci (22)`" fails,
  which is the audit's own finding replayed; a citation of a job that
  exists only in another workflow fails.

Separate because the workflow parse is new code with its own failure
modes. The check-name phrase list is the part to re-ground: the survey
found one citation (`steward/SKILL.md`, "status check is `ci`"), so the
phrases may need adjusting against what the files actually say when
this lands.

## Open decisions (for review)

- **Unrooted references resolve only when unique.** A token resolves
  from the citing file's own directory first, then only if exactly one
  tracked path ends with it; zero matches are dead and several are
  ambiguous. The alternatives are any-suffix matching (no false
  failures, one known false pass) or rooted-only (279 rewrites).
  Recommend unique: it costs four sites today and is the only option
  that catches a reference to a file that moved while a namesake stayed.
- **Untracked files go on the allowlist.** Build outputs under `dist/`
  and other untracked files are nine exact rows with reasons. The
  alternative is a separate registry of generated outputs, which is a
  second list to keep in step. Recommend the allowlist, because its
  stale-row rule already keeps it exact.
- **The step runs on docs-only changes.** Instruction files are
  Markdown, so a gate that skipped the docs-only path would skip exactly
  the changes it exists for. Recommend no `if:`, as `check:beads` has.
- **Scope of files.** The issue names `CLAUDE.md`, `AGENTS.md` and
  `.claude/**/*.md`, which includes agents and skill support files such
  as `pr-review/checklist.md`. Recommend exactly that set for now; living
  specs are a candidate for a later filter change (see Out of scope).

## Risks and testing

- A false positive blocks every PR, docs-only ones included. The guard
  is measuring before landing: WS1 runs the gate over main in its own PR
  and must exit 0 there after the fixes and the allowlist.
- A false pass is the quieter risk. The paired passing and failing
  tests for each branch prove each rule can fail. `npm run mutate`
  against the resolver (for example, making the unrooted rule accept
  more than one match, or the rooted rule accept any suffix) should be
  caught by those tests before WS1 lands.
- The gate reads only tracked files. The fault matrix
  (`npm run fault-matrix`) should show it refusing, not passing, under
  "git answers emptily" and "git absent".

## Non-goals

- No rewrite of reference style across the instruction files beyond the
  six sites WS1 fixes or qualifies.
- No checking of prose claims, layout trees or symbols (see Out of
  scope).
- No change to `ci-local.mjs`, `lib/tracked.mjs` or any existing gate.
