import { useEffect, useRef, useState } from "react";
import { Icon } from "../layout/icons";
import { ACCENT_PRESETS, DEFAULT_ACCENT, type ThemeChoice } from "./appearance";
import { ColorWheel } from "./ColorWheel";
import { hexToHsv, hsvToHex, parseHex, type Hsv } from "./colorMath";
import type { AppearanceApi } from "./useAppearance";

const THEME_OPTIONS: ReadonlyArray<[ThemeChoice, string]> = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

interface AppearancePopoverProps {
  api: AppearanceApi;
  onPlayIntro: () => void;
}

/** Top-bar Appearance button + popover: theme and highlight colour (room for more). */
export function AppearancePopover({ api, onPlayIntro }: AppearancePopoverProps) {
  const { appearance, update, reset, uiAccent } = api;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // The wheel keeps its own HSV so hue survives at zero saturation (hex can't hold it).
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(appearance.accent));
  const [hexDraft, setHexDraft] = useState(appearance.accent);

  useEffect(() => {
    setHexDraft(appearance.accent);
    if (hsvToHex(hsv) !== appearance.accent) setHsv(hexToHsv(appearance.accent));
  }, [appearance.accent]); // only the stored colour (presets, reset, hex entry); not every wheel move

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const setFromWheel = (next: Hsv) => {
    setHsv(next);
    update({ accent: hsvToHex(next) });
  };
  const commitHex = () => {
    const parsed = parseHex(hexDraft);
    if (parsed) update({ accent: parsed });
    else setHexDraft(appearance.accent);
  };

  return (
    <div className="appearance" ref={root}>
      <button
        className="tool-btn"
        aria-label="Appearance"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Appearance"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="palette" size={16} />
      </button>

      {open && (
        <div className="appearance-pop" role="dialog" aria-label="Appearance">
          <div className="appearance-head">
            <h2>Appearance</h2>
            <button className="text-btn" onClick={reset}>
              Reset
            </button>
          </div>

          <section className="appearance-section">
            <h3 className="section-label">Theme</h3>
            <div className="segmented" role="group" aria-label="Theme">
              {THEME_OPTIONS.map(([value, label]) => (
                <button key={value} aria-pressed={appearance.theme === value} onClick={() => update({ theme: value })}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="appearance-section">
            <h3 className="section-label">Highlight colour</h3>
            <ColorWheel value={hsv} onChange={setFromWheel} />

            <div className="swatches" role="group" aria-label="Preset colours">
              {ACCENT_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  className="swatch"
                  style={{ background: p.hex }}
                  aria-label={p.name}
                  aria-pressed={appearance.accent === p.hex}
                  title={p.name}
                  onClick={() => update({ accent: p.hex })}
                />
              ))}
            </div>

            <div className="hex-row">
              <span className="hex-preview" style={{ background: uiAccent }} aria-hidden="true" />
              <label className="hex-field">
                <span className="sr-only">Hex colour</span>
                <input
                  className="fig"
                  value={hexDraft}
                  spellCheck={false}
                  maxLength={7}
                  onChange={(e) => setHexDraft(e.target.value)}
                  onBlur={commitHex}
                  onKeyDown={(e) => e.key === "Enter" && commitHex()}
                />
              </label>
              {appearance.accent !== DEFAULT_ACCENT && (
                <button className="text-btn" onClick={() => update({ accent: DEFAULT_ACCENT })}>
                  Default
                </button>
              )}
            </div>
            {uiAccent !== appearance.accent && (
              <p className="panel-note">
                Shown as <span className="fig">{uiAccent}</span> in {api.theme} mode so it stays readable.
              </p>
            )}
          </section>

          <section className="appearance-section">
            <h3 className="section-label">Launch</h3>
            <div className="intro-setting">
              <label className="check-row">
                <input type="checkbox" checked={appearance.intro} onChange={(e) => update({ intro: e.target.checked })} />
                Play launch animation
              </label>
              <button
                className="text-btn"
                onClick={() => {
                  setOpen(false);
                  onPlayIntro();
                }}
              >
                Play now
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
