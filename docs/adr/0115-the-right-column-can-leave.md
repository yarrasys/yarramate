# The right column can leave

Status: accepted

The right column could shrink but never leave. Its sections collapse one
by one (#249), and the splitter narrows the column to
`CONVERSATION_MIN_WIDTH` (320px), but the `section-stack` aside and its
separator rendered unconditionally in the shell, so 320px plus the
separator was the floor. #249 was deliberate about this: the column lost
its open/closed mode because three shut headers say what is behind them
where a shut strip button said nothing. That reasoning holds for working —
and it is silent about presenting. Walking a diagram on a shared screen,
a projector, or a laptop's wide layered band are exactly the moments the
whole canvas is wanted, and every one of them paid a 320px tax for
panels nobody was reading (#294). A host can pass `sections: []`, but
that is the host's decision made before the session; the person at the
canvas had no control at all.

## Decision

`VisualWorkspaceState.conversation` gains `hidden: boolean`, a mode
beside the width rather than a zero width, moved by a
`conversation.toggled` action beside `conversation.resized`. The width —
and the section list, and the splitter heights — stay exactly what they
were, so reopening restores the layout the reviewer left: hiding is
presentation, and presentation must not cost anyone their staged work or
their dragged sizes. A `conversation.resized` arriving while hidden is
ignored: no separator is on screen to have produced it, and honouring a
stray would make reopening restore a width nobody dragged to.

The shell renders the separator and the aside only while the column is
on screen — a resize handle is never drawn against a column that is not
there — with a slim rim above the sections carrying the hide control.
Hidden, a thin reopen strip stands in the boundary's own place, full
height, one click to bring everything back. The strip is not a memory
test: it carries the attention the hidden column would have shown — the
unread count the chat header would have counted (`attention.received`
now counts arrivals while the column is hidden, not only while the chat
section is shut), and a marker while the agent is waiting on a choice.
Reopening clears the count the way opening the chat section does, unless
the reviewer had shut that section before hiding, where the count moves
to the chat header it always lived on.

The canvas refits by the mechanism it already has: its `ResizeObserver`
reframes on any container resize — a panel toggle, a drag, a window
change — and collapsing the column's grid track (`--conversation-width`
goes to `0px`) is just the largest such resize. Nothing in the canvas
knows the column exists.

Host-supplied `sections` behaviour is unchanged: the host still declares
which sections exist; the reviewer decides whether the column holding
them is on screen. A keyboard shortcut is deferred — the canvas and the
composer both listen for keys, and a binding chosen casually here is a
conflict discovered by whoever relies on it.

## Excluded options

- **A zero-width state on the width model**: one field instead of two,
  but every clamp rule, the separator's aria bounds, and the "restore
  the previous width" behaviour would need a special case for zero — the
  width would stop being the memory the reopen depends on.
- **Emptying `sections` as the collapse**: it conflates the host's
  contract (which sections exist) with the reviewer's presentation
  (whether the column is on screen), and an empty stack still draws the
  column chrome.
- **Auto-reopening on attention**: a reply yanking the column back
  mid-presentation is the interruption hiding exists to prevent. The
  strip signals; the reviewer decides.
- **A floating overlay toggle on the canvas**: the control belongs to
  the thing it acts on — the #249 rule that moved every strip control to
  its subject — so the hide control sits on the column and the reopen
  strip stands where the column stood.

## Consequences

`createVisualWorkspaceState` gains `hidden: false` — hiding is a gesture
a reviewer makes, never a resting state a session opens into — and the
persisted shape of `conversation` grows one boolean beside the width.
The reopen strip's accessible name states the unread count and a waiting
choice, so what the badges show a screen reader hears. The narrow-window
layout, where the stack lies across the foot, gets a horizontal strip by
the same rule that lies the stack down.
