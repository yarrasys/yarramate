# The viewer accepts the host's marks

Status: accepted

ApertureX asked it on #298 and #314 committed to it: their product keeps
its own comparison model — published-snapshot diffs, register overlays —
and, for want of a way to show a comparison on the mounted editor, holds
a parallel cytoscape renderer beside it. A parallel renderer is exactly
the drift the mountable editor exists to end
([ADR 0117](0117-a-mounted-editor-can-refuse-the-pen.md) closed the
read-only half of it), but the remaining half needed a seam: the viewer
showing a difference it did not compute. The precedents were already
shipped — faults mark subjects by class over ids someone else named
(ADR 0102), and the interrogation overlay rides beside the model with
absence meaning nothing drawn
([ADR 0111](0111-the-canvas-carries-the-interviews-nudges.md)).

## Decision

The mounted editor accepts **host-supplied per-subject decorations** and
renders them; it never diffs. `MountOptions` gains
`decorations?: Readonly<Record<string, 'added' | 'removed' | 'changed'>>`
— subject id to mark, concepts and relationships alike, the way the
faults lane already marks both node and edge by id — and the
`MountedEditor` handle gains `setDecorations(decorations)`, riding the
same `onReady` pointer bridge as the #297 methods
([ADR 0118](0118-the-host-can-point-at-the-canvas.md)). The option is
the initial map; a live comparison hands new maps through the handle.

- **The boundary is marks, not semantics.** What `added` is relative to
  — another snapshot, a register, a proposal — is the host's knowledge
  and stays on the host's side of the seam. The viewer renders the map
  it is handed and computes nothing, which is what lets one viewer serve
  authoring, read-only viewing (#298) and decorated comparison without
  learning what comparison is.
- **Replace, not merge.** The map is the unit of exchange: every
  `setDecorations` replaces the previous marks wholesale, and `{}`
  clears them. A merge would make the current picture the sum of every
  map ever handed over, which no one — host or viewer — could state.
- **Unknown ids are silently inert.** The host may be describing
  subjects this model has not gained yet, or has already lost; a mark
  with nothing to land on marks nothing and raises nothing. Absent means
  nothing drawn, the overlay discipline of ADR 0111.
- **Rendering is the faults mechanism.** `deco-added` / `deco-removed`
  / `deco-changed` classes toggled by an effect keyed on the map and the
  graph, styled by stylesheet rules: added wears the eucalyptus token as
  a border, removed the quiet ink-grey with a dash — an outline of an
  absence, deliberately nothing like a defect — and changed the ochre.
  Never the failure red: faults own it, and a comparison mark that
  borrowed it would report a difference as a refusal.
- **Precedence: a fault outranks a decoration outranks selection.**
  Cytoscape resolves its stylesheet by declaration order alone — no
  CSS-style specificity — so the precedence is made by order and stated
  here once: the marking rules land after the base and notation rules,
  the fault rule after the marking rules. The reviewer can move the
  selection, the host can hand a decoration, and a subject a diagnostic
  named reads as refused through both. Ordering the fault rule last
  also lands it after the base `edge` rule for the first time, which
  makes the failure red real on faulted *edges* — previously the base
  rule, declared later, silently won their line colour back.
- **`setDecorations` needs no model and no pen.** Unlike its pointer
  siblings there is no graph gate — the marks are client state, drawn
  the moment a model is on screen, so a host may hand them before the
  first frame — and no read-only gate, because decorating is reading:
  the primary consumer decorates frozen snapshots under `readOnly`.
  False is only the shared not-there window: before the shell's first
  render, or after unmount.

## Excluded options

- **A custom-class escape hatch** (`decorations: { id: 'my-class' }`):
  the three-mark vocabulary is closed in v1. An open class vocabulary is
  an unversioned styling API onto this canvas's internals; a fourth mark
  joins the enum when demand names it, styled once here for everyone.
- **Legend or affordance chrome in the viewer**: the viewer cannot say
  what `changed` is relative to, so any legend it drew would be a guess
  at the host's semantics. The host owns meaning and draws its own
  legend beside the mount.
- **Comparison semantics in the viewer** (hand it two models, let it
  diff): the seam exists precisely because comparison models differ per
  host; one shipped diff would be wrong for every host but its author.
- **A session-server equivalent**: recorded as follow-up, not built. The
  wire protocol, the adapters and `yarramate-visual` are untouched;
  threading a decorations frame through the session host is its own
  decision for whenever a session consumer asks, the way ADR 0117
  deferred server-session read-only.

## Consequences

`MountOptions` grows one optional field, `mountEditorWith` one trailing
parameter, `MountedEditor` and the pointer one method, `App` one
optional prop — every existing embedder stands unchanged, and the
session shell passes nothing. ApertureX can delete the parallel renderer
this gated: working mode mounts the author, published views mount
`readOnly` with `decorations`, and a live diff view replaces the map as
its comparison moves. The vocabulary is deliberately small and shared
with the LikeC4 exporter's compare instinct (`--changed`'s
new/changed/context), so the two comparison surfaces stay conceptually
one even though neither reads the other.
