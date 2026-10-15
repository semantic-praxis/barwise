/**
 * Held-out cases derived from a JSON Schema object definition, so a case
 * list cannot fall behind the schema it must agree with.
 *
 * T2's task adds one rule -- code refuses what a file refuses -- and keeps
 * whatever code was given through a save and a load. Written as a hand list,
 * each review of PR #662 found another field or keyword the list had not
 * mirrored (storage, kind, isFormal, the flags, ids, a dropped derived rule).
 * The schema is the authority for both, so the cases are generated from it:
 * one refusal per constraint it places on a field, one preservation per value
 * a field can take that differs from its absence.
 *
 * What this cannot see is stated rather than guessed:
 * - `additionalProperties: false` is not turned into a case. The arms
 *   already differ on an unknown config key for `ObjectType` (the Effect arm
 *   refuses it, the plain arm accepts it), so a case would be a requirement
 *   neither was asked for.
 * - A field the code path may omit although a file requires it (an id the
 *   model makes) is named in `codeOptional`; omitting it is not a refusal.
 * - A field whose valid values come from elsewhere in the model (an
 *   endpoint id) takes its value from `base` and is not varied.
 * - A value the serializer writes as absent is named in `writtenAsAbsent`,
 *   so keeping it means "absent after a save and a load" -- the base drops
 *   `storage: derive_on_request` (serialization/yaml/derivation.ts).
 *
 * Any keyword outside the handled set throws: a schema that grows a
 * constraint this file does not turn into a case must fail loudly, not
 * produce fewer cases. So does a handled keyword with a value no case is made
 * for -- a leaf type other than string or boolean, or a `minLength` above 1,
 * which the generated samples ("", "kept id") would not respect.
 */

const PROPERTY_KEYWORDS = new Set(["type", "enum", "minLength", "default", "description", "$ref"]);
const OBJECT_KEYWORDS = new Set(["type", "required", "additionalProperties", "properties"]);
const LEAF_TYPES = new Set(["string", "boolean"]);

function resolve(schema, node) {
  if (!node.$ref) return node;
  const name = node.$ref.replace(/^#\/(definitions|\$defs)\//, "");
  const target = (schema.definitions ?? schema.$defs ?? {})[name];
  if (!target) throw new Error(`schema-cases: unresolved $ref ${node.$ref}`);
  return target;
}

function checkKeywords(node, allowed, where) {
  for (const k of Object.keys(node)) {
    if (!allowed.has(k)) {
      throw new Error(`schema-cases: ${where} uses "${k}", which no case covers`);
    }
  }
}

/**
 * Walk an object definition alongside its key map, checking the two agree.
 * `keys` maps each YAML key to its config key, or to `[configKey, nestedKeys]`
 * for a nested object.
 */
function fields(schema, def, keys, where) {
  checkKeywords(def, OBJECT_KEYWORDS, where);
  const props = Object.keys(def.properties ?? {}).sort();
  const mapped = Object.keys(keys).sort();
  if (props.join() !== mapped.join()) {
    throw new Error(
      `schema-cases: ${where} has properties [${props}] but the key map names [${mapped}]`,
    );
  }
  const required = new Set(def.required ?? []);
  return props.map((yamlKey) => {
    const node = def.properties[yamlKey];
    checkKeywords(node, PROPERTY_KEYWORDS, `${where}.${yamlKey}`);
    // A keyword's name is not enough: its value has to be one a case is made
    // for, or the field yields no cases or a sample a correct run fails
    // (Copilot, PR #662).
    if (!node.$ref && !LEAF_TYPES.has(node.type)) {
      throw new Error(
        `schema-cases: ${where}.${yamlKey} has type ${node.type}, which no case covers`,
      );
    }
    if (node.minLength !== undefined && !(node.minLength === 0 || node.minLength === 1)) {
      throw new Error(
        `schema-cases: ${where}.${yamlKey} has minLength ${node.minLength}, which no sample respects`,
      );
    }
    const [configKey, nestedKeys] = Array.isArray(keys[yamlKey])
      ? keys[yamlKey]
      : [keys[yamlKey]];
    return {
      yamlKey,
      configKey,
      path: `${where}.${yamlKey}`,
      node: resolve(schema, node),
      isRef: Boolean(node.$ref),
      required: required.has(yamlKey),
      nestedKeys,
    };
  });
}

/**
 * Inputs a file would refuse, each as a code config: one per constraint the
 * schema places on a field. `base` is a valid config per level, keyed by
 * definition path (the top level is `root`).
 */
export function refusals(schema, defName, keys, { base, codeOptional = [], root = defName }) {
  const out = [];
  const walk = (def, keyMap, where, wrap, levelBase) => {
    for (const f of fields(schema, def, keyMap, where)) {
      const put = (value, why) =>
        out.push({ path: f.path, why, config: wrap({ ...levelBase, [f.configKey]: value }) });
      // Before the $ref branch: a required nested object is a constraint
      // too, and skipping it would let the schema grow one without a case
      // (Copilot, PR #662).
      if (f.required && !codeOptional.includes(f.path)) {
        const { [f.configKey]: _omitted, ...rest } = levelBase;
        out.push({ path: f.path, why: "is missing", config: wrap(rest) });
      }
      if (f.isRef) {
        put("nope", "is not an object");
        const nestedBase = base[f.path];
        if (!nestedBase) throw new Error(`schema-cases: no base value for ${f.path}`);
        walk(
          f.node,
          f.nestedKeys,
          f.path,
          (inner) => wrap({ ...levelBase, [f.configKey]: inner }),
          nestedBase,
        );
        continue;
      }
      if (f.node.type === "string") put(42, "is not a string");
      if (f.node.type === "boolean") put("nope", "is not a boolean");
      if (f.node.enum) put("nope", "is outside its enum");
      if (f.node.minLength >= 1) put("", "is empty");
    }
  };
  walk(schema.definitions[defName], keys, root, (c) => c, base[root]);
  return out;
}

/**
 * Configs that set one field to a value its absence does not stand for, each
 * to be kept on the record and through a save and a load. A field whose valid
 * values come from the model (no enum, no type the generator can invent, and
 * named in `fromBase`) keeps the base value every config carries.
 */
export function preservations(
  schema,
  defName,
  keys,
  { base, fromBase = [], root = defName },
) {
  const out = [{ path: root, value: "(the base config)", config: base[root] }];
  const walk = (def, keyMap, where, wrap, levelBase) => {
    for (const f of fields(schema, def, keyMap, where)) {
      const put = (value) =>
        out.push({ path: f.path, value, config: wrap({ ...levelBase, [f.configKey]: value }) });
      if (f.isRef) {
        const nestedBase = base[f.path];
        put(nestedBase);
        walk(
          f.node,
          f.nestedKeys,
          f.path,
          (inner) => wrap({ ...levelBase, [f.configKey]: inner }),
          nestedBase,
        );
        continue;
      }
      if (fromBase.includes(f.path)) continue;
      if (f.node.enum) { for (const v of f.node.enum) put(v); }
      else if (f.node.type === "boolean") {
        // With no default, neither value is what absence stands for, so both
        // are kept (Copilot, PR #662).
        if (f.node.default === undefined) {
          put(true);
          put(false);
        } else put(!f.node.default);
      } else if (f.node.type === "string") {
        put(`kept ${f.yamlKey}`);
        // The empty string, where the schema allows it, is a value too: code
        // must take it as a file does (Copilot, PR #662).
        if (!(f.node.minLength >= 1)) put("");
      }
    }
  };
  walk(schema.definitions[defName], keys, root, (c) => c, base[root]);
  return out;
}

/**
 * Whether `actual` keeps every field of `given`, recursing into nested
 * objects. A path named in `writtenAsAbsent` with that value may be absent.
 */
export function keeps(actual, given, writtenAsAbsent = {}, where = "") {
  if (actual === undefined || actual === null) return false;
  return Object.entries(given).every(([k, v]) => {
    const path = where ? `${where}.${k}` : k;
    if (v !== null && typeof v === "object") return keeps(actual[k], v, writtenAsAbsent, path);
    if (actual[k] === v) return true;
    return actual[k] === undefined && writtenAsAbsent[path] === v;
  });
}
