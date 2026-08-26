# A saved layout is visible and view-scoped

Status: accepted

A reviewer's dragged positions persist in a per-view sidecar
(`yarramate/visual-layout/v1`), and the canvas honours them by re-pinning
every node the sidecar names after every layout run — `layoutstop` is the
only per-node "leave this one alone" hook ELK offers. Correct for
preserving drags; silent for everything else, and measured to be so twice
on the same fixture (#273). An experimental relayout moved 0 of 16 leaf
nodes until the pin was suspended, with no error and no hint. And a
sidecar can be stale relative to its view: `contact-update-solution`'s
held positions for 37 subjects spanning y 86–2914 while the view drew 20,
so the view was scattered across coordinates sized for the whole model
(fit zoom 0.28) with nothing on screen saying a saved layout was in
force. The staleness compounds: every drag-save snapshots the whole
canvas, hidden nodes included, so a stale entry once pinned is written
straight back.

## Decision

Two changes, separable and both view-scoped:

1. **A sidecar entry for a subject the active view does not draw is
   inert.** `applySavedPositions` pins only visible nodes. A hidden node
   keeps whatever coordinates the last layout left it, instead of being
   planted at a sidecar position from a canvas sized for the whole model —
   stale coordinates the next whole-canvas drag-save would have
   immortalised. `visible()` is the same judgement `relayoutVisible`
   already scopes by.

2. **A saved layout in force is announced, with the way out beside it.**
   Whenever the active view's sidecar names at least one subject the view
   draws, the canvas shows a standing pill — "Saved layout in force", with
   a **Discard** affordance. It is state, not an event: derived at render
   time from the sidecar and the view's match set (`savedLayoutInForce`),
   never a flag some effect has to remember to clear, and distinct from
   the transient `layoutNotice` save receipt. Discard is session-local:
   the canvas records the view as discarded, stops honouring its sidecar,
   and runs a fresh layout over what is drawn. The sidecar document stays
   on disk — deleting it is a staged, committed write (the discipline every
   other file change already obeys, ADR 0103), and inventing an unstaged
   delete path for one convenience is not worth it. A later drag-save
   re-arms the view: the reviewer's own fresh sidecar supersedes the
   discard that cleared the old one.

## Excluded options

- **Pruning sidecar entries on view save** (the issue's third candidate):
  deferred, not rejected. Duplicate-view already drops the sidecar
  outright, so precedent exists for layouts being view-scoped state, but
  pruning belongs to the view-save write path and stages a document
  change — a separate change with its own blast radius.
- **A real sidecar delete behind Discard**: it would be the only write in
  the editor that bypasses the staged changeset, or it would stage a
  deletion of a document kind the changeset machinery does not yet carry.
  The session-local unpin gives the reviewer the relayout they asked for
  now; the disk story stays with the staged-write discipline.
- **Deriving the pill from cytoscape's live visibility**: exact (a
  quick-filter keystroke that hides every pinned node would drop the
  pill), but only computable after effects run against a mounted canvas.
  The match-set derivation is a pure function of rendered state — testable
  with no canvas, honest under server rendering — at the price of the
  pill standing through a transient quick-filter that momentarily hides
  every pinned node.
- **One session-wide discard flag**: discarding view A's pin says nothing
  about view B's, and returning to A must not resurrect what was
  discarded — so the record is a set of view ids, not a boolean.

## Consequences

An experimental relayout still appears to do nothing while a saved layout
is in force — that behaviour is the feature protecting a reviewer's
drags — but the pill now says why, and Discard makes the relayout land.
When `presentation.direction` becomes editable per view, the trap this
was measured on (flip the direction, see nothing happen, no way to
discover why) is already answered. Stale sidecar entries stop being
copied forward by drag-saves of views that no longer draw them, though
the entries themselves remain until something prunes them (deferred
above). The pill claims "in force" from the match set rather than pixels,
so the one dishonest corner is a quick-filter that temporarily hides
every pinned node while the pill stands.
