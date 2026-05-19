/**
 * Top-bar dropdown for named diagram views.
 *
 * Lists every saved layout in the model's `diagrams:` section and offers
 * to save the current state as a new view or return to the full model.
 */
import { useEffect, useRef, useState } from "react";

export interface ViewsMenuProps {
  readonly views: readonly string[];
  readonly activeView: string | null;
  readonly onLoadView: (name: string) => void;
  readonly onSaveView: () => void;
  readonly onShowFull: () => void;
}

export function ViewsMenu(props: ViewsMenuProps): JSX.Element {
  const { views, activeView, onLoadView, onSaveView, onShowFull } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (run: () => void): void => {
    setOpen(false);
    run();
  };

  return (
    <div className="viewsmenu" ref={rootRef}>
      <button
        type="button"
        className={"viewsmenu-button" + (open ? " open" : "")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="viewsmenu-buttontext">{activeView ?? "Views"}</span>
        <span className="viewsmenu-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="viewsmenu-panel" role="menu">
          {views.length > 0
            ? views.map((name) => (
              <button
                type="button"
                key={name}
                className={"viewsmenu-item" + (name === activeView ? " active" : "")}
                onClick={() => pick(() => onLoadView(name))}
              >
                {name}
              </button>
            ))
            : <div className="viewsmenu-empty">No saved views</div>}
          <div className="viewsmenu-sep" />
          <button type="button" className="viewsmenu-item" onClick={() => pick(onSaveView)}>
            Save current view...
          </button>
          <button type="button" className="viewsmenu-item" onClick={() => pick(onShowFull)}>
            Show full model
          </button>
        </div>
      )}
    </div>
  );
}
