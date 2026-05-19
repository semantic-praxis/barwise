/**
 * Thin context strip below the top bar.
 *
 * Visible only while a focus neighborhood or a named view is active. It
 * surfaces hop stepping for an active focus, a ghost-preview exit, and
 * the route back to the full model.
 */
import type { DiagramMeta } from "../../../src/diagram/protocol";

const MIN_HOPS = 1;
const MAX_HOPS = 5;

export interface ContextBarProps {
  readonly meta: DiagramMeta;
  readonly onSetHop: (entityId: string, hopCount: number) => void;
  readonly onClearFocus: () => void;
  readonly onClearGhosts: () => void;
}

export function ContextBar(props: ContextBarProps): JSX.Element | null {
  const { meta, onSetHop, onClearFocus, onClearGhosts } = props;
  const { focus, view } = meta;
  if (!focus && !view) return null;

  return (
    <div className="contextbar">
      {focus && (
        <div className="contextbar-group">
          <span className="contextbar-label">Focused on</span>
          <span className="contextbar-value">{focus.entityName}</span>
          <div className="contextbar-stepper">
            <button
              type="button"
              title="Fewer hops"
              disabled={focus.hopCount <= MIN_HOPS}
              onClick={() => onSetHop(focus.entityId, focus.hopCount - 1)}
            >
              -
            </button>
            <span className="contextbar-hops">
              {focus.hopCount} {focus.hopCount === 1 ? "hop" : "hops"}
            </span>
            <button
              type="button"
              title="More hops"
              disabled={focus.hopCount >= MAX_HOPS}
              onClick={() => onSetHop(focus.entityId, focus.hopCount + 1)}
            >
              +
            </button>
          </div>
        </div>
      )}
      {view && (
        <div className="contextbar-group">
          <span className="contextbar-label">View</span>
          <span className="contextbar-value">{view.viewName}</span>
          {view.hasGhosts && (
            <button type="button" className="contextbar-action" onClick={onClearGhosts}>
              Clear preview
            </button>
          )}
        </div>
      )}
      <div className="contextbar-spacer" />
      <button type="button" className="contextbar-action" onClick={onClearFocus}>
        Show full model
      </button>
    </div>
  );
}
