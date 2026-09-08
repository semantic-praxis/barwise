import { generateId } from "./id.js";
import { requireName } from "./name.js";

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
    this._name = requireName(name);
    this.id = id ?? generateId();
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = requireName(value);
  }
}
