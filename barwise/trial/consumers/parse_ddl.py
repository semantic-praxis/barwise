"""Parse a DDL file with sqlglot in a named dialect and report what did not parse.

The sprint-4 consumer for DDL exports: an export the customer's own
database would reject is a finding, and sqlglot is the closest offline
stand-in for eight databases. Run only through the lockfile:

    uv run --frozen --only-group sqlglot python trial/consumers/parse_ddl.py <file> <dialect>

Prints one JSON object: statements, parsed, failures[{index, error, head}].
"""
import json
import sys

import sqlglot
from sqlglot.errors import ParseError

DIALECTS = {"ansi": None, "sqlserver": "tsql", "databricks": "databricks"}


def main() -> int:
    path, dialect = sys.argv[1], sys.argv[2]
    read = DIALECTS.get(dialect, dialect)
    text = open(path, encoding="utf-8-sig").read()
    statements = [s for s in split_statements(text) if s.strip()]
    failures = []
    parsed = 0
    for i, stmt in enumerate(statements):
        try:
            sqlglot.parse_one(stmt, read=read)
            parsed += 1
        except ParseError as e:  # noqa: PERF203
            failures.append({"index": i, "error": str(e).splitlines()[0][:300], "head": stmt.strip()[:160]})
        except Exception as e:  # sqlglot raises other things on exotic syntax
            failures.append({"index": i, "error": f"{type(e).__name__}: {str(e)[:300]}", "head": stmt.strip()[:160]})
    print(json.dumps({"statements": len(statements), "parsed": parsed, "failures": failures[:50]}))
    return 0


def split_statements(text: str):
    """Split on semicolons outside quotes; comment lines are dropped first."""
    lines = [l for l in text.splitlines() if not l.strip().startswith("--")]
    body = "\n".join(lines)
    out, buf, quote = [], [], None
    for ch in body:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
        if ch == ";":
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out


if __name__ == "__main__":
    sys.exit(main())
