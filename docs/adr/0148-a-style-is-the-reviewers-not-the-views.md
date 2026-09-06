# A style is the reviewer's, not the view's

Status: accepted

Nabeel asked for the canvas to be modernised and to see the possibilities in
yarramate-visual itself rather than in mock-ups. Four dresses were built behind
a Style select on the reference model, looked at, and the decision was to keep
all of them and let the reviewer choose - the same ruling as for layouts
([ADR 0147](0147-a-layout-is-a-way-of-reading-and-the-reviewer-picks-it.md)),
with one difference in where the choice lives.

## Decision

**The canvas has five dresses; the reviewer picks one, and the browser
remembers it. No view carries a style.**

- **`current`** is what shipped: ArchiMate pastels, 2px borders, grey edges
  with boxed labels. It appends nothing to the stylesheet, so the base rules
  alone still decide the picture.
- **`drafting`** carries the shell's own vocabulary onto the canvas:
  paper-tinted fills, hairline ink rules, the body face, monospace edge
  readings with a paper halo, uppercase monospace container titles.
- **`ink`** is line-first and print-ready: white subjects, the layer carried
  by a coloured 1.5px border, ink edges, no boxes anywhere.
- **`tinted`** puts a contemporary muted palette in place of the pastels, 8px
  corners, slate edges, edge readings on small pills.
- **`dark`** is a dark ground with deep layer tints, light ink, and light
  glyphs - the notation's glyph strokes take an ink parameter for it, and
  nothing else about them moves.
- **A dress changes nothing that means anything.** Shapes by aspect,
  arrowheads by kind, glyphs, badges and label wording are the notation's and
  stay; a preset is a list of stylesheet blocks appended after the base and
  notation rules and before the marks, so it wins on colour, weight, face and
  radius and on nothing else. The three modern dresses also draw selection as
  a 2px accent with a soft glow, and give passive-structure subjects their
  header band in their own layer's colour.
- **The style is remembered in the browser** (`localStorage`,
  `yarramate-visual.style`), never written into a projection or the layout
  sidecar, and untouched by a view switch. Layout and direction are part of
  what a view means and a save writes them; a dress is about the reader's eyes,
  and two readers of one view may want different ones. A browser with no
  storage, or one that refuses it, opens on `current` and still draws the pick
  for the session.

## Consequences

- A host that mounts the editor gets the Style select with the other two; the
  pick lives in the host page's origin storage.
- `dark` dresses the canvas alone. The shell around it stays on paper; a dark
  shell is a separate decision about the whole workspace.
- Adding a dress is one entry in `src/visual-app/style-presets.ts`; the tests
  hold every dress to recolouring every layer the notation knows.

## Excluded

- **`presentation.style` on the view.** It would make one reader's preference
  every reader's, and a save from a dark-mode reviewer would restyle the view
  for the team.
- **A style as a stylesheet swap.** Presets append rather than replace, so
  the marks (faults, decorations, selection precedence, ADR 0119) and the
  notation stay authoritative under every dress.
