# A mounted editor can refuse the pen

Status: accepted

ApertureX, embedding the editor over its own store (#252), keeps
immutable published snapshots beside its working workspace. Working mode
mounts the editor as the authoring surface; published views still go
through their own renderer, because there was no documented way to mount
the editor over a store that refuses writes without the UI still
offering to stage and commit (#298). Their store's refusal is real —
`writeAll` fails — but the surface kept the pen: Add subject, the
palette, Connect and Delete, editable forms, the changes tray, "Stage
view change", drag-to-save layouts, and every staging item on the
context menus. A viewer built on that mount learns the snapshot is
frozen one error at a time, which is why they built a second renderer —
and a second renderer is exactly the drift the mountable editor exists
to end.

## Decision

`mountEditor` gains `readOnly?: boolean` (default `false`),
`mountEditorWith` a trailing `readOnly` parameter, and `App` one prop —
one flag, threaded once. Read-only keeps everything that reads: the
canvas, selection, the quick filter, view navigation, the query fields
(a live filter narrows the canvas and writes nothing), the open
questions, the properties facts, Export PNG, and the saved-layout pill
with its session-local Discard. Every affordance that stages or commits
is **absent, not disabled**, each cut at the seam it already had:

- **Sections.** Read-only strips `palette` and `changes` from whatever
  list the host names, beside the existing questions gate: a palette
  that cannot create and a tray that cannot commit are not "sections
  the host wants shown", whatever the list says. `mountEditor` with no
  `sections` defaults to `['properties', 'questions']` — the local host
  has no agent, so a read-only default that drew chat would draw a
  composer with nobody behind it.
- **Menus.** `contextMenuFor` filters by intent, once, at its tail: a
  closed reading set (inspect, open view, show all, copy path, export
  PNG) survives, and a group the filter empties — every destructive
  group among them — is dropped whole.
- **The inspector.** The facts render as values (`ConceptFacts`,
  `RelationshipFacts`) where the editable forms stood; Connect and
  Delete leave, Clear stays, the description still reads.
- **The canvas.** A drag still moves a node — arranging what is on
  screen is reading — but the debounced layout save goes nowhere, and
  the kind-drop handler is withdrawn so the canvas itself refuses the
  drag.

The `EditorHost` seam needs nothing. Read-only is a UI posture, and the
host refuses writes on its own authority — ApertureX's store already
does. The two are independent defenses: the posture keeps the surface
honest, the store keeps the data safe, and neither substitutes for the
other.

## Excluded options

- **Disabled-but-visible controls**: a greyed pen says the surface is
  broken, not that the snapshot is frozen. This shell already draws
  controls only where they can act — the session button leaves with the
  chat section (#252), a splitter is never drawn against a hidden
  column (#294) — and absence is the same rule here.
- **A second permission system** (per-affordance capabilities, roles):
  one boolean names the only posture anyone has asked for. A capability
  vocabulary would need its own versioning and its own tests for
  combinations nobody holds.
- **Server-session read-only**: `yarramate-visual` sessions stay
  authoring surfaces. Threading the same prop through the session page
  is cheap if a frozen session is ever wanted, and deferred until it is.
- **Emptying `sections` as the whole answer**: the sections vocabulary
  cannot reach the pen's other homes — the Add-subject opener, the
  inspector's buttons, the menus, the drag save — and bending it to try
  would conflate what exists with what may act.

## Consequences

`MountOptions` grows one optional flag and `mountEditorWith` one
trailing parameter with a default, so every existing call stands
unchanged; the session shell passes nothing and is untouched. A host
naming its own `sections` alongside `readOnly: true` keeps its list
minus the two staging sections. The read-only menu rule is a set of
intent types, so a future menu item declares its side of the line by
the intent it carries and the filter needs no edit. The staged-state
plumbing (`pendingChangeset`, the tray, the rail's staged chips) still
exists under a read-only mount and simply never receives anything —
which is the honest shape: nothing was forked, one surface was told to
put the pen down.
