# The host can point at the canvas

Status: accepted

ApertureX, embedding the editor over its own store (#252), derives open
questions from the model through `yarramate/interrogation`, and each
question card knows exactly what would answer it: the report-carried
trigger ([ADR 0110](0110-an-open-question-carries-its-answer-shape.md))
says add a concept of kind K, or add a relationship of kind R with one
endpoint fixed. The editor already has those affordances — the
Add-subject dialog a palette pick seeds (#295,
[ADR 0116](0116-a-kind-is-picked-up-not-remembered.md)), the Connect
flow, tap-to-select — and a card could hand its intent to none of them:
`createLocalHost`/`mountEditor` exposed no way to select a subject or
open creation with defaults, so their cards applied answers through the
operations path beside the editor instead of driving the surface that
was mounted to be driven (#297). ADR 0110's excluded options parked a
`proposedOperations` helper for want of a concrete consumer; this is the
follow-up, with one.

## Decision

The mount's return value grows. `MountedEditor` keeps `unmount` and
gains three methods, each the programmatic twin of a gesture the surface
already has, and nothing the surface does not have:

- **`select(subjectId)`** selects the concept or relationship exactly as
  a canvas tap would — the same `subject.selected` action, the same
  graph lookup and normalization the tap handlers run — which also
  scopes the Open questions section to the subject, the point for a
  question card.
- **`openDraft({ kind? })`** opens the Add-subject dialog, the kind
  riding the same seed a palette pick rides (#295): into the form's own
  state, cleared by a plain call, the no-default rule intact.
- **`startConnection(fromSubjectId)`** arms the connection tool from the
  named subject, exactly as the inspector's Connect does. The Connect
  flow *is* the relationship-with-one-endpoint-fixed affordance the
  trigger describes, so no new UI is invented for it.

Every method answers with whether it acted. False — never a throw —
covers an id the current model does not name, a model that has not
arrived yet, a handle before the shell's first render or after disposal,
and, for the two that reach for the pen, a read-only mount (#298,
[ADR 0117](0117-a-mounted-editor-can-refuse-the-pen.md)). Selecting
stays allowed in a viewer, because selecting is reading.

The seam is a prop, not the protocol. `App` gains an optional `onReady`
through which the shell hands up a pointer built by `editorPointerFor` —
three closures over the shell's own dispatchers, reading the graph and
the posture at call time so a handle held across commits answers for the
model on screen. The mount layer keeps that pointer in a private bridge
the handle's methods delegate through. Nothing about `EditorHost` moves.

## Excluded options

- **Synthetic `VisualBrowserInput`s through the `EditorHost` seam**:
  selection and dialog state are client state, not host state — the
  protocol carries documents, filters and staged operations, not
  gestures. A `select` input would push the reducer's client concerns
  onto a versioned wire that has never carried them, and every host
  (the session server included) would have to learn to speak an input
  whose only speaker is an embedder standing beside the editor.
- **A full command bus** (a generic `dispatch(action)` on the handle):
  it would export the workspace reducer's entire action vocabulary as
  public API and freeze internals no consumer asked to hold. Three
  named methods are the asks with a consumer behind them; a fourth
  gesture, if one is ever asked for, is a fourth method delegating to
  an action that already exists.
- **Host-driven commit**: the handle points, it never writes. Everything
  the opened affordances stage still accumulates in the changeset and
  lands through the same validated `apply` batch (ADR 0102), so what a
  host can cause is exactly what a reviewer can cause — a second write
  path would put an unreviewed motion behind a reviewed surface.

## Consequences

The released return shape — an object carrying `unmount` — is extended
additively, so every existing embedder stands unchanged and the
documented `editor.unmount()` still holds. `App` gains one optional
prop; the session shell passes nothing and is untouched, as is the
`EditorHost` contract. The pointer reads live context rather than
capturing it, so ready-ness is a window the handle answers false in
rather than an error state, and a method called after a commit acts on
the graph that replaced it. `editorPointerFor` is a pure function over
the reducer's own actions, which is what keeps the programmatic twins
and the on-screen gestures from ever disagreeing about what a motion
does.
