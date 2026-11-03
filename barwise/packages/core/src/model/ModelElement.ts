import { localName, requireName } from "./name.js";

/**
 * Base class for all ORM model elements.
 *
 * Every element has an id and a human-readable name. The id is the
 * identity references use; in format 4.0 it is the name's local name when
 * none is given (iri-identity decision 13), and a rename changes both.
 */
export class ModelElement {
  readonly id: string;
  private _name: string;

  constructor(name: string, id?: string) {
    this._name = requireName(name);
    // Outside a model, the id its name gives (decision 13); a model names
    // what it is given itself, before this runs.
    this.id = id ?? localName(this._name);
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = requireName(value);
  }
}
