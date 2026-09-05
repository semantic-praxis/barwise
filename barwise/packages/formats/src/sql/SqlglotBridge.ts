/**
 * The sqlglot sidecar: high-fidelity structural SQL parsing
 * (code-analysis spec; replaces the earlier Calcite sidecar design).
 *
 * Runs a short-lived `uv run` subprocess with an embedded program
 * that parses SQL through sqlglot's multi-dialect AST and emits the
 * same pattern shapes the regex tier produces, tagged
 * `parseLevel: "sqlglot"`. The sidecar is optional: availability is
 * probed once per process, and callers fall back to the pure regex
 * cascade in core when Python or sqlglot is absent -- the degradation
 * the original sidecar design promised. The subprocess lives here in
 * @barwise/formats (which owns its I/O, like the dbt connector);
 * core stays pure.
 */
import type { CascadeFileResult, SqlDialect, SqlPatternContext } from "@barwise/core/sql";
import { execFileSync } from "node:child_process";

/** barwise dialect names -> sqlglot reader names ("" = default ANSI). */
const DIALECT_MAP: Record<SqlDialect, string> = {
  ansi: "",
  snowflake: "snowflake",
  bigquery: "bigquery",
  postgres: "postgres",
  mysql: "mysql",
  redshift: "redshift",
  databricks: "databricks",
};

/**
 * The embedded sidecar program. Reads SQL from stdin, writes one JSON
 * document to stdout: { statements: [{ sql, startLine, endLine,
 * patterns: [{kind, tables, columns, sourceText}], errors }] }.
 * Only business-rule-relevant constructs are mined -- the same kinds
 * the regex tier knows -- so the TypeScript side maps results 1:1.
 */
const SIDECAR_PROGRAM = `
import json, sys
import sqlglot
from sqlglot import expressions as exp

dialect = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
text = sys.stdin.read()

def names(nodes):
    seen = []
    for n in nodes:
        name = n.name if hasattr(n, "name") else str(n)
        if name and name not in seen:
            seen.append(name)
    return seen

def pattern(kind, node, tables=None, columns=None):
    return {
        "kind": kind,
        "sourceText": node.sql(dialect=dialect) if dialect else node.sql(),
        "tables": tables or [],
        "columns": columns or [],
    }

def mine(tree):
    out = []
    for j in tree.find_all(exp.Join):
        on = j.args.get("on")
        cols = names(on.find_all(exp.Column)) if on else []
        out.append(pattern("join", j, names(j.find_all(exp.Table)), cols))
    for w in tree.find_all(exp.Where):
        out.append(pattern("where", w, columns=names(w.find_all(exp.Column))))
    for c in tree.find_all(exp.Case):
        out.append(pattern("case", c, columns=names(c.find_all(exp.Column))))
    for g in tree.find_all(exp.Group):
        out.append(pattern("group_by", g, columns=names(g.find_all(exp.Column))))
    for chk in tree.find_all(exp.CheckColumnConstraint):
        out.append(pattern("check", chk, columns=names(chk.find_all(exp.Column))))
    for u in tree.find_all(exp.UniqueColumnConstraint):
        out.append(pattern("unique", u, columns=names(u.find_all(exp.Column))))
    for nn in tree.find_all(exp.NotNullColumnConstraint):
        parent = nn.parent
        col = parent.parent.name if parent is not None and parent.parent is not None else ""
        out.append(pattern("not_null", nn, columns=[col] if col else []))
    for fk in tree.find_all(exp.ForeignKey):
        out.append(pattern(
            "foreign_key", fk,
            names(fk.find_all(exp.Table)),
            names(fk.find_all(exp.Column)),
        ))
    for d in tree.find_all(exp.DefaultColumnConstraint):
        out.append(pattern("default", d))
    return out

statements = []
cursor = 0
try:
    trees = sqlglot.parse(text, read=dialect)
except Exception as err:
    print(json.dumps({"error": str(err)}))
    sys.exit(0)

for tree in trees:
    if tree is None:
        continue
    sql = tree.sql(dialect=dialect) if dialect else tree.sql()
    raw = text[cursor:]
    # Approximate the statement's line range from the source cursor.
    start_line = text[:cursor].count("\\n") + 1
    consumed = raw.find(";")
    cursor += consumed + 1 if consumed >= 0 else len(raw)
    end_line = text[:cursor].count("\\n") + 1
    try:
        patterns = mine(tree)
        statements.append({
            "sql": sql,
            "startLine": start_line,
            "endLine": end_line,
            "patterns": patterns,
            "errors": [],
        })
    except Exception as err:
        statements.append({
            "sql": sql,
            "startLine": start_line,
            "endLine": end_line,
            "patterns": [],
            "errors": [str(err)],
        })

print(json.dumps({"statements": statements}))
`;

/**
 * The embedded normalizer program. Reads a JSON array of SQL snippets
 * from stdin and writes a JSON array of the same length: each snippet
 * re-rendered through sqlglot's generator (canonical whitespace and
 * casing), or unchanged when it does not parse (e.g. clause fragments).
 */
const NORMALIZE_PROGRAM = `
import json, sys
import sqlglot

dialect = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
texts = json.load(sys.stdin)
out = []
for t in texts:
    try:
        exprs = sqlglot.parse(t, read=dialect)
        rendered = "; ".join(
            e.sql(dialect=dialect) if dialect else e.sql()
            for e in exprs if e is not None
        )
        out.append(rendered if rendered else t)
    except Exception:
        out.append(t)
print(json.dumps(out))
`;

/**
 * The interpreter invocation, as argv. Never a bare `python3`: that runs
 * whatever the machine happens to carry, and this bridge has no version
 * check, so an ambient sqlglot would silently shape `parseLevel:
 * "sqlglot"` output (docs/specs/python-lockfile-execution.spec.md).
 *
 * Naming the group is load-bearing beyond installing less. It asserts
 * that the discovered project is OURS: inside an unrelated Python
 * project uv exits with "Group `sqlglot` is not defined in the
 * project's `dependency-groups` table", so the bridge reports
 * unavailable rather than borrowing a stranger's sqlglot. With no
 * project at all, uv runs an interpreter that has no sqlglot and the
 * import fails. All three paths end at the regex cascade, which is the
 * degradation this sidecar always promised.
 */
const UV_PYTHON = [
  "run",
  "--frozen",
  "--only-group",
  "sqlglot",
  "python",
] as const;

let availability: boolean | undefined;

/** Probe once per process whether uv can resolve our sqlglot group. */
export function sqlglotAvailable(): boolean {
  if (availability !== undefined) return availability;
  try {
    execFileSync("uv", [...UV_PYTHON, "-c", "import sqlglot"], {
      stdio: "ignore",
      timeout: 10_000,
    });
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
}

interface SidecarStatement {
  sql: string;
  startLine: number;
  endLine: number;
  patterns: Array<{
    kind: SqlPatternContext["kind"];
    sourceText: string;
    tables: string[];
    columns: string[];
  }>;
  errors: string[];
}

/**
 * Parse a SQL file through the sqlglot sidecar. Returns undefined when
 * the sidecar is unavailable or the file fails to parse -- the caller
 * falls back to the regex cascade.
 */
export function parseSqlWithSqlglot(
  sql: string,
  filePath: string,
  dialect: SqlDialect = "ansi",
): CascadeFileResult | undefined {
  if (!sqlglotAvailable()) return undefined;

  let stdout: string;
  try {
    stdout = execFileSync(
      "uv",
      [...UV_PYTHON, "-c", SIDECAR_PROGRAM, DIALECT_MAP[dialect]],
      { input: sql, encoding: "utf-8", timeout: 30_000 },
    );
  } catch {
    return undefined;
  }

  let parsed: { statements?: SidecarStatement[]; error?: string; };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return undefined;
  }
  if (!parsed.statements) return undefined;

  const statements = parsed.statements.map((st) => ({
    sql: st.sql,
    parseLevel: "sqlglot" as const,
    patterns: st.patterns.map((p): SqlPatternContext => ({
      kind: p.kind,
      filePath,
      startLine: st.startLine,
      endLine: st.endLine,
      sourceText: p.sourceText,
      tables: p.tables,
      columns: p.columns,
      parseLevel: "sqlglot" as const,
    })),
    errors: st.errors,
  }));

  return {
    filePath,
    statements,
    patterns: statements.flatMap((s) => s.patterns),
    dialect,
  };
}

/**
 * Canonically format SQL snippets through sqlglot's generator so that
 * re-analysis diffs do not churn on whitespace or casing. Returns
 * undefined when the sidecar is unavailable or the call fails -- the
 * caller keeps the raw text. Snippets that do not parse individually
 * (clause fragments) come back unchanged.
 */
export function normalizeSqlTexts(
  texts: readonly string[],
  dialect: SqlDialect = "ansi",
): string[] | undefined {
  if (texts.length === 0) return [];
  if (!sqlglotAvailable()) return undefined;

  let stdout: string;
  try {
    stdout = execFileSync(
      "uv",
      [...UV_PYTHON, "-c", NORMALIZE_PROGRAM, DIALECT_MAP[dialect]],
      { input: JSON.stringify(texts), encoding: "utf-8", timeout: 30_000 },
    );
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== texts.length) return undefined;

  return parsed.map((v, i) => typeof v === "string" && v.length > 0 ? v : texts[i]!);
}

/**
 * Normalize the `sourceText` of every pattern in a cascade result (the
 * regex tier emits raw source slices). No-op when the sidecar is
 * unavailable: the result degrades to raw text.
 */
export function normalizeCascadeResult(result: CascadeFileResult): CascadeFileResult {
  const normalized = normalizeSqlTexts(
    result.statements.flatMap((s) => s.patterns.map((p) => p.sourceText)),
    result.dialect,
  );
  if (!normalized) return result;

  let cursor = 0;
  const statements = result.statements.map((st) => {
    const patterns = st.patterns.map((p) => ({
      ...p,
      sourceText: normalized[cursor++]!,
    }));
    return { ...st, patterns };
  });

  return {
    ...result,
    statements,
    patterns: statements.flatMap((s) => s.patterns),
  };
}
