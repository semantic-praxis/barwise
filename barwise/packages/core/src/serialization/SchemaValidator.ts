import { Ajv, type ErrorObject } from "ajv";
import legacyOrmModelSchema from "../../schemas/orm-model-2.0.schema.json" with { type: "json" };
import ormModelSchema from "../../schemas/orm-model.schema.json" with { type: "json" };

/**
 * Result of validating a parsed YAML document against the JSON Schema.
 */
export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly SchemaError[];
}

/**
 * A single schema validation error with a human-readable message.
 */
export interface SchemaError {
  readonly path: string;
  readonly message: string;
}

/**
 * Validates parsed .orm.yaml documents against the JSON Schema.
 *
 * Uses ajv internally. Each schema is compiled on first use and reused:
 * the loader reads 3.0 through the Effect decoders, so only the 2.0 reader
 * and the decoders' agreement tests validate here.
 */
export class SchemaValidator {
  private readonly ajv = new Ajv({ allErrors: true });
  private current?: ReturnType<Ajv["compile"]>;
  private legacy?: ReturnType<Ajv["compile"]>;

  /**
   * Validate a 2.0 document against the 2.0 schema, before the 2.0 reader
   * reads it into the model.
   */
  validateLegacyModel(data: unknown): SchemaValidationResult {
    this.legacy ??= this.ajv.compile(legacyOrmModelSchema);
    return this.report(this.legacy, data);
  }

  /**
   * Validate a parsed YAML document (plain object) against the
   * orm-model.schema.json schema.
   */
  validateModel(data: unknown): SchemaValidationResult {
    this.current ??= this.ajv.compile(ormModelSchema);
    return this.report(this.current, data);
  }

  private report(validate: ReturnType<Ajv["compile"]>, data: unknown): SchemaValidationResult {
    const valid = validate(data);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors: SchemaError[] = (validate.errors ?? []).map(
      (err: ErrorObject) => {
        // A `false` property schema forbids a field outright (an entity
        // type's `data_type`); ajv's own wording, "boolean schema is false",
        // describes the schema rather than the document.
        const message = err.keyword === "false schema"
          ? "is not allowed here"
          : (err.message ?? "Unknown validation error");
        const name = nearestName(data, err.instancePath);
        return {
          path: err.instancePath || "/",
          message: name === undefined ? message : `${message} (in "${name}")`,
        };
      },
    );

    return { valid: false, errors };
  }
}

/**
 * The name of the nearest named element -- an entry of one of the model's
 * arrays -- at or above a JSON Pointer.
 *
 * A path such as `/model/object_types/3/data_type` locates a problem for a
 * program; a person has to count to the fourth object type to act on it.
 * The element's own `name` is what they wrote and can search for, so every
 * error under a named element carries it (barwise-5fg, where a refused
 * `data_type` otherwise named only a position). The model itself is not an
 * array entry, so its name, which every path is under, is never used.
 */
function nearestName(data: unknown, pointer: string): string | undefined {
  const segments = pointer.split("/").slice(1).map((s) =>
    s.replace(/~1/g, "/").replace(/~0/g, "~")
  );
  // Only array entries are elements: `object_types[3]` is an object type,
  // while `data_type` is a field whose own `name` is a type name, and
  // "(in "integer")" would point the reader at the wrong thing.
  const elements: unknown[] = [];
  let node: unknown = data;
  for (const segment of segments) {
    if (node === null || typeof node !== "object") break;
    const parentIsArray = Array.isArray(node);
    node = (node as Record<string, unknown>)[segment];
    if (parentIsArray) elements.push(node);
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const candidate = elements[i];
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
      const name = (candidate as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim() !== "") return name;
    }
  }
  return undefined;
}
