import { Icon, type IconName } from "./icons";

export type PanelId =
  | "projects" | "sites" | "terrain" | "color" | "maps" | "charts" | "jobsite" | "control" | "adjust" | "layers" | "site";

type Group = "places" | "tools";

const ITEMS: ReadonlyArray<{ id: PanelId; icon: IconName; label: string; group: Group }> = [
  { id: "projects", icon: "folder", label: "Projects", group: "places" },
  { id: "sites", icon: "hardhat", label: "Job sites", group: "places" },
  { id: "site", icon: "flag", label: "Site setup", group: "places" },
  { id: "terrain", icon: "terrain", label: "Terrain", group: "tools" },
  { id: "color", icon: "cloudColor", label: "Cloud colour", group: "tools" },
  { id: "maps", icon: "maps", label: "2D maps", group: "tools" },
  { id: "charts", icon: "chart", label: "Charts", group: "tools" },
  { id: "jobsite", icon: "excavator", label: "Job site calculations", group: "tools" },
  { id: "control", icon: "target", label: "Control & accuracy", group: "tools" },
  { id: "adjust", icon: "sliders", label: "Manual adjustments", group: "tools" },
  { id: "layers", icon: "layers", label: "Layers", group: "tools" },
];

interface IconRailProps {
  items: readonly PanelId[]; // which panels make sense for the open project
  active: PanelId | null;
  onSelect: (id: PanelId) => void; // selecting the active item collapses the panel
}

/**
 * The left rail: where you are (projects, job sites, site setup), then tools for
 * the scan in view. Resting the pointer on it slides out the names, so new users
 * never have to guess what an icon means.
 */
export function IconRail({ items, active, onSelect }: IconRailProps) {
  const shown = ITEMS.filter((item) => items.includes(item.id));
  return (
    <nav className="icon-rail" aria-label="Tool panels">
      {shown.map((item, k) => (
        <div key={item.id} className="rail-item">
          {k > 0 && shown[k - 1].group !== item.group && <hr className="rail-divider" aria-hidden="true" />}
          <button
            className="rail-btn"
            aria-pressed={active === item.id}
            aria-label={item.label}
            title={item.label}
            onClick={() => onSelect(item.id)}
          >
            <Icon name={item.icon} size={20} />
            <span className="rail-label" aria-hidden="true">
              {item.label}
            </span>
          </button>
        </div>
      ))}
    </nav>
  );
}
