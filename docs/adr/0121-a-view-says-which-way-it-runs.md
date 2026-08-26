# A view says which way it runs

Status: accepted

`presentation.direction` has been in `yarramate/projection/v1` since the
format had a presentation block, with exactly two values, and the LikeC4
export has always honoured it for its own `autoLayout`. The canvas did
not: `buildLayoutConfig()` pinned `elk.direction: DOWN` and took no
argument that could say otherwise.

The pin had a reason, recorded beside it: ArchiMate's layer bands only
read top-down, so a left-right run would draw bands corresponding to
nothing. That reason is right for a layer-band view and wrong for the
others. A deployment realization chain and a fan-out both read better
left to right, and the format already lets each view say so, which left
the canvas and the export disagreeing about a field they both read.
`docs/VISUAL-ADAPTER.md` said both things in two different sections.

Issue #274 also asked whether `elk.layered.nodePlacement.strategy:
NETWORK_SIMPLEX` should become the placement default, and set the bar for
answering: the crossing reduction behind the proposal was measured on one
8-subject view, so it had to be evaluated across every view before being
adopted.

## Decision

**The view decides the direction, and the default stays top-down.**
`buildLayoutConfig(direction)` takes a `LayoutDirection` and maps it
(`top-down` to `DOWN`, `left-right` to `RIGHT`). A view that declares
none is handed `DEFAULT_DIRECTION` by the caller, so the canvas never has
to decide what silence means, and the layer-band reasoning keeps the
default it earned instead of being the only answer.

- **The vocabulary is the format's, not ELK's.** `LayoutDirection` and
  `DEFAULT_DIRECTION` live in `src/layout-direction.ts`, a module that
  imports nothing, and `projection.ts` re-exports both. This is the split
  `src/nesting.ts` already makes and for the same reason: the browser
  needs the value, and importing `projection.ts` for one constant drags
  Ajv and the projection schema into the bundle. ELK's spelling is a
  lookup table inside the canvas and reaches nothing else.
- **Direction is workspace state, derived like nesting.**
  `presentationActionsFor` pushes a `direction.set` action
  unconditionally, exactly as it does for `nesting.set`: a view that
  omits the field is restored to top-down rather than left holding the
  left-right run of the view the reviewer arrived from. Restating the
  direction in force returns the same state object, because every
  identity memo downstream reads its reference.
- **There is still no direction control on screen.** The view declares
  the direction, the way it declares its nesting vocabulary. A save
  carries a declared direction through untouched, which is what it
  already did back when the canvas ignored the field.
- **A direction change re-arms the pending fit.** Direction is a variable
  again, so the arming effect watches it alongside the active view id.
  Without that, editing a view's `presentation.direction` and committing
  would leave the canvas holding the geometry of the direction the view
  no longer declares.
- **`NETWORK_SIMPLEX` becomes the placement default, on a sweep rather
  than on one view.** Measured across every authored view in this
  repository: the six contact-update journey views and the self-model's
  twenty-two, laid out headlessly through the same `graphToElements` and
  `buildStylesheet` the canvas uses, each view filtered to what its own
  query matches. Holding direction `DOWN`, against ELK's `BRANDES_KOEPF`
  default:

  | measure | BRANDES_KOEPF | NETWORK_SIMPLEX |
  | --- | --- | --- |
  | crossings, 28 views | 1888 | 1821 |
  | edge length, 28 views | 1,463,386 px | 986,581 px |
  | summed layout width | 94,216 px | 79,779 px |

  Crossings fall on ten views, rise on three, and are unchanged on
  fifteen. The three that rise are the three largest (`current-engine`
  455 to 461, `starter-landscape` 203 to 216, the whole contact-update
  view 126 to 128), and each buys those crossings with 12 to 40% less
  edge and a narrower box. The trade is taken once here for every view
  rather than offered per view: nothing in the format describes placement,
  and a second knob would need its own reason to exist.

- **The measurement is this repository's, and it does not reproduce the
  issue's table.** #274 measured one deployment view at 1101x1050 under
  `DOWN`; the deployment view in this repository's fixture is four named
  subjects and one relationship, and draws 458x386. The issue's numbers
  came from the journey workspace in the gallery rather than from the
  fixture here, and the specific "crossings 3 to 1" result is not
  reproduced by this sweep. What the sweep supports is the broader claim,
  measured on 28 views instead of one.

## Excluded options

- **A direction control on the canvas.** Direction is a property of the
  view, like its query and its nesting; a control would be a second place
  to say it and would immediately raise what happens to the value on a
  view switch. Nesting settled this question already and direction gets
  the same answer.
- **Keeping the pin and letting only the export read the field.** That is
  today's behaviour, and it makes the format declare something one of its
  two renderers silently discards. A format field that a surface refuses
  to read is a lie the author cannot see.
- **Per-view placement strategy.** `presentation` would gain a knob
  describing ELK's internals rather than the view's intent, which is the
  wrong altitude for the format. The sweep says one strategy is better
  across the corpus; if a view is ever found that needs the other, that
  finding is the reason to reopen this, not the absence of a knob.
- **Declaring `left-right` on a view in this repository to demonstrate
  it.** Several views measure better left to right (`starter-landscape`
  drops from 216 crossings to 140 and 23% of its edge length,
  `seven-verb-surface` 23% of its edge), but which shape reads better on
  a screen is a look-at-it call rather than an arithmetic one, and the
  numbers cut both ways: the same swap makes `starter-landscape` taller
  than it was wide. The mechanism ships with the measurements recorded so
  the call can be made with eyes on the canvas.
- **Rotating the component packing ratio with the direction.**
  `COMPONENT_ASPECT_RATIO` is applied in ELK's pre-rotation frame, so the
  same 2.5 lands differently under `DOWN` and `RIGHT`. The disconnected
  packing test now runs both ways and both stay grids, so there is
  nothing to correct; a per-direction ratio would be two numbers where
  the evidence supports one.

## Consequences

`buildLayoutConfig` and `relayoutVisible` each gain a required parameter,
both internal to the visual app. `GraphCanvas` gains a required
`direction` prop, and the workspace state a `direction` field with its
`direction.set` action. Nothing in the wire protocol, the projection
schema, or the CLI moves: `presentation.direction` was already declared,
already validated, and already exported, and this is the surface that
starts reading it.

Every existing view keeps the layout it had, since none of them declares
`left-right` and the default is what was pinned. What does change for
every view is placement, which is why the measurement is recorded here
rather than in a commit message.

One unrelated repair rode along, because it made the file unreadable to
the tools that would review this change: `graph-canvas.tsx` carried two
raw NUL bytes in a template literal used as a pair key, so `grep` and
`file` classified the largest UI module in the repository as binary and
silently returned nothing for every search. They are now `\u0000`
escapes, which is the spelling the badge cache key a few hundred lines
above already used, and the built string is byte-for-byte the same.
