# The host can choose the view

Status: accepted

The yarramate.dev home page (#523) is a run of screens, each showing one
feature of the editor and each linking into the editor at the place it
shows: the current-state view, a subject with its open questions, the
text drawer. The handle a mount returns can point at a subject
([ADR 0118](0118-the-host-can-point-at-the-canvas.md)): `select`,
`openDraft`, `startConnection`. It cannot point at a view. A page that
wanted `/editor?view=current-state` to open on that view had two
choices: find the rail's row in the DOM and click it, which binds the
site to markup that carries no contract, or leave the parameter unserved.

## Decision

Two additions, in the shape ADR 0118 set: each the programmatic twin of
a gesture the surface already has, and nothing the surface does not
have.

- **`MountOptions.view`** names the projection to open on once the
  model arrives. It is applied once, when the first model lands, and
  through the same navigation the rail runs, so the host is told where
  the reviewer starts exactly as it is told where they go. An id the
  model lists no view under is ignored, and the editor opens on its
  initial view as it always has.
- **`MountedEditor.showView(viewId)`** opens the named view exactly as
  picking it in the rail does. The rail's own function does both halves
  of that move, the local `view.navigated` and the `navigate` word to
  the host, so the pointer calls that function rather than dispatching
  either half itself. It answers `false`, never throws, for an id the
  model lists no view under and before the model arrives. Choosing a
  view is reading, so a viewer (`readOnly`,
  [ADR 0117](0117-a-mounted-editor-can-refuse-the-pen.md)) accepts it.

The pointer's context grows a `views` list for the refusal to read from,
the way it reads the graph to refuse an unknown subject.

## Consequences

- The site's deep links serve `view=` without touching the editor's
  DOM, and the option outlives any change to the rail's markup.
- `EditorPointerContext` gains a required `views` field; the shell
  constructs it and the tests do, nobody else. `mountEditorWith` gains a
  trailing optional parameter; every existing call stands.
- The host hears an opening navigation it did not see a reviewer make.
  That is the same word it hears for any navigation, marked as not
  requiring attention, and a host that cares which views a reviewer
  reads now also learns where they started.

## Excluded

- Selecting a view by title or path. The rail keys on the projection id
  and so does every wire frame; a second key would be a second thing to
  keep in step.
- A `view` that waits for a later model when the first does not list
  it. Once is the rule the option states; a host that adds a projection
  after mount has `showView` for the moment it lands.
