import { CURRENT_ORM_VERSION } from "@barwise/core";

/**
 * The document "New Barwise Model" writes into an empty file.
 *
 * Kept apart from the command so it can be tested without the `vscode`
 * module: the one thing worth pinning here is that the scaffold claims
 * the version the serializer writes today rather than a literal that
 * lagged a bump (barwise-5t9.14).
 */
export const PROJECT_SCAFFOLD = `orm_version: "${CURRENT_ORM_VERSION}"
model:
  name: "New Domain Model"
  domain_context: "my_domain"
  object_types: []
  fact_types: []
  definitions: []
`;
