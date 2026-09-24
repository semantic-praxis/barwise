/**
 * Kernel + skin -> a dbt project directory: dbt_project.yml, sources,
 * staging models with schema tests, SQL with the Jinja a real project
 * carries (custom macros the stub renderer will not know, incremental
 * blocks, dbt_utils calls), and a configurable number of models with
 * no identifiable key, which the importer drops.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { relationalView, tableName } from "../model.mjs";

export function generateDbt(doc, skin, dir, { factor = 1, artifactId = "dbt" } = {}) {
  const adapter = skin.adapter ?? "postgres";
  mkdirSync(join(dir, "models", "staging"), { recursive: true });
  mkdirSync(join(dir, "models", "marts"), { recursive: true });
  mkdirSync(join(dir, "macros"), { recursive: true });
  const tables = relationalView(doc);
  const manifest = {
    artifact: artifactId,
    generator: "dbt",
    adapter,
    factor,
    models: [],
    sources: [],
    keyless: [],
  };
  writeFileSync(
    join(dir, "dbt_project.yml"),
    stringify({
      name: "trial_warehouse",
      version: "1.0.0",
      "config-version": 2,
      profile: "trial",
      "model-paths": ["models"],
      "macro-paths": ["macros"],
      models: {
        trial_warehouse: {
          staging: { "+materialized": "view" },
          marts: { "+materialized": "table" },
        },
      },
    }),
  );
  writeFileSync(
    join(dir, "profiles.yml"),
    stringify({
      trial: {
        target: "dev",
        outputs: { dev: { type: adapter, schema: "analytics", threads: 4 } },
      },
    }),
  );
  writeFileSync(
    join(dir, "packages.yml"),
    stringify({ packages: [{ package: "dbt-labs/dbt_utils", version: "1.1.1" }] }),
  );
  writeFileSync(
    join(dir, "macros", "custom.sql"),
    `{% macro custom_scd2(relation) %}\n  select * from {{ relation }}\n{% endmacro %}\n{% macro custom_surrogate_key(cols) %}\n  md5({{ cols | join(" || '-' || ") }})\n{% endmacro %}\n`,
  );
  const sources = { version: 2, sources: [{ name: "raw", schema: "raw", tables: [] }] };
  const staging = { version: 2, models: [] };
  const marts = { version: 2, models: [] };
  let keyless = 0;
  for (let m = 0; m < factor; m++) {
    const sfx = m === 0 ? "" : `_${m + 1}`;
    for (const t of tables) {
      const raw = `raw_${tableName(t)}${sfx}`;
      const stg = `stg_${tableName(t)}${sfx}`;
      const columns = t.columns.map((c) => c.name);
      sources.sources[0].tables.push({ name: raw, columns: columns.map((c) => ({ name: c })) });
      manifest.sources.push(raw);
      const dropKey = keyless < (skin.models_without_keys ?? 0) && t.entity;
      const cols = t.columns.map((c) => {
        const tests = [];
        const isPk = t.pk.includes(c.name);
        if (isPk && !dropKey) tests.push("unique", "not_null");
        else if (!c.nullable) tests.push("not_null");
        if (c.check) tests.push({ accepted_values: { values: c.check.slice(0, 20).map(String) } });
        if (c.ref) {
          tests.push({
            relationships: {
              to: `ref('stg_${tableName(c.ref)}${sfx}')`,
              field: c.ref.pk[0] ?? "id",
            },
          });
        }
        const col = { name: c.name, description: c.factType?.name ?? "" };
        if (tests.length) col.tests = tests;
        return col;
      });
      if (dropKey) {
        keyless++;
        manifest.keyless.push(stg);
      }
      staging.models.push({
        name: stg,
        description: t.entity ? `Staging for ${t.entity}` : `Staging for ${t.factType.name}`,
        columns: cols,
      });
      manifest.models.push({
        name: stg,
        source: t.entity ?? t.factType.name,
        keyless: !!dropKey,
        module: m + 1,
      });
      const macros = (skin.jinja_macros ?? []).map((mac) =>
        mac.includes(".")
          ? `{{ ${mac}(['${columns[0]}']) }} as ${mac.split(".").pop()}_key,`
          : `{{ ${mac}(this) }}`
      ).join("\n    ");
      const sql = [
        `{{ config(materialized='incremental', unique_key='${t.pk[0] ?? columns[0]}') }}`,
        ``,
        `with src as (`,
        `    select`,
        `    ${macros}`,
        columns.map((c) => `        ${c}`).join(",\n"),
        `    from {{ source('raw', '${raw}') }}`,
        `    {% if is_incremental() %}`,
        `    where loaded_at > (select max(loaded_at) from {{ this }})`,
        `    {% endif %}`,
        `)`,
        ``,
        `select * from src`,
        skin.semi_structured
          ? `-- variant: parse_json(payload):attributes:color::string as color`
          : ``,
      ].join("\n");
      writeFileSync(join(dir, "models", "staging", `${stg}.sql`), sql + "\n");
      if (t.entity && m === 0) {
        const mart = `dim_${tableName(t)}`;
        marts.models.push({ name: mart, description: `Dimension for ${t.entity}` });
        writeFileSync(
          join(dir, "models", "marts", `${mart}.sql`),
          `select s.*, {{ var('run_date') }} as snapshot_date\nfrom {{ ref('${stg}') }} s\nleft join {{ ref('${
            manifest.models[0].name
          }') }} x on x.${columns[0]} = s.${columns[0]}\n`,
        );
      }
    }
  }
  writeFileSync(
    join(dir, "models", "staging", "sources.yml"),
    stringify(sources, { lineWidth: 0 }),
  );
  writeFileSync(join(dir, "models", "staging", "schema.yml"), stringify(staging, { lineWidth: 0 }));
  writeFileSync(join(dir, "models", "marts", "schema.yml"), stringify(marts, { lineWidth: 0 }));
  return { manifest };
}
