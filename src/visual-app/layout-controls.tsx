import type { LayoutDirection } from "../layout-direction.js";
import { LAYOUT_MODES, type LayoutMode } from "../layout-mode.js";
import { STYLE_PRESETS, type StylePresetId } from "./style-presets.js";

/**
 * What each layout mode is called on the canvas. Iterated by the test against
 * `LAYOUT_MODES`, so a mode the format admits cannot be missing a name here.
 */
export const LAYOUT_MODE_LABELS: Readonly<Record<LayoutMode, string>> = {
  layered: "Layered",
  routed: "Routed",
  "served-by": "Served-by",
  bands: "Layer bands",
};

export const DIRECTIONS = ["top-down", "left-right"] as const;

export const DIRECTION_LABELS: Readonly<Record<LayoutDirection, string>> = {
  "top-down": "Top-down",
  "left-right": "Left-right",
};

/**
 * The layout and direction selects, on the canvas they arrange (ADR 0147).
 *
 * The view declares both and a view switch restates them; what a reviewer picks
 * here holds until then, and a save writes it. Shown in read-only hosts too:
 * arranging what is on screen is reading, the same judgement the quick filter
 * and a drag already make.
 */
export function LayoutControls({
  layout,
  direction,
  onLayoutChange,
  onDirectionChange,
  stylePreset = "current",
  onStyleChange,
}: {
  readonly layout: LayoutMode;
  readonly direction: LayoutDirection;
  readonly onLayoutChange: (layout: LayoutMode) => void;
  readonly onDirectionChange: (direction: LayoutDirection) => void;
  /** LAB: the dress select; absent draws no third select. */
  readonly stylePreset?: StylePresetId;
  readonly onStyleChange?: (preset: StylePresetId) => void;
}) {
  return (
    <>
      <select
        className="canvas-select"
        aria-label="Layout"
        value={layout}
        onChange={(event) => onLayoutChange(event.currentTarget.value as LayoutMode)}
      >
        {LAYOUT_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {LAYOUT_MODE_LABELS[mode]}
          </option>
        ))}
      </select>
      <select
        className="canvas-select"
        aria-label="Direction"
        value={direction}
        onChange={(event) =>
          onDirectionChange(event.currentTarget.value as LayoutDirection)
        }
      >
        {DIRECTIONS.map((candidate) => (
          <option key={candidate} value={candidate}>
            {DIRECTION_LABELS[candidate]}
          </option>
        ))}
      </select>
      {onStyleChange === undefined ? null : (
        <select
          className="canvas-select"
          aria-label="Style"
          value={stylePreset}
          onChange={(event) => onStyleChange(event.currentTarget.value as StylePresetId)}
        >
          {STYLE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.title}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
