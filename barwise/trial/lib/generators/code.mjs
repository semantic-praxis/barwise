/**
 * Kernel + skin -> a source tree in TypeScript, Java or Kotlin, one
 * file per class, amplified across modules so the file count crosses
 * the importer's silent 500-file cap at the enterprise tier. Carries the
 * constructs a real code base has and the regex importer must either
 * map or name: inheritance (JPA joined / single table), sealed classes,
 * discriminated unions, generics, validation annotations, enums.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { byId, entities, factTypes, valueTypes } from "../model.mjs";

export function generateCode(doc, skin, dir, { factor = 1, artifactId = "code" } = {}) {
  const lang = skin.language ?? "typescript";
  const ids = byId(doc);
  const manifest = {
    artifact: artifactId,
    generator: "code",
    language: lang,
    factor,
    classes: [],
    enums: [],
    files: 0,
  };
  const supOf = new Map((doc.model.subtype_facts ?? []).map((s) => [s.subtype, s.supertype]));
  const ext = { typescript: "ts", java: "java", kotlin: "kt" }[lang];
  for (let m = 0; m < factor; m++) {
    const pkg = m === 0 ? "domain" : `domain${m + 1}`;
    const pkgDir = join(dir, "src", "main", lang === "typescript" ? "" : lang, "com", "trial", pkg);
    mkdirSync(pkgDir, { recursive: true });
    const sfx = m === 0 ? "" : `${m + 1}`;
    for (const vt of valueTypes(doc)) {
      if (!vt.value_constraint?.values) continue;
      const name = `${vt.name}${sfx}`;
      writeFileSync(
        join(pkgDir, `${name}.${ext}`),
        renderEnum(lang, pkg, name, vt.value_constraint.values),
      );
      manifest.enums.push(name);
      manifest.files++;
    }
    for (const e of entities(doc)) {
      const name = `${e.name}${sfx}`;
      const fields = [];
      for (const ft of factTypes(doc)) {
        const [r0, r1] = ft.roles;
        if (!r1 || r0.player !== e.id) continue;
        const other = ids.get(r1.player);
        if (!other) continue;
        const single = (ft.constraints ?? []).some((c) =>
          c.type === "internal_uniqueness" && c.roles.length === 1 && c.roles[0] === r0.id
        );
        const mand = (ft.constraints ?? []).some((c) => c.type === "mandatory" && c.role === r0.id);
        const type = other.kind === "value"
          ? (other.value_constraint?.values ? `${other.name}${sfx}` : scalar(lang, other))
          : `${other.name}${sfx}`;
        fields.push({
          name: camel(other.name),
          type,
          single,
          mand,
          isEntity: other.kind === "entity",
        });
      }
      const parent = supOf.get(e.id) ? `${ids.get(supOf.get(e.id)).name}${sfx}` : null;
      const isSealedRoot = [...supOf.values()].includes(e.id);
      writeFileSync(
        join(pkgDir, `${name}.${ext}`),
        renderClass(lang, pkg, name, fields, parent, isSealedRoot, skin, e.definition),
      );
      manifest.classes.push({ name, source: e.name, module: m + 1, parent });
      manifest.files++;
    }
    // The layers a real service has, which are not domain types.
    for (const layer of ["Service", "Controller", "Repository", "Dto"]) {
      const first = entities(doc)[0];
      const name = `${first.name}${layer}${sfx}`;
      writeFileSync(
        join(pkgDir, `${name}.${ext}`),
        renderLayer(lang, pkg, name, layer, `${first.name}${sfx}`),
      );
      manifest.files++;
    }
  }
  if (lang === "typescript") {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "trial-platform",
          version: "1.0.0",
          dependencies: { "@nestjs/core": "^10.0.0", zod: "^3.23.0" },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true } },
        null,
        2,
      ),
    );
  } else if (lang === "java") {
    writeFileSync(
      join(dir, "pom.xml"),
      `<project><modelVersion>4.0.0</modelVersion><groupId>com.trial</groupId><artifactId>mes</artifactId><version>1.0.0</version></project>\n`,
    );
  } else {
    writeFileSync(join(dir, "build.gradle.kts"), `plugins { kotlin("jvm") version "2.0.0" }\n`);
  }
  return { manifest };
}

function camel(name) {
  return name.charAt(0).toLowerCase() + name.slice(1).replace(/[^A-Za-z0-9]/g, "");
}

function scalar(lang, vt) {
  const n = vt.data_type?.name ?? "text";
  const t = {
    typescript: {
      text: "string",
      integer: "number",
      decimal: "number",
      boolean: "boolean",
      date: "Date",
      datetime: "Date",
    },
    java: {
      text: "String",
      integer: "Integer",
      decimal: "BigDecimal",
      boolean: "Boolean",
      date: "LocalDate",
      datetime: "Instant",
    },
    kotlin: {
      text: "String",
      integer: "Int",
      decimal: "BigDecimal",
      boolean: "Boolean",
      date: "LocalDate",
      datetime: "Instant",
    },
  };
  return t[lang][n] ?? t[lang].text;
}

function renderEnum(lang, pkg, name, values) {
  const members = values.map((v) =>
    String(v).replace(/[^A-Za-z0-9]+/g, "_").replace(/^(\d)/, "_$1").toUpperCase()
  );
  if (lang === "typescript") {
    return `export enum ${name} {\n${
      members.map((mbr, i) => `  ${mbr} = ${JSON.stringify(String(values[i]))},`).join("\n")
    }\n}\n`;
  }
  if (lang === "java") {
    return `package com.trial.${pkg};\n\npublic enum ${name} {\n  ${members.join(",\n  ")}\n}\n`;
  }
  return `package com.trial.${pkg}\n\nenum class ${name} {\n  ${members.join(",\n  ")}\n}\n`;
}

function renderClass(lang, pkg, name, fields, parent, sealedRoot, skin, doc) {
  const comment = doc ? `/** ${doc} */\n` : "";
  if (lang === "typescript") {
    const lines = fields.map((f) =>
      `  ${f.name}${f.mand ? "" : "?"}: ${f.single ? f.type : `${f.type}[]`};`
    );
    const union = skin.discriminated_unions && sealedRoot
      ? `\nexport type ${name}Kind = { kind: "${name}" } & ${name};\n`
      : "";
    const zod = skin.zod
      ? `\nexport const ${name}Schema = z.object({\n${
        fields.filter((f) => !f.isEntity).map((f) =>
          `  ${f.name}: z.${
            f.type === "number" ? "number()" : f.type === "boolean" ? "boolean()" : "string()"
          }${f.mand ? "" : ".optional()"},`
        ).join("\n")
      }\n});\n`
      : "";
    const generic = skin.generics
      ? `\nexport interface Page<T extends ${name}> { items: T[]; total: number; }\n`
      : "";
    return `import { z } from "zod";\n${
      parent ? `import { ${parent} } from "./${parent}";\n` : ""
    }\n${comment}export class ${name}${parent ? ` extends ${parent}` : ""} {\n${
      lines.join("\n")
    }\n}\n${union}${zod}${generic}`;
  }
  if (lang === "java") {
    const ann = skin.jpa
      ? `@Entity\n@Table(name = "${name.toLowerCase()}")\n${
        sealedRoot
          ? `@Inheritance(strategy = InheritanceType.${
            (skin.inheritance ?? "joined").toUpperCase()
          })\n`
          : ""
      }`
      : "";
    const lines = fields.map((f) =>
      `  ${f.mand ? "@NotNull\n  " : ""}${
        f.isEntity ? (f.single ? "@ManyToOne\n  " : "@OneToMany\n  ") : ""
      }private ${f.single ? f.type : `List<${f.type}>`} ${f.name};`
    );
    return `package com.trial.${pkg};\n\nimport jakarta.persistence.*;\nimport jakarta.validation.constraints.*;\nimport java.util.List;\n\n${comment}${ann}public class ${name}${
      parent ? ` extends ${parent}` : ""
    } {\n  @Id\n  private Long id;\n${lines.join("\n")}\n}\n`;
  }
  const kw = sealedRoot && skin.sealed
    ? "sealed class"
    : skin.data_classes && !sealedRoot
    ? "data class"
    : "open class";
  const params = fields.map((f) =>
    `  val ${f.name}: ${f.single ? f.type : `List<${f.type}>`}${f.mand ? "" : "? = null"}`
  );
  return `package com.trial.${pkg}\n\nimport java.math.BigDecimal\nimport java.time.*\n\n${comment}${kw} ${name}(\n${
    params.join(",\n")
  }\n)${parent ? ` : ${parent}()` : ""}\n`;
}

function renderLayer(lang, pkg, name, layer, entity) {
  if (lang === "typescript") {
    return `import { ${entity} } from "./${entity}";\nexport class ${name} {\n  find(id: string): ${entity} | undefined { return undefined; }\n}\n`;
  }
  if (lang === "java") {
    return `package com.trial.${pkg};\n\npublic class ${name} {\n  public ${entity} find(Long id) { return null; }\n}\n`;
  }
  return `package com.trial.${pkg}\n\nclass ${name} {\n  fun find(id: Long): ${entity}? = null\n}\n`;
}
