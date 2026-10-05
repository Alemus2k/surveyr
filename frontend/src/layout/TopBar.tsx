import type { ReactNode } from "react";
import type { ProjectRef } from "../api";
import { Icon } from "./icons";
import { ImportScanButton } from "./ImportScanButton";
import appIcon from "../assets/app-icon.png";

const MIDDLE_BUTTON = 1;

interface TopBarProps {
  tabs: ProjectRef[]; // open projects, in tab order
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  readout: string | null;
  appearance: ReactNode; // the Appearance button + popover
  onImport: (file: File) => void;
  importing: boolean;
}

/** Window-style title bar: app mark, closable project tabs, status readout. */
export function TopBar(props: TopBarProps) {
  const { tabs, activeId, onSelect, onClose, readout, appearance, onImport, importing } = props;
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <img className="brand-mark" src={appIcon} alt="" width={22} height={22} />
        <span className="brand-name">Surveyr</span>
      </div>
      <div className="project-tabs" role="tablist" aria-label="Open projects">
        {tabs.map((p) => {
          const active = p.id === activeId;
          return (
            <div
              key={p.id}
              className="project-tab"
              data-active={active}
              onAuxClick={(e) => e.button === MIDDLE_BUTTON && onClose(p.id)}
            >
              <button role="tab" aria-selected={active} className="tab-label" onClick={() => onSelect(p.id)} title={p.name}>
                {p.name}
              </button>
              <button className="tab-close" onClick={() => onClose(p.id)} aria-label={`Close ${p.name}`} title="Close tab">
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
        <ImportScanButton onFile={onImport} busy={importing} className="project-tab-add" label="Import scan">
          <Icon name="plus" size={15} />
        </ImportScanButton>
      </div>
      <div className="topbar-status">
        {readout && <span className="mono topbar-readout">{readout}</span>}
        {appearance}
      </div>
    </header>
  );
}
