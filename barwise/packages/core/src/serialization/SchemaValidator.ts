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
  /**
   * The schema rule that failed, as ajv reports it. For a program that has
   * to tell one error from another; the message is for people, and its
   * wording is ajv's to change. Absent on a problem the Effect decoder
   * reported (an object type's or a constraint's): its rule is the decoder's,
   * not one of ajv's keywords, and inventing a keyword would let a program
   * match it as if it were.
   */
  readonly rule?: SchemaRule;
}

/** ajv's keyword, with the parameters a caller can act on. */
export interface SchemaRule {
  readonly keyword: string;
  /** For `required`: the property that is missing. */
  readonly missingProperty?: string;
  /** For `additionalProperties`: the property that is not allowed. */
  readonly additionalProperty?: string;
  /** For `if`: the branch that failed, `then` or `else`. */
  readonly failingKeyword?: string;
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

    const errors = (this.validate.errors ?? []).map((err) => schemaErrorOf(err, data));

    return { valid: false, errors };
  }
}

/**
 * One ajv error as a `SchemaError`: the one mapping, shared by the whole-
 * document check and the loader's re-check of a single constraint.
 *
 * @param data The whole document, so the message can name the element.
 * @param prefix Where in `data` the validated value sits, when ajv was given
 *   a part of it; prepended to ajv's `instancePath`.
 * @param subject What to call the element at `prefix`, when the caller words
 *   it better than the nearest name can (a constraint has no name of its
 *   own). The message then reads as the decoder's do: the subject, then the
 *   field below it that is at fault, in place of the `(in "name")` suffix.
 */
export function schemaErrorOf(
  err: ErrorObject,
  data: unknown,
  prefix = "",
  subject?: string,
): SchemaError {
  // A `false` property schema forbids a field outright (an entity type's
  // `data_type`); ajv's own wording, "boolean schema is false", describes
  // the schema rather than the document.
  const message = err.keyword === "false schema"
    ? "is not allowed here"
    : (err.message ?? "Unknown validation error");
  const path = prefix + err.instancePath;
  const name = nearestName(data, path);
  const params = err.params as {
    missingProperty?: string;
    additionalProperty?: string;
    failingKeyword?: string;
  };
  return {
    path: path || "/",
    message: subject !== undefined
      ? `${subject} ${predicateBelow(err, message)}`
      : name === undefined
      ? message
      : `${message} (in "${name}")`,
    rule: {
      keyword: err.keyword,
      ...(params.missingProperty !== undefined ? { missingProperty: params.missingProperty } : {}),
      ...(params.additionalProperty !== undefined
        ? { additionalProperty: params.additionalProperty }
        : {}),
      ...(params.failingKeyword !== undefined ? { failingKeyword: params.failingKeyword } : {}),
    },
  };
}

/**
 * An ajv error as the rest of a sentence about the value it validated,
 * naming the field below that value: `has an invalid role: must NOT have
 * fewer than 1 characters.`, `has an unknown field "ranges.0.foo".`. The
 * field is what a person must change; without it the sentence would make
 * the whole value the subject of a rule about one of its fields.
 */
function predicateBelow(err: ErrorObject, message: string): string {
  const field = err.instancePath.split("/").slice(1).map((s) =>
    s.replace(/~1/g, "/").replace(/~0/g, "~")
  );
  const at = (...more: string[]) => [...field, ...more].join(".");
  const params = err.params as { additionalProperty?: string; };
  if (params.additionalProperty !== undefined) {
    return `has an unknown field "${at(params.additionalProperty)}".`;
  }
  if (field.length === 0) return `${message}.`;
  if (err.keyword === "false schema") return `has a field "${at()}" that is not allowed here.`;
  return `has an invalid ${at()}: ${message}.`;
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
