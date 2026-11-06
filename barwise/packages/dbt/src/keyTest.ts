/**
 * The dbt_utils test that keys a model on several columns. The renderer
 * writes it and the importer reads it back as a composite key, so both
 * import this constant rather than spell it; it sits in neither side's
 * module so that the import path does not depend on the renderer.
 */
export const DBT_KEY_TEST = "dbt_utils.unique_combination_of_columns";
