#!/usr/bin/env bash
# check-beads.sh -- validate .beads/issues.jsonl against bd's schema & canonical format.
#
# Source it to get the `beads_check` function, or run it directly:
#   . scripts/check-beads.sh && beads_check
#   bash scripts/check-beads.sh [path-to-issues.jsonl]
#
# Severity mirrors bd's own philosophy (cmd/bd/doctor/validation.go): integrity
# problems are ERRORS (exit 1); enum / format / timestamp smells are WARNINGS
# (advisory, exit 0). The canonical-format check reproduces cmd/bd/export.go's
# json.Marshal output (compact separators, < > & HTML-escaped, UTF-8 kept, _type
# first, one object + trailing newline per line) -- so it catches the
# non-canonical hand-edits that get clobbered when a bd-equipped session
# re-exports across branches. Requires python3.

beads_check() {
  local f="${1:-$(git rev-parse --show-toplevel 2>/dev/null)/.beads/issues.jsonl}"
  [ -f "$f" ] || { echo "beads_check: no such file: $f" >&2; return 2; }
  command -v python3 >/dev/null 2>&1 || { echo "beads_check: python3 required" >&2; return 2; }
  python3 - "$f" <<'PY'
import json, re, sys

PATH = sys.argv[1]
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
        W.append(f"L{n}: not canonical compact form (id={obj.get('id')})")

for n, obj, _ in rows:
    src = obj.get("id")
    for d in obj.get("dependencies", []) or []:
        t = d.get("depends_on_id")
        if isinstance(t, str) and t != src and not t.startswith("external:") and t not in ids:
            E.append(f"L{n}: dangling depends_on_id {t!r} (no matching issue)")

print(f"beads_check: {len(rows)} issues, {len(E)} error(s), {len(W)} warning(s)")
for e in E[:50]:
    print("  ERROR", e)
for w in W[:30]:
    print("  WARN ", w)
if len(W) > 30:
    print(f"  ... +{len(W) - 30} more warnings")
sys.exit(1 if E else 0)
PY
}

# Run directly when executed (not when sourced).
(return 0 2>/dev/null) || beads_check "$@"
