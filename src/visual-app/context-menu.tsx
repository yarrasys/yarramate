import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  placeMenu,
  type ContextMenuGroup,
  type ContextMenuIntent,
} from "./context-menu-model.js";

/**
 * The menu itself: a positioned list of buttons over whatever was right-clicked.
 *
 * It decides nothing. `contextMenuFor` has already said which groups exist, in
 * which order, and which one removes authored text; this draws that and reports
 * the intent that was chosen. The one thing it computes is where to sit, and
 * that is `placeMenu`, which is pure and tested — the measurement it needs
 * (`getBoundingClientRect`) is the only reason any of this is in an effect.
 *
 * Buttons in lists, not an ARIA `menu`, for the same reason the rail is not an
 * ARIA `tree`: a real menu widget owes the reviewer roving focus and typeahead,
 * and this repo has no DOM test environment to hold that behaviour honest.
 * What it does owe — Escape closes, a click outside closes, focus lands inside
 * so a keyboard can reach the items — is small enough to be right by reading.
 */

export interface ContextMenuProps {
  readonly groups: readonly ContextMenuGroup[];
  readonly x: number;
  readonly y: number;
  readonly onChoose: (intent: ContextMenuIntent) => void;
  readonly onDismiss: () => void;
}

export function ContextMenu({
  groups,
  x,
  y,
  onChoose,
  onDismiss,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Offscreen until measured: a menu painted at the pointer and then moved is
  // a menu that visibly jumps on every right-click near an edge.
  const [placement, setPlacement] = useState<{
    readonly left: number;
    readonly top: number;
  } | null>(null);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (element === null) return;
    const box = element.getBoundingClientRect();
    setPlacement(
      placeMenu(
        { x, y },
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    element.focus();
  }, [x, y, groups]);

  useEffect(() => {
    const keyed = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    // Pointerdown, not click: a menu that survives until mouseup sits over the
    // thing the next click was aimed at.
    const pointed = (event: PointerEvent) => {
      const target = event.target;
      if (
        menuRef.current !== null &&
        target instanceof Node &&
        menuRef.current.contains(target)
      ) {
        return;
      }
      onDismiss();
    };
    window.addEventListener("keydown", keyed);
    window.addEventListener("pointerdown", pointed, true);
    // A right-click elsewhere opens its own menu; this one must not linger
    // beside it, and the canvas suppresses the native menu rather than this.
    window.addEventListener("contextmenu", pointed, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      window.removeEventListener("keydown", keyed);
      window.removeEventListener("pointerdown", pointed, true);
      window.removeEventListener("contextmenu", pointed, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [onDismiss]);

  if (groups.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="dialog"
      aria-label="Actions"
      tabIndex={-1}
      style={
        placement === null
          ? { left: 0, top: 0, visibility: "hidden" }
          : { left: `${placement.left}px`, top: `${placement.top}px` }
      }
    >
      {groups.map((group) => (
        <div
          key={group.key}
          className={`context-menu-group context-menu-${group.scope}${
            group.destructive ? " context-menu-destructive" : ""
          }`}
        >
          {group.label === null ? null : (
            <p className="context-menu-heading">{group.label}</p>
          )}
          <ul>
            {group.items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="context-menu-item"
                  aria-current={item.current === true ? "true" : undefined}
                  onClick={() => onChoose(item.intent)}
                >
                  <span className="context-menu-tick" aria-hidden>
                    {item.current === true ? "•" : ""}
                  </span>
                  <span className="context-menu-label">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
