import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Icon } from "../layout/icons";
import { PANEL_KEY_STEP, PANEL_MAX, PANEL_MIN } from "../lib/panelWidth";

interface SidePanelProps {
  title: string;
  actions?: ReactNode;
  width: number;
  onResize: (width: number) => void;
  onResetWidth: () => void;
  onCollapse: () => void;
  children: ReactNode;
}

/** Docked tool panel: title row (actions + collapse), scrolling body, drag-to-resize edge. */
export function SidePanel({ title, actions, width, onResize, onResetWidth, onCollapse, children }: SidePanelProps) {
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: width };
    document.body.classList.add("is-resizing");
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onResize(drag.current.startW + e.clientX - drag.current.startX);
  };
  const endDrag = () => {
    drag.current = null;
    document.body.classList.remove("is-resizing");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? PANEL_KEY_STEP * 4 : PANEL_KEY_STEP;
    const next: Record<string, number> = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: PANEL_MIN,
      End: PANEL_MAX,
    };
    if (e.key in next) {
      e.preventDefault();
      onResize(next[e.key]);
    }
  };

  return (
    <aside className="side-panel" aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="panel-actions">
          {actions}
          <button className="tool-btn" onClick={onCollapse} title="Hide panel" aria-label="Hide panel">
            <Icon name="collapse" size={16} />
          </button>
        </div>
      </div>
      <div className="panel-body">{children}</div>
      <div
        className="panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onResetWidth}
        onKeyDown={onKeyDown}
      />
    </aside>
  );
}

interface PanelSectionProps {
  label?: string;
  children: ReactNode;
}

export function PanelSection({ label, children }: PanelSectionProps) {
  return (
    <section className="panel-section">
      {label && <h3 className="section-label">{label}</h3>}
      {children}
    </section>
  );
}
