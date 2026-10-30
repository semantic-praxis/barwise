/**
 * The error a reader of an `.orm.yaml` file throws, and the one conversion
 * both readers share: a file that states two elements of one kind under one
 * id. Its own module so the 3.0 reader (`OrmYamlSerializer`) and the 2.0
 * reader (`reader20.ts`) each import it without importing the other.
 */
import { DuplicateIdError } from "../model/OrmModel.js";
import type { SchemaValidationResult } from "./SchemaValidator.js";

/**
 * Error thrown when deserialization fails due to schema validation
 * or model construction errors.
 */
export class DeserializationError extends Error {
  constructor(
    message: string,
    readonly validationResult?: SchemaValidationResult,
  ) {
    super(message);
    this.name = "DeserializationError";
  }
}

/**
 * Run a reader, reporting a file that states two elements of one kind
 * under one id as a `DeserializationError`. The model refuses the second
 * (`DuplicateIdError`), lenient or not, since it has nowhere to hold it,
 * and a reader reports a file it cannot load as a `DeserializationError`,
 * which is what every caller catches. Both entry points go through here:
 * `migrate` (so `deserialize`) and the exported 2.0 reader.
 */
export function refusingHeldIds<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    if (err instanceof DuplicateIdError) throw new DeserializationError(err.message);
    throw err;
  }
}
