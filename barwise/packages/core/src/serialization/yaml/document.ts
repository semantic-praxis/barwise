import type { OrmYamlConstraint } from "./constraint.js";
import type { OrmYamlDefinition } from "./definition.js";
import type { OrmYamlDiagramLayout } from "./diagram.js";
import type { OrmYamlFactType } from "./factType.js";
import type { OrmYamlObjectifiedFactType, OrmYamlObjectifiedFactType40 } from "./objectified.js";
import type { OrmYamlObjectType } from "./objectType.js";
import type { OrmYamlPopulation } from "./population.js";
import type { OrmYamlSubtypeFact, OrmYamlSubtypeFact40 } from "./subtype.js";

/**
 * The shape of a parsed .orm.yaml document. This mirrors the JSON Schema
 * and is used as the intermediate representation between YAML text and
 * the in-memory OrmModel.
 */
export interface OrmYamlDocument {
  orm_version: string;
  model: {
    name: string;
    domain_context?: string;
    namespace?: string;
    note?: string;
    object_types?: OrmYamlObjectType[];
    fact_types?: OrmYamlFactType[];
    /** 3.0: the model's own constraints, across fact types or over subtypes. */
    constraints?: OrmYamlConstraint[];
    subtype_facts?: OrmYamlSubtypeFact[];
    objectified_fact_types?: OrmYamlObjectifiedFactType[];
    populations?: OrmYamlPopulation[];
    definitions?: OrmYamlDefinition[];
    diagrams?: OrmYamlDiagramLayout[];
  };
}

/** A 4.0 element the model may name: `minted_from` beside a minted id. */
type Minted40<T> = T & { minted_from?: string; };

/**
 * A format 4.0 document (iri-identity WS6): 3.0's shape, but a constraint,
 * subtype fact or objectification the model left unnamed has no id, and
 * one whose id was minted states the key it was minted from beside it.
 */
export interface OrmYamlDocument40 {
  orm_version: "4.0";
  model:
    & Omit<
      OrmYamlDocument["model"],
      "fact_types" | "constraints" | "subtype_facts" | "objectified_fact_types"
    >
    & {
      fact_types?: (Omit<OrmYamlFactType, "constraints"> & {
        constraints?: Minted40<OrmYamlConstraint>[];
      })[];
      constraints?: Minted40<OrmYamlConstraint>[];
      subtype_facts?: Minted40<OrmYamlSubtypeFact40>[];
      objectified_fact_types?: Minted40<OrmYamlObjectifiedFactType40>[];
    };
}
