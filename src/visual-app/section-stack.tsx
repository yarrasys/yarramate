import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  sectionHeightBounds,
  type RightSectionId,
} from "./workspace-state.js";

/**
 * The right column's furniture: a collapsible section, and the handle between
 * two of them (#249).
 *
 * The column used to be one panel with the subject form and the changeset tray
 * stacked inside it and no way to give any of the three more room than the
 * others happened to leave. It is a stack of named sections now, because more
 * are coming and because a reviewer reading a long changeset should not have to
 * scroll past a subject form to reach the commit button.
 *
 * A section says what it holds even while it is shut - the header carries a
 * label and a line of meta - which is the whole reason the column no longer has
 * an open/closed toggle of its own. A closed strip button said nothing; three
 * closed headers say what is behind each of them.
 */

export interface SectionProps {
  readonly id: RightSectionId;
  readonly label: string;
  /** A word about what is inside, read while the section is shut: the selected
   * subject's id, how many rows are staged, whether the agent is idle. */
  readonly meta?: ReactNode;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}

export function Section({
  id,
  label,
  meta,
  open,
  onToggle,
  children,
}: SectionProps) {
  return (
    <section className={`stack-section stack-section-${id}`}>
      <h2 className="section-head">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={open}
          aria-controls={`section-${id}`}
          onClick={onToggle}
        >
          <span className="section-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="section-label">{label}</span>
        </button>
        {meta === undefined ? null : (
          <span className="section-meta">{meta}</span>
        )}
      </h2>
      <div className="section-body" id={`section-${id}`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/**
 * The handle between two sections.
 *
 * Drags the section BELOW it, which is the one with a height: the sections
 * above take what is left, so a handle that grew the upper one would have to
 * decide which of them gave the room up. Keyboard-reachable with the arrow
 * keys, for the same reason the conversation's own separator is: a control
 * only a pointer can reach is a control some reviewers do not have.
 */
export function SectionSplitter({
  label,
  height,
  viewportHeight,
  onResize,
}: {
  readonly label: string;
  readonly height: number;
  readonly viewportHeight: number;
  readonly onResize: (height: number) => void;
}) {
  const bounds = sectionHeightBounds(viewportHeight);
  const drag = useRef<{
    readonly pointerId: number;
    readonly startY: number;
    readonly startHeight: number;
  } | null>(null);

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    // Dragging UP grows the section below, so the delta is inverted the same
    // way the conversation separator inverts its own.
    onResize(active.startHeight + active.startY - event.clientY);
  };

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    onResize(height + (event.key === "ArrowUp" ? step : -step));
  };

  return (
    <div
      className="section-splitter"
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuenow={Math.round(height)}
      aria-valuemin={bounds.min}
      aria-valuemax={Math.round(bounds.max)}
      tabIndex={0}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={keyDown}
    />
  );
}
