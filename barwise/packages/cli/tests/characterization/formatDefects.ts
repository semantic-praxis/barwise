/**
 * Is a recorded export actually an instance of the format its filename
 * claims?
 *
 * The golden test compares bytes. Three goldens were invalid for as
 * long as they existed and it never said so (barwise-961): a DDL file
 * declaring one column twice, an Avro record with two fields of one
 * name, and an OpenAPI schema with two properties on one JSON key. The
 * third did not even fail -- the second property silently replaced the
 * first, so a column vanished and the file stayed well formed.
 *
 * That last one is why `JSON.parse` is not the check. It accepts
 * duplicate keys and keeps the last, which is the exact mechanism that
 * lost the column; the OpenAPI and Avro export suites in
 * `@barwise/formats` already parse their output at ten sites and were
 * green throughout. A duplicate-key check has to walk the raw text,
 * before the parse discards the evidence.
 *
 * These check what has actually broken, not full conformance to three
 * specifications. Spec: docs/specs/export-artifact-validation.spec.md.
 */

/** A legal Avro name: the rule Avro states for records and fields. */
const AVRO_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Body lines that open a table constraint rather than declare a column. */
const DDL_CONSTRAINT_KEYWORDS = new Set(["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"]);

/**
 * Keys repeated within one JSON object, in source order.
 *
 * A hand-rolled scan rather than a parse: escapes are kept verbatim
 * rather than resolved, which keeps the mapping from source text to key
 * injective, so two keys that differ in the source can never be
 * reported as the same one.
 */
export function duplicateJsonKeys(text: string): readonly string[] {
  const duplicates: string[] = [];
  // One entry per open brace or bracket; `undefined` marks an array,
  // whose contents are values and never keys.
  const scopes: Array<Set<string> | undefined> = [];
  let pending: string | undefined;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      let literal = "";
      while (j < text.length) {
        const c = text[j];
        if (c === "\\") {
          literal += c + (text[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (c === '"') break;
        literal += c;
        j += 1;
      }
      pending = literal;
      i = j + 1;
      continue;
    }
    if (ch === ":") {
      const scope = scopes[scopes.length - 1];
      if (scope !== undefined && pending !== undefined) {
        if (scope.has(pending)) duplicates.push(pending);
        scope.add(pending);
      }
      pending = undefined;
    } else if (ch === "{") {
      scopes.push(new Set());
    } else if (ch === "[") {
      scopes.push(undefined);
    } else if (ch === "}" || ch === "]") {
      scopes.pop();
    }
    i += 1;
  }
  return duplicates;
}

function jsonDefects(label: string, text: string): string[] {
  const defects: string[] = [];
  try {
    JSON.parse(text);
  } catch (err) {
    defects.push(`${label} does not parse as JSON: ${(err as Error).message}`);
    return defects;
  }
  for (const key of duplicateJsonKeys(text)) {
    defects.push(`${label} repeats the key "${key}" within one object`);
  }
  return defects;
}

function openApiDefects(text: string): string[] {
  return jsonDefects("the OpenAPI document", text);
}

/**
 * The Avro export is several `.avsc` documents in one file, each headed
 * by a `# Name.avsc` comment and separated by a `---` rule, so it is
 * split before anything is parsed.
 */
function avroDefects(text: string): string[] {
  const defects: string[] = [];
  const blocks = text.split(/^---$/m);
  for (const block of blocks) {
    const json = block.replace(/^\s*#[^\n]*\n/, "").trim();
    if (json === "") continue;

    const label = `the Avro schema`;
    const parseErrors = jsonDefects(label, json);
    if (parseErrors.length > 0) {
      defects.push(...parseErrors);
      continue;
    }
    const record: unknown = JSON.parse(json);
    if (typeof record !== "object" || record === null) {
      defects.push(`${label} is not a record object`);
      continue;
    }
    const { name, fields } = record as { name?: unknown; fields?: unknown; };
    if (typeof name !== "string" || !AVRO_NAME.test(name)) {
      defects.push(`${label} has an illegal record name ${JSON.stringify(name)}`);
    }
    if (!Array.isArray(fields)) {
      defects.push(`${label} ${String(name)} has no fields array`);
      continue;
    }
    const seen = new Set<string>();
    for (const field of fields) {
      const fieldName = (field as { name?: unknown; }).name;
      if (typeof fieldName !== "string" || !AVRO_NAME.test(fieldName)) {
        defects.push(`${String(name)} has an illegal field name ${JSON.stringify(fieldName)}`);
        continue;
      }
      if (seen.has(fieldName)) {
        defects.push(`${String(name)} declares the field "${fieldName}" twice`);
      }
      seen.add(fieldName);
    }
  }
  return defects;
}

/**
 * A structural read of the rendered DDL rather than a parse.
 *
 * The real parser this project owns is `parseSqlWithSqlglot` in
 * `@barwise/formats`, which is package-internal and spawns Python;
 * exporting it to reach it from here would widen a package's public API
 * for a test's convenience. It is used on rendered DDL where it already
 * lives (`DdlExportFormat.test.ts`), and this checks the shape that
 * actually broke: a table declaring one column twice, and a statement
 * that never terminates.
 */
function ddlDefects(text: string): string[] {
  const defects: string[] = [];
  const statements = [...text.matchAll(/^CREATE TABLE (\S+) \(\n([\s\S]*?)\n\);$/gm)];
  const opened = [...text.matchAll(/^CREATE TABLE /gm)].length;
  if (statements.length !== opened) {
    defects.push(
      `${opened} CREATE TABLE statement(s) but ${statements.length} terminate with ");"`,
    );
  }

  for (const [, table, body] of statements) {
    const seen = new Set<string>();
    for (const line of (body ?? "").split("\n")) {
      const m = /^\s{2}(\S+)\s+\S/.exec(line);
      if (!m) continue;
      const first = m[1] ?? "";
      if (first.startsWith("--") || DDL_CONSTRAINT_KEYWORDS.has(first)) continue;
      if (seen.has(first)) {
        defects.push(`table ${String(table)} declares the column "${first}" twice`);
      }
      seen.add(first);
    }
  }
  return defects;
}

/** The exports whose goldens carry a format this file can check. */
export const CHECKED_FORMATS = ["ddl", "openapi", "avro"] as const;
export type CheckedFormat = (typeof CHECKED_FORMATS)[number];

/**
 * Every way `text` fails to be an instance of `format`, or an empty
 * list. Defects rather than a throw, so one failure names every problem
 * in the document instead of the first.
 */
export function formatDefects(format: CheckedFormat, text: string): readonly string[] {
  switch (format) {
    case "ddl":
      return ddlDefects(text);
    case "openapi":
      return openApiDefects(text);
    case "avro":
      return avroDefects(text);
  }
}

/**
 * The format a golden's filename claims, or `undefined` for the prose
 * goldens (verbalize, validate) that have none.
 */
export function claimedFormat(goldenName: string): CheckedFormat | undefined {
  return CHECKED_FORMATS.find((f) => goldenName.endsWith(`.${f}.txt`));
}
