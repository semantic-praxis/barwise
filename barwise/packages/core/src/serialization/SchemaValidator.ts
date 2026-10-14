import { Ajv, type ErrorObject } from "ajv";
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
 * Uses ajv internally. The schema is compiled once and reused across
 * validation calls.
 */
export class SchemaValidator {
  private readonly validate;

  constructor() {
    const ajv = new Ajv({ allErrors: true });
    this.validate = ajv.compile(ormModelSchema);
  }

  /**
   * Validate a parsed YAML document (plain object) against the
   * orm-model.schema.json schema.
   */
  validateModel(data: unknown): SchemaValidationResult {
    const valid = this.validate(data);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors: SchemaError[] = (this.validate.errors ?? []).map(
      (err: ErrorObject) => ({
        path: err.instancePath || "/",
        // A `false` property schema forbids a field outright (an entity
        // type's `data_type`); ajv's own wording, "boolean schema is false",
        // describes the schema rather than the document.
        message: err.keyword === "false schema"
          ? "is not allowed here"
          : (err.message ?? "Unknown validation error"),
      }),
    );

    return { valid: false, errors };
  }
}
