import type { Definition } from "../../model/Definition.js";

export interface OrmYamlDefinition {
  term: string;
  definition: string;
  context?: string;
}

export function serializeDefinition(d: Definition): OrmYamlDefinition {
  const result: OrmYamlDefinition = {
    term: d.term,
    definition: d.definition,
  };
  if (d.context) {
    result.context = d.context;
  }
  return result;
}

export function deserializeDefinition(defDoc: OrmYamlDefinition): Definition {
  return {
    term: defDoc.term,
    definition: defDoc.definition,
    context: defDoc.context,
  };
}
