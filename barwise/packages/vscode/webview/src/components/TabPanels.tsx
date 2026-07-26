/**
 * The non-diagram tab panels (modernization Phase 3): thin views over
 * host-computed content. Verbalization renders the FORML sentences,
 * Fact Population renders sample-population tables, YAML and SQL DDL
 * render the serialized artifacts. All content arrives with `setGraph`;
 * the webview holds no model and computes nothing.
 */
import type { TabPanels as TabPanelsData } from "../../../src/diagram/tabPanels";
import type { TabKey } from "./TopBar";

export interface TabPanelViewProps {
  readonly tab: Exclude<TabKey, "diagram">;
  readonly panels: TabPanelsData | null;
}

export function TabPanelView(props: TabPanelViewProps): JSX.Element {
  const { tab, panels } = props;
  if (!panels) {
    return <div className="empty-state">Loading model…</div>;
  }
  switch (tab) {
    case "verbalize":
      return <VerbalizationView lines={panels.verbalization} />;
    case "facts":
      return <PopulationView populations={panels.populations} />;
    case "yaml":
      return <CodeView text={panels.yaml} />;
    case "ddl":
      return <CodeView text={panels.ddl} />;
  }
}

function VerbalizationView(props: { lines: readonly string[]; }): JSX.Element {
  if (props.lines.length === 0) {
    return <div className="empty-state">No fact types to verbalize.</div>;
  }
  return (
    <div className="panel-scroll">
      <ol className="verbalization-list">
        {props.lines.map((line, i) => <li key={i}>{line}</li>)}
      </ol>
    </div>
  );
}

function PopulationView(
  props: { populations: TabPanelsData["populations"]; },
): JSX.Element {
  if (props.populations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No sample populations</div>
        <div className="empty-state-sub">
          Add a `populations:` section to the model to see sample facts here.
        </div>
      </div>
    );
  }
  return (
    <div className="panel-scroll">
      {props.populations.map((pop) => (
        <div key={pop.factTypeName} className="population-block">
          <div className="population-title">{pop.factTypeName}</div>
          <table className="population-table">
            <thead>
              <tr>
                {pop.columns.map((c, i) => <th key={i}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {pop.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function CodeView(props: { text: string; }): JSX.Element {
  return (
    <div className="panel-scroll">
      <pre className="code-view">{props.text}</pre>
    </div>
  );
}
