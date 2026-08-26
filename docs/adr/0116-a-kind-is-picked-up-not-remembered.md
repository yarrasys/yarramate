# A kind is picked up, not remembered

Status: accepted

Making a subject has one route: the Add-subject popover, reached from a
button or the canvas menu, with a Kind select compiled from the model
frame's `vocabulary.conceptKinds`. Every subject costs click → three
fields → Add, and the vocabulary itself — the first thing a consultant
new to a profile needs to see — is buried behind that select. ApertureX,
embedding the editor over its own store (#252), asked after real
consultant use for the gesture diagramming tools taught everyone:
a palette of kinds, dragged onto the canvas (#295).

## Decision

A `palette` section joins `RIGHT_SECTIONS`, first — it is the tool that
makes subjects, and tools read above inspection — so a host opts in or
out through the `sections` vocabulary it already speaks, exactly like
`properties` or `changes`. The rows are `vocabulary.conceptKinds`, the
same list the Add-subject dialog compiles its select from, grouped into
layer bands by each kind's core lineage in the profile's own layer
order: the organisation the model tree already reads in, so the palette
and the rail tell one story. Each row carries the glyph the canvas draws
on a node of that kind.

A row is picked up, not armed. Dragging it carries the kind's label —
the value a document names and `apply` accepts — under a custom type,
`application/x-yarramate-kind`, so a stray text drop stays inert; the
canvas container accepts the drop and the existing Add-subject dialog
opens with the kind preselected. Clicking a row opens the same dialog
the same way, which is the whole gesture without a pointer drag. Either
way the palette holds nothing afterwards: the kind travels with the
gesture into the form's own state (`initialKind`), the plain openers
still start with no kind chosen, and a second pick while the form is
open re-seeds a fresh draft rather than silently changing nothing.

The drop's position is converted to model coordinates and handed up,
and deliberately goes no further. Placement belongs to the layout
system: elk lays out what the graph declares, and pinning one node is a
saved-layout sidecar write (ADR 0113) against a subject that does not
exist until the changeset commits — a write the unfiltered pseudo-view
refuses outright. A dropped subject lands where the layout puts it,
like every subject before it.

## Excluded options

- **Creating the subject on drop, no dialog**: the id is derived from
  the name, so there is no name to derive it from — the drop would have
  to invent one, and a derived address the author never saw is one
  nobody agreed to. The dialog stays the details editor.
- **An armed mode** (click a kind, then stamp the canvas): a mode the
  reviewer must remember to leave, and the palette would hold a
  selection the next click honours long after the intent behind it has
  gone. The title is the rule: picked up, not remembered.
- **A flat list**: sixty rows with no bands is a wall, and the model
  tree already taught this shell that layers are how a vocabulary is
  read. Grouping is derived per render from the core lineage the wire
  carries; nothing new travels.
- **Threading the drop position into the staged result**: the
  disproportion above — a sidecar write for an uncommitted subject
  against a view that may refuse it — for a position the next relayout
  would move anyway.
- **Holding the picked kind in workspace state**: it is the gesture's
  payload on its way to the form, not a fact about the workspace — the
  same rule that keeps a half-typed name out of the reducer. The shell
  holds it beside `saveViewFolder`, which is the same kind of seed.

## Consequences

`RIGHT_SECTIONS` grows to five and the palette leads, so hosts that
pass an explicit section list see nothing new until they ask, and the
session shell — which passes none — gets the palette by default. The
form gains an optional `initialKind` that seeds its state once; its
no-default rule stands, because a palette pick is the reviewer's own
choice arriving with the gesture. `GraphCanvas` gains an optional
`onKindDrop` and accepts only the palette's own MIME type, so nothing
changes for a host that never renders a palette.
