import { generateId } from "./id.js";

/**
 * Base class for all ORM model elements.
 *
 * Every element has a stable UUID assigned at creation and a human-readable
 * name. The id is the primary identity used for references between elements;
 * names can change without breaking references.
 */
export class ModelElement {
  readonly id: string;
  private _name: string;

  constructor(name: string, id?: string) {
    if (!name || name.trim().length === 0) {
      throw new Error("Model element name must be a non-empty string.");
    }
    this.id = id ?? generateId();
    this._name = name.trim();
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error("Model element name must be a non-empty string.");
    }
    this._name = value.trim();
  }
}
