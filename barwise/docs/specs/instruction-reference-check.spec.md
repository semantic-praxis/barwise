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

A survey of the 34 instruction files on main 29db88a7 settles this.
Requiring every reference to be rooted (`barwise/...`) would have meant
rewriting about 240 references written as basenames (`ci.yml`) or
package-relative paths (`cli/src/commands/`). Instead, four resolution
rules, prototyped over the whole corpus, check 365 path references and
leave 9 unresolved:

- 2 are real defects: `cli/workspace/io.ts` and
  `mcp/workspace/resolve.ts` in `pr-review/checklist.md`. Both omit
  `src/`, so a reader looking for them finds nothing at the path given.
- 2 are a file-type name (`.orm-project.yaml`) that the prototype's
  file-type filter missed because of the hyphen. The filter is fixed in
  the implementation.
- 5 are legitimate mentions of files that are not tracked: a template
  placeholder (`path/thing.ts`), a user's `.vscode/settings.json` (cited
  twice), the optimizer's runtime `report.json`, and dbt's `target/`.
  These go on the allowlist.

The 59 `npm run` references all resolve today, and 7 of the 8
`node <path>` commands resolve from the repo root. The eighth,
`node esbuild.mjs`, sits in a package `CLAUDE.md` and resolves from that
file's own directory, which is where that file says to run it. The gate
therefore starts green after one two-line fix and a five-row allowlist,
so it ratchets from a known zero rather than a backlog.

## Scope

In scope:

- When an instruction file (`CLAUDE.md` or `AGENTS.md` at any depth, or
  any `.md` under `.claude/`) contains a backticked token that the rules
  below classify as a path, and the token resolves under none of them,
  the gate shall exit 1 and name the file, line and token.
- When an instruction file contains `node <path>` (in a code span or a
  fenced block), and the path resolves neither from the repo root nor
  from the instruction file's own directory, the gate shall exit 1.
- When an instruction file contains `npm run <script>`, and no
  `package.json` in the workspace defines `<script>`, the gate shall
  exit 1.
- When an instruction file names a CI check or job ("status check is
  `x`", "the `x` check", "job `x`"), and no workflow under
  `.github/workflows/` defines a job with that id or `name:`, the gate
  shall exit 1.
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
- **Specs and dated docs** under `barwise/docs/`. Specs are historical
  records that cite what existed when they were written
  (`check-book-citations.mjs` excludes the archive for the same reason).

## Resolution rules

A backticked token is a path candidate if it has no whitespace or glob
or placeholder characters (`* < > { } $ |`), is not a URL, a scoped
package (`@x/y`) or a slash command (`/code-review`), and either starts
with `barwise/`, `.claude/`, `.github/` or `.beads/` (rooted), starts
with `./` or `../` (relative), or contains `/` and ends in a known file
extension or `/`, or is a bare filename with a known extension. A bare
file-type name (`.orm.yaml`, `.orm-project.yaml`) is not a candidate. A
`:N` or `:N-M` line suffix is stripped first.

| Candidate kind | Resolves when                                                             |
| -------------- | ------------------------------------------------------------------------- |
| Rooted         | a tracked file or directory has exactly that path                         |
| Relative       | it resolves from the instruction file's own directory                     |
| Unrooted       | some tracked file or directory path equals it or ends with `/` + it       |
| Any of these   | also when `git check-ignore` reports it ignored (a declared build output) |

A relative token with no file extension (`./theme`, `../../`) is a
module specifier or a direction, not a file reference, and is skipped.
An unrooted token with `/` and no extension (`react-dom/server`,
`structural/dangling-role-reference`) is an import specifier or a rule
id and is not a candidate.

## Inventory

| Path                                         | Current state                            | Verdict                                               |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `barwise/scripts/check-instruction-refs.mjs` | does not exist                           | new gate (WS1, extended in WS2)                       |
| `barwise/scripts/lib/tracked.mjs`            | owns the cwd-proof tracked-file listing  | reused unchanged                                      |
| `barwise/package.json`                       | no `check:instruction-refs` script       | adds it (WS1)                                         |
| `.github/workflows/ci.yml`                   | no step for it                           | adds a step with no `if:`, beside `check:beads` (WS1) |
| `barwise/scripts/tests/gates.test.mjs`       | holds the other gates' red and cwd tests | adds this gate's (WS1, WS2)                           |
| `.claude/skills/pr-review/checklist.md`      | two paths missing `src/`                 | fixed (WS1)                                           |
| `barwise/scripts/ci-local.mjs`               | derives its gate list from `ci.yml`      | untouched; picks the new step up by construction      |

`ci-local.mjs` needs no change because it parses `ci.yml`'s steps. A
step with no `if:` runs for every change class, so a docs-only push runs
it locally as CI does.

## Target architecture

```
check-instruction-refs.mjs
  files    = trackedFiles() filtered to CLAUDE.md | AGENTS.md | .claude/**/*.md
  index    = tracked files + their parent directories (one Set)
  for each file, each line:
    path tokens    -> rules above            (WS1)
    node commands  -> root or file's own dir (WS1)
    npm run x      -> any workspace package.json scripts   (WS2)
    check/job x    -> job ids and names in .github/workflows/*.yml (WS2)
  minus ALLOWLIST [{file, token, why}]; a stale row is a finding
  exit 0 clean | 1 findings (file:line: token -- rule) | 2 cannot see input
```

The workflow parse in WS2 reads job ids at the `jobs:` indent and their
`name:` lines with the same line-based approach `lib/ci-gates.mjs` uses,
not a YAML dependency, because the check runs on the docs-only path.

## Alternatives considered

- **Require rooted paths everywhere.** Simplest resolver and no
  false passes, but about 240 references would be rewritten, and the
  shorter forms are how people write. A gate that forces a style
  nobody uses is a gate people learn to fight.
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

Adds the gate with the path and `node <path>` rules, the allowlist
(five rows, each with its reason), the npm script, the `ci.yml` step,
and the checklist fix. Tests: red on a planted dead rooted path, a
planted dead unrooted path, a planted dead `node` path, and a stale
allowlist row; exit 2 when the git listing is empty; the same answer
from three cwds. First because it carries almost all the findings and
the whole resolver.

### 2. npm scripts and CI check names (provisional: not yet grounded)

Adds the `npm run` and check-name rules to the same gate. Tests: red on
a planted `npm run no-such-script` and on a planted "the required
status check is `ci (22)`", which is the audit's own finding replayed.
Separate because the workflow parse is new code with its own failure
modes. The check-name phrase list is the part to re-ground: the survey
found one citation (`steward/SKILL.md`, "status check is `ci`"), so the
phrases may need adjusting against what the files actually say when
this lands.

## Open decisions (for review)

- **Unrooted references resolve by suffix.** That lets `ci.yml` pass
  because some tracked path ends in `/ci.yml`, even if the text meant a
  file that has since moved and a same-named file exists elsewhere. The
  alternative is to require rooted paths, which is the rewrite above.
  Recommend suffix: it catches deletion and renaming of the basename,
  which is how most of the audit's findings arose, and it starts green.
- **Gitignored paths pass.** A `dist/...` path is legitimately
  untracked, and `.gitignore` already declares it as build output.
  Recommend accepting them, rather than allowlisting each one, so the
  allowlist stays a list of exceptions with reasons.
- **The step runs on docs-only changes.** Instruction files are
  Markdown, so a gate that skipped the docs-only path would skip exactly
  the changes it exists for. Recommend no `if:`, as `check:beads` has.
- **Scope of files.** The issue names `CLAUDE.md`, `AGENTS.md` and
  `.claude/**/*.md`, which includes agents and skill support files such
  as `pr-review/checklist.md`. Recommend exactly that set. Adding
  `README.md` or `docs/` later is a one-line filter change.

## Risks and testing

- A false positive blocks every PR, docs-only ones included. The guard
  is measuring before landing: WS1 runs the gate over main in its own PR
  and must exit 0 there after the fix and the allowlist.
- A false pass is the quieter risk. The planted-red tests prove each
  rule can fail. `npm run mutate` against the resolver (for example,
  making the rooted rule accept any suffix) should be caught by those
  tests before WS1 lands.
- The gate reads only tracked files and `git check-ignore`. The fault
  matrix (`npm run fault-matrix`) should show it refusing, not passing,
  under "git answers emptily" and "git absent".

## Non-goals

- No rewrite of reference style across the instruction files.
- No checking of prose claims, layout trees or symbols (see Out of
  scope).
- No change to `ci-local.mjs`, `lib/tracked.mjs` or any existing gate.
