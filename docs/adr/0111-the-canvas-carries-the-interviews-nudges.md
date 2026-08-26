# The canvas carries the interview's nudges

Status: accepted

The blank-canvas mode was decided long before this: a person draws first,
and the catalogue says what is undone. What was missing was the saying —
the interrogation report existed, per-subject, and the canvas drew nothing
of it. A consultant who drew five boxes had to leave the diagram and run
`design` to learn that four of them carried open questions, and the
workspace-scoped questions (`outcome-missing` and kin, which name no
subject) rendered nowhere at all.

## Decision

Each visual host computes an **interrogation overlay** per successful
recompile and ships it beside the graph in `VisualRenderedModel`:
`{ catalogue, semantics, workspace: QuestionEntry[], subjects:
Record<subjectId, QuestionEntry[]> }`, with per-subject phrasings already
interpolated. The app draws a quiet count chip on each node with open
questions, an "Open questions" section that scopes to the selected subject
(and shows the workspace-scoped list when nothing is selected), and a
presentation toggle beside lifecycle/evidence/ownership.

- **The overlay rides `VisualRenderedModel`, never `CanvasNode`.** The
  canvas-graph schema is published with `additionalProperties: false` and
  consumed directly by external products; the rendered model is the
  internal wire contract both hosts already share, forwarded whole by the
  app, so the overlay needed no reducer or schema change anywhere.
- **Derived, never stored.** The overlay is recomputed from the same
  compile the graph came from, on the same cadence (landed commits only),
  and a failed compile keeps the previous model and its overlay together.
  The stateless-interview rule (ADR 0053/0058) as the canvas sees it: a
  drafted-but-uncommitted edit moves no badge, correctly.
- **Absence-safe.** A host that computes no overlay ships none, and the
  app hides the whole surface — chips, section, and toggle target — rather
  than drawing zeros it cannot stand behind. Older and embedded hosts keep
  their exact previous rendering.
- **The catalogue's bytes are the caller's problem.** The shared
  `renderedWorkspaceOf` helper is browser-safe and cannot read files, so
  the session server hands it the shipped catalogue from disk and the
  embedded editor bundles the same file into the browser build. One
  computation, two deliveries.
- **Framing is part of the decision.** The chip uses the quiet ink token,
  never the failure palette; zero draws nothing; the language is "open
  questions". An open question is the catalogue deepening honestly
  (ADR 0063), not a defect, and a badge that reads as a grade would teach
  people to stop drawing.
- **The panel is read-only.** Answers land through the changeset and its
  compile gate, or through an agent running the interview — never through
  a text box in the panel that would bypass both.

## Excluded options

- **A count field on `CanvasNode`**: a published-schema break for every
  direct consumer of the canvas graph, to carry data that is not a fact
  about the graph.
- **Per-edit recomputation**: badges that twitch while a change is still
  a draft would claim the interview sees things the model does not hold.
- **Evaluating in the browser from a catalogue the host also has**: two
  evaluations of one question set is two answers to it; the host that
  compiled is the host that evaluates.
- **A canvas-corner pill for workspace-scoped questions**: the section's
  no-selection state shows them in the same home as everything else; one
  more piece of floating chrome bought nothing.

## Consequences

The report's `semantics` stamp travels in the overlay (ADR 0106), so a
consumer can attribute a shifted count to the engine rather than the
model. The `trigger` field (ADR 0110) is deliberately not in the overlay
yet: the panel only reads; when a canvas affordance wants to prefill an
answer form, adding the trigger per entry is one additive field.
