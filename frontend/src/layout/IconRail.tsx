import { Icon, type IconName } from "./icons";

export type PanelId = "projects" | "terrain" | "color" | "maps" | "charts" | "jobsite" | "adjust" | "layers";

const ITEMS: ReadonlyArray<{ id: PanelId; icon: IconName; label: string }> = [
  { id: "projects", icon: "folder", label: "Projects" },
  { id: "terrain", icon: "terrain", label: "Terrain" },
  { id: "color", icon: "cloudColor", label: "Cloud colour" },
  { id: "maps", icon: "maps", label: "2D maps" },
  { id: "charts", icon: "chart", label: "Charts" },
  { id: "jobsite", icon: "excavator", label: "Job site calculations" },
  { id: "adjust", icon: "sliders", label: "Manual adjustments" },
  { id: "layers", icon: "layers", label: "Layers" },
];

interface IconRailProps {
  items: readonly PanelId[]; // which panels make sense for the open project
  active: PanelId | null;
  onSelect: (id: PanelId) => void; // selecting the active item collapses the panel
}

export function IconRail({ items, active, onSelect }: IconRailProps) {
  return (
    <nav className="icon-rail" aria-label="Tool panels">
      {ITEMS.filter((item) => items.includes(item.id)).map((item) => (
        <button
          key={item.id}
          className="rail-btn"
          aria-pressed={active === item.id}
          aria-label={item.label}
          title={item.label}
          onClick={() => onSelect(item.id)}
        >
          <Icon name={item.icon} size={20} />
        </button>
      ))}
    </nav>
  );
}
