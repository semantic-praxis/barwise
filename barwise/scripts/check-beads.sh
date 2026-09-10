#!/usr/bin/env bash
# check-beads.sh -- validate .beads/issues.jsonl against bd's schema & canonical format.
#
# Source it to get the `beads_check` function, or run it directly:
#   . scripts/check-beads.sh && beads_check
#   bash scripts/check-beads.sh [path-to-issues.jsonl]
#   bash scripts/check-beads.sh --strict   # canonical-format mismatch -> ERROR
#                                           # (BEADS_STRICT=1 also works; pre-commit uses it)
#
# Severity mirrors bd's own philosophy (cmd/bd/doctor/validation.go): integrity
# problems are ERRORS (exit 1); enum / format / timestamp smells are WARNINGS
# (advisory, exit 0). The canonical-format check reproduces cmd/bd/export.go's
# json.Marshal output (compact separators, < > & HTML-escaped, UTF-8 kept, _type
# first, one object + trailing newline per line) -- so it catches the
# non-canonical hand-edits that get clobbered when a bd-equipped session
# re-exports across branches. Requires uv (never a bare python3: every
# Python execution resolves from the lockfile -- see the repo CLAUDE.md).

beads_check() {
  local strict="${BEADS_STRICT:-0}" f=""
  local a
  for a in "$@"; do
    case "${a}" in
      --strict) strict=1 ;;
      *) f="${a}" ;;
    esac
  done
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)"
  f="${f:-${root}/.beads/issues.jsonl}"
  [[ -f "${f}" ]] || { echo "beads_check: no such file: ${f}" >&2; return 2; }
  command -v uv >/dev/null 2>&1 || { echo "beads_check: uv required" >&2; return 2; }

  # Two baselines for the id-identity rules below, written to temp files so
  # the Python half reads paths rather than shelling out itself. An empty
  # path means "could not be read", which the report says out loud rather
  # than passing over -- a rule that quietly did not run is the shape
  # docs/specs/gate-refusal-contract.spec.md exists to remove.
  #
  # origin/main for id REUSE: an id minted on both sides is a collision
  # even when main minted it after this branch diverged.
  # The merge base for DELETION: an id main has and this branch does not is
  # the normal state of any branch behind main, so only ids the branch
  # itself dropped are worth a word.
  local base_main="" base_fork="" ref=""
  local tmp; tmp="$(mktemp -d)"
  for ref in origin/main origin/HEAD main; do
    if git -C "${root}" rev-parse --verify --quiet "${ref}" >/dev/null 2>&1; then
      if git -C "${root}" show "${ref}:.beads/issues.jsonl" > "${tmp}/main.jsonl" 2>/dev/null; then
        base_main="${tmp}/main.jsonl"
        local mb
        if mb="$(git -C "${root}" merge-base HEAD "${ref}" 2>/dev/null)" \
          && git -C "${root}" show "${mb}:.beads/issues.jsonl" > "${tmp}/fork.jsonl" 2>/dev/null; then
          base_fork="${tmp}/fork.jsonl"
        fi
      fi
      break
    fi
  done

  BEADS_STRICT="${strict}" uv run --project "${root}/barwise" --frozen \
    --only-group scripts python - "${f}" "${base_main}" "${base_fork}" <<'PY'
import json, os, re, sys

PATH = sys.argv[1]
BASE_MAIN = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
BASE_FORK = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
STRICT = os.environ.get("BEADS_STRICT") == "1"  # canonical-format mismatch -> error
REQUIRED = ["_type", "id", "title", "status", "priority", "issue_type", "owner",
            "created_at", "created_by", "updated_at",
            "dependency_count", "dependent_count", "comment_count"]
STATUS = {"open", "in_progress", "blocked", "closed", "deferred", "hooked", "pinned"}
ITYPE = {"feature", "bug", "task", "epic", "chore"}
DEPTYPE = {"blocks", "blocked-by", "related", "parent-child", "discovered-from",
           "conditional-blocks", "waits-for"}
DEADLOCK = {"blocks", "conditional-blocks", "waits-for"}
ID_RE = re.compile(r"^[a-z0-9]+-[0-9a-z.]+$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
CONFLICT = re.compile(r"^(<{7}|={7}|>{7})")
# An issue whose own notes say its PR shipped, still not closed. Three
# issues (barwise-r4f, -vli, -5dd) sat like that for eleven weeks: the
# steward rule closes issues in a tracker-only commit AFTER the code PR
# merges, and that follow-up is a step nothing checked. Narrow on purpose:
# "Implemented (PR pending)" is a legitimate in_progress note, and
# "Implemented <date>" turned out to be both (barwise-897 done,
# barwise-5t9.7 with its importer half still open), so only the explicit
# shipped-PR claim is flagged.
SHIPPED_RE = re.compile(r"\b(?:Shipped|Landed|Merged) in PR #\d+")


def go_compact(obj):
    # Reproduce cmd/bd/export.go: json.Marshal (compact, UTF-8 kept, < > & escaped).
    s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return s.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")


E, W = [], []
ids, rows = set(), []
for n, raw in enumerate(open(PATH, encoding="utf-8"), 1):
    line = raw.rstrip("\n")
    if not line.strip():
        continue
    if CONFLICT.match(line):
        E.append(f"L{n}: git merge-conflict marker in JSONL ({line[:7]})")
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError as e:
        E.append(f"L{n}: invalid JSON: {e}")
        continue
    if not isinstance(obj, dict):
        E.append(f"L{n}: not a JSON object")
        continue
    rows.append((n, obj, line))

    if obj.get("_type") != "issue":
        E.append(f'L{n}: _type must be "issue", got {obj.get("_type")!r}')
    for k in REQUIRED:
        if k not in obj:
            E.append(f"L{n}: missing required field '{k}'")
    i = obj.get("id")
    if not isinstance(i, str):
        E.append(f"L{n}: id must be a string")
    else:
        if i in ids:
            E.append(f"L{n}: duplicate id {i!r}")
        ids.add(i)
        if not ID_RE.match(i):
            W.append(f"L{n}: id {i!r} fails {ID_RE.pattern}")
    for d in obj.get("dependencies", []) or []:
        if not isinstance(d, dict):
            E.append(f"L{n}: dependency not an object")
            continue
        for k in ("issue_id", "depends_on_id", "type"):
            if k not in d:
                E.append(f"L{n}: dependency missing '{k}'")
        t, dep = d.get("type"), d.get("depends_on_id")
        if t not in DEPTYPE:
            W.append(f"L{n}: dependency type {t!r} not in {sorted(DEPTYPE)}")
        if isinstance(i, str) and isinstance(dep, str) and t in DEADLOCK and i.startswith(dep + "."):
            W.append(f"L{n}: child {i} {t} parent {dep} -- deadlock smell")

    if obj.get("status") not in STATUS:
        W.append(f"L{n}: status {obj.get('status')!r} not in {sorted(STATUS)}")
    if obj.get("issue_type") not in ITYPE:
        W.append(f"L{n}: issue_type {obj.get('issue_type')!r} not in {sorted(ITYPE)}")
    p = obj.get("priority")
    if not isinstance(p, int) or isinstance(p, bool) or not (0 <= p <= 4):
        W.append(f"L{n}: priority {p!r} not int 0..4")
    for k in ("created_at", "updated_at"):
        v = obj.get(k)
        if isinstance(v, str) and not ISO_RE.match(v):
            W.append(f"L{n}: {k} {v!r} not ISO-8601")
    if line != go_compact(obj):
        (E if STRICT else W).append(f"L{n}: not canonical compact form (id={obj.get('id')})")
    if obj.get("status") != "closed":
        m = SHIPPED_RE.search(obj.get("notes") or "")
        if m:
            (E if STRICT else W).append(
                f"L{n}: status {obj.get('status')!r} but notes say {m.group(0)!r} "
                f"(id={obj.get('id')}) -- close it, or reword the note"
            )

for n, obj, _ in rows:
    src = obj.get("id")
    for d in obj.get("dependencies", []) or []:
        t = d.get("depends_on_id")
        if isinstance(t, str) and t != src and not t.startswith("external:") and t not in ids:
            E.append(f"L{n}: dangling depends_on_id {t!r} (no matching issue)")

# -- an id names one issue, and created_at is what says which ---------------
#
# barwise-984, five occurrences across three sessions. The allocator reads
# the highest id in the LOCAL .beads/issues.jsonl, which is stale by
# construction on any branch behind main, so two branches mint the same id
# for unrelated issues. The duplicate-id rule above catches the merged file
# while it still has both rows -- and the resolution is where the damage
# happens: union by id with the later updated_at winning treats a collision
# as an edit, keeps one row, and deletes an issue. That resolution produces
# a file every other rule here accepts, because both sides ARE valid.
#
# `created_at` is the discriminator because it is the one field that cannot
# legitimately change. A title can be edited; a creation event cannot be
# re-run. So an id that origin/main created at T1 and this branch created at
# T2 is not an edit, it is two issues wearing one id -- and one of them is
# already gone.


def index(path):
    by_id = {}
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                o = json.loads(raw)
            except json.JSONDecodeError:
                continue  # a baseline we cannot parse is not this run's finding
            if isinstance(o, dict) and isinstance(o.get("id"), str):
                by_id[o["id"]] = o
    return by_id


here = {o["id"]: o for _, o, _ in rows if isinstance(o.get("id"), str)}

if BASE_MAIN is None:
    W.append(
        "id-identity check DID NOT RUN: no readable .beads/issues.jsonl on "
        "origin/main, origin/HEAD or main. Collisions across branches are "
        "unchecked in this run."
    )
else:
    main_ids = index(BASE_MAIN)
    reused = [
        i for i, o in here.items()
        if i in main_ids and o.get("created_at") != main_ids[i].get("created_at")
    ]
    for i in sorted(reused):
        E.append(
            f"id {i!r} names a DIFFERENT issue on main -- created_at "
            f"{main_ids[i].get('created_at')} there, {here[i].get('created_at')} here.\n"
            f"          main:  {main_ids[i].get('title')}\n"
            f"          here:  {here[i].get('title')}\n"
            f"          Two issues minted the same id (barwise-984). Re-file one under a "
            f"fresh id; do NOT resolve by keeping the later updated_at, which deletes the "
            f"other issue."
        )
    if BASE_FORK is not None:
        fork_ids = index(BASE_FORK)
        dropped = sorted(i for i in fork_ids if i not in here)
        for i in dropped:
            W.append(
                f"id {i!r} was in the tracker at the merge base and is gone here "
                f"({fork_ids[i].get('title')!r}). Deliberate deletion, or a collision "
                f"resolved by union-by-id?"
            )

print(f"beads_check: {len(rows)} issues, {len(E)} error(s), {len(W)} warning(s)")
for e in E[:50]:
    print("  ERROR", e)
for w in W[:30]:
    print("  WARN ", w)
if len(W) > 30:
    print(f"  ... +{len(W) - 30} more warnings")
sys.exit(1 if E else 0)
PY
  local rc=$?
  rm -rf "${tmp}"
  return ${rc}
}

# Run directly when executed (not when sourced).
(return 0 2>/dev/null) || beads_check "$@"
