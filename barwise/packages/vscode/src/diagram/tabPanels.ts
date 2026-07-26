/**
 * Tab-panel content for the diagram webview (modernization Phase 3).
 *
 * The Verbalization / Fact Population / YAML / DDL tabs are thin views
 * over existing `@barwise/core` capabilities -- no new logic. The host
 * computes their content here (the webview never holds the model) and
 * ships it alongside the graph. Pure module: no `vscode` import, so it
 * is unit-testable outside the extension host.
 */
import { getExporter, type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { Verbalizer } from "@barwise/core/verbalization";
import { registerStandardFormats } from "@barwise/formats";

// The DDL exporter registers through the FormatDescriptor registry;
// registration is idempotent across the extension's entry points.
registerStandardFormats();

/** One fact type's sample population, ready to render as a table. */
export interface PopulationTable {
  readonly factTypeName: string;
  /** Column headers: the fact type's role players. */
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<readonly string[]>;
}

/** Content for the webview's non-diagram tabs. */
export interface TabPanels {
  readonly verbalization: readonly string[];
  readonly yaml: string;
  readonly ddl: string;
  readonly populations: readonly PopulationTable[];
}

const verbalizer = new Verbalizer();
const serializer = new OrmYamlSerializer();

/** Build the tab-panel content for one model. */
export function buildTabPanels(model: OrmModel): TabPanels {
  return {
    verbalization: buildVerbalization(model),
    yaml: buildYaml(model),
    ddl: buildDdl(model),
    populations: buildPopulations(model),
  };
}

function buildVerbalization(model: OrmModel): readonly string[] {
  try {
    return verbalizer.verbalizeModel(model).map((v) => v.text);
  } catch (err) {
    return [`Verbalization failed: ${(err as Error).message}`];
  }
}

function buildYaml(model: OrmModel): string {
  try {
    return serializer.serialize(model);
  } catch (err) {
    return `# Serialization failed: ${(err as Error).message}`;
  }
}

function buildDdl(model: OrmModel): string {
  try {
    const exporter = getExporter("ddl");
    if (!exporter) return "-- DDL exporter is not registered.";
    return exporter.export(model).text;
  } catch (err) {
    return `-- DDL export failed: ${(err as Error).message}`;
  }
}

function buildPopulations(model: OrmModel): readonly PopulationTable[] {
  const tables: PopulationTable[] = [];
  for (const population of model.populations) {
    const factType = model.getFactType(population.factTypeId);
    if (!factType) continue;
    const roles = factType.roles;
    tables.push({
      factTypeName: factType.name,
      columns: roles.map(
        (r) => model.getObjectType(r.playerId)?.name ?? r.name,
      ),
      rows: population.instances.map((inst) => roles.map((r) => inst.roleValues[r.id] ?? "")),
    });
  }
  return tables;
}
