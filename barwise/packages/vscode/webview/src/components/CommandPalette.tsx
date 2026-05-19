/**
 * Cmd/Ctrl+K command overlay: a filtered, keyboard-driven list of the
 * diagram's verbs. Commands are supplied by the App, already bound to
 * the current selection / view context.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "../commands";

export interface CommandPaletteProps {
  readonly commands: readonly Command[];
  readonly onClose: () => void;
}

export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const { commands, onClose } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[active];
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (cmd: Command | undefined): void => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length > 0
            ? filtered.map((cmd, i) => (
              <button
                type="button"
                key={cmd.id}
                className={"palette-item" + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(cmd)}
              >
                <span className="palette-item-label">{cmd.label}</span>
                {cmd.hint && <span className="palette-item-hint">{cmd.hint}</span>}
              </button>
            ))
            : <div className="palette-empty">No matching commands</div>}
        </div>
      </div>
    </div>
  );
}
