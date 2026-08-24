# Changelog

## 1.0.0

- **Added.** View CRUD from the rail's context menu (#246): **Rename**,
  **Duplicate**, **New view in this folder**, **Copy projection path**, and
  **Export PNG** on the canvas. Rename and duplicate stage a row like every
  other change, so both are visible before they land and undoable after.
  **A rename changes what a view is called and moves nothing**: a projection's
  id decides its filename *and* keys its layout sidecar
  (`.yarramate/visual-layout/<id>.yaml`), so a rename that carried the id along
  would silently orphan the positions the reviewer dragged. Duplicating keeps
  the source's folder and takes a free id; it does not inherit the layout,
  because that is keyed by id and a copy is a different view.
  A view saved *in this folder* names its folder by pointing at a view already
  in it, which is also what makes the folder one the manifest demonstrably
  reaches.

- **Breaking.** Saving a view is a staged change, not a write. `view.save` is
  gone, and a commit carries `viewOperations` beside its model operations
  (`yarramate/visual-protocol/v5`, ADR 0103). Saving used to compose a
  projection and `writeFileSync` it the moment the reviewer pressed Save:
  outside the changeset, so it could not be undone; outside ADR 0093's
  staleness pin, so it overwrote a projection someone else had edited without
  noticing; and outside the batch, so a view and the subjects it shows could
  not land together. All three are closed by one mechanism, and the
  confirm-before-overwrite dialog goes with them — a staged overwrite is a row
  the reviewer can read and discard before it lands, which is a better answer
  than a dialog. **Delete a view** from the rail's context menu, behind the
  same rule every model-destructive item sits behind.

- **Breaking.** A `PendingWrite` with a `null` source removes the document
  (ADR 0103). `SourceStore` could create and replace but not remove, so nothing
  in the engine could take a document away and a view rename — a write plus a
  removal — could not be expressed at all. A removal lands in the same
  all-or-none batch under the same compare-and-swap, and must name the revision
  it was staged against: `expected: null` on a removal asks to remove a
  document on condition it is not there, and is refused rather than treated as
  a success.

- **Added.** A commit lands the model and the views as **one** `store.writeAll`.
  `landOperations` splits into `planOperations`, which returns the writes a
  batch would make, and the visual runtime merges its projection writes into
  that batch — so a view and the subjects it shows arrive together or not at
  all, without making a presentation artifact into a semantic operation.
  `yarramate/operations/v1` is unchanged, and Core keeps its invariant that a
  projection is never an operation's own target.

- **Added.** A view saved where the manifest's patterns cover no projection is
  refused rather than written. This repository's own manifest uses
  `projections/*.yaml`, which reaches no subdirectory, so the first view saved
  into a folder would otherwise be a file the workspace silently never loads
  (ADR 0043 names the same trap for `new projection`).

- **Fix.** Pressing Commit on a changeset holding only a staged view did
  nothing, and said nothing about why: the button's guard asked whether the
  model's operation list was empty rather than whether the changeset was. Found
  by staging a view in a browser and pressing the button, not by any test.

- **Added.** Right-click menus on a subject, a relationship, the empty canvas
  and a row in the rail. Every one of them obeys one rule: **operations that
  edit the view are separated from operations that edit the model**, under
  named headings, with anything model-destructive last, behind a firm rule, in
  `--failure`. Removing a subject from a view rewrites one projection and
  leaves every other view alone; deleting it from the model takes every
  relationship naming it and changes every view that drew it, and rendered as
  neighbours in a flat list the second is one slip away from someone who meant
  the first. Deleting still goes through the confirmation the side panel
  already used, so the menu adds a way to ask and no way to skip being asked.
  What a menu offers is a pure function of the model (`contextMenuFor`)
  returning intents rather than callbacks, so what a right-click puts on screen
  is something a test can read.

- **Fix.** Re-typing a relationship offers only the kinds the endpoint pairing
  permits. The properties form offered the profile's whole relationship
  vocabulary, so turning `applicationComponent --serving--> businessActor`
  into a `composition` was one click away and the `YM404` only arrived at
  commit - while the connection tool two files over had always narrowed to
  `connectableKinds`. The same narrowing now covers the form and the new menu,
  and the kind an edge already carries is always offered, because a model
  authored outside this editor is not the editor's to silently rewrite.

- **Added.** `VisualKindOption` carries `coreLabel`, the core-profile kind an
  option descends from, resolved through the profile's declared lineage exactly
  as a canvas subject gets its own `coreKindLabel`. Without it a browser could
  read a palette but not judge it: the ArchiMate table is keyed on core kinds,
  so an extension kind had to be offered unchecked, and this repo's own
  `implements` was offered on every edge including the pairings where the
  `realization` it descends from is refused. It is now offered exactly where
  that ancestor is permitted.

- **Added.** The saved views and the whole model are a tree in a left rail,
  replacing the flat `<select>` that sat in the command strip. That control
  held every view at one level and could do nothing to a view but open it; a
  workspace with twenty projections was a twenty-item dropdown. The rail has
  two roots, the way Archi does: **Views**, foldered and collapsible, each row
  stating how many subjects its query matches, and **Model**, every subject the
  workspace declares grouped by layer with its layer swatch. A subject the
  active view leaves out is still listed, quietened and marked `not in view`,
  because the model is what there is to draw rather than what is drawn, and
  selecting one opens its properties whether or not the canvas holds it. A
  filter box narrows both roots at once and is separate from the quick filter,
  which goes on narrowing the canvas. **View folders are derived from
  projection paths, and the projection format gains nothing**: a workspace
  whose projections all sit in one directory shows no folders, and one that
  sorts them into `current/` and `target/` gets those two, which needs only a
  manifest pattern that reaches into subdirectories. `VisualViewSummary` now
  carries the `path` those folders come from and a `subjectCount`, and every
  `model` frame carries the view list again, recounted: a count is not a
  property of a projection document but of what its query matches here, so
  landing a changeset moves it.

- **Fix.** A view's subject count states its concepts, not its concepts and
  relationships together. A `SemanticGraph`'s subjects are both, so the number
  taken from a query's match set read five for a view over three application
  components with two relationships between them, and a reviewer counting
  boxes on the canvas found three. This was caught by looking at the rail in a
  browser, not by any test.

- **Breaking.** A subject id is the authored id, unique across the workspace,
  with no `<document-id>#` prefix and no local-versus-qualified distinction
  (ADR 0099, superseding ADR 0005). The prefix namespaced ids nobody had
  collided on - zero collisions across the nineteen workspaces reachable here,
  including all six gallery showcases - while binding identity to file layout,
  so moving a subject between documents was a rename to be chased through every
  projection, mapping, evidence pointer and brief. New `YM314` refuses a
  workspace where two documents declare one id, and that refusal is what makes
  the shorter form safe rather than a merge of two subjects; a repeat inside one
  document stays `YM301`. Migrate with
  `node scripts/flatten-subject-ids.mjs <workspace.yaml> [extra-file ...]`,
  which strips only a prefix naming a document of that workspace, leaves kind
  identities like `yarramate/core@0.1#goal` alone, and refuses to write anything
  at all if it finds a collision. Name any file that references subjects without
  being listed in the manifest, such as an adapter's project definition.

- **Fix.** A subject you create appears on the canvas that created it. A filter
  is resolved against the model the server held when it was asked, and a landed
  commit replaces that model. Nothing re-asked, so the matched set went on
  describing the graph as it was: the subject the reviewer had just made was
  not in it, and the canvas hides every element the matched set does not name.
  The commit reported `Committed - 1 file`, the bytes landed, and the diagram
  did not change. It needed no unusual view and no stale projection, only a
  filter resolved once, which is every view a session opens on; the one case it
  never reached was an unfiltered canvas. Confirmed against a view whose query
  genuinely matches the new subject, where navigating away and back revealed
  it: same view, same query, same model, only the re-asking differed.
  The browser now re-asks its standing filter off the `model` frame that
  invalidated it. That is a consequence of a frame arriving rather than of a
  render, so it lives beside the rest of the frame handling as a pure function
  (`filterToReresolve`) instead of in an effect: the same frame that
  invalidates a matched set is the thing that asks for a new one. Only a
  `model` frame qualifies, since a `filter-result` is the answer and re-asking
  off it would never stop. Whichever query is standing is the one re-asked,
  under the source that asked for it, so a reviewer holding their own filter
  does not have the view's query put back underneath them and a chat-issued
  narrowing does not start reporting itself as the reviewer's own (#251).
  The test that missed this asserted on `state.model.graph`, which was correct
  the whole time. What was wrong is what the canvas *draws*, which is that
  graph narrowed by the matched set, so the canvas is what the new tests
  assert on.

- **Breaking.** One notation. The canvas draws ArchiMate, and `native` is
  removed rather than demoted: `presentation.notation` admits `archimate`
  alone, and a projection asking for `native` is refused rather than quietly
  drawn as something else. The field stays an enum for the same reason
  `layout` did when `radial` and `force` went, so a second notation has
  somewhere to land (ADR 0087 is unchanged: notation is a rendering field with
  no effect on the semantic model). Every node now carries its kind glyph and
  takes its shape from its aspect, and every edge its line and arrows from its
  core relationship kind, because none of that is a mode any more.
  The notation picker and the direction toggle both leave the command strip.
  The direction toggle goes because it had nothing left to do: ArchiMate's
  layer bands only read top-down, so the canvas already pinned `elk.direction`
  to `DOWN` and the control was inert whenever ArchiMate was on.
  `presentation.direction` itself stays in the format, because the LikeC4
  export reads it for its own `autoLayout` and draws no bands. A save now
  carries a view's declared direction through untouched instead of writing the
  canvas's own, which is what stops removing the control from silently
  discarding a value the reviewer never saw; and a save writes no `notation` at
  all rather than stamping the only one onto every projection it touches
  (#250).

- **Breaking.** One layout backend: `presentation.layout` admits only
  `layered`, and `presentation.seed` is gone (ADR 0086 carries a supersession
  note). `radial` (cytoscape `concentric`) and `force` (elk `stress` then
  `sporeOverlap`) were measured against `layered` on every view of the
  contact-update journey and lost on all three counts that decide whether a
  diagram can be read: edge crossings, total edge length, and how large the
  graph draws once fitted to the canvas. `seed` goes because only `force` ever
  read it, yet the projection schema required a seed of every view declaring a
  layout at all, so declaring a layout no longer obliges a view to invent a
  value it has no use for. `force` was the only asynchronous backend, so its
  apparatus retires with it: the busy notice, the two-pass chain, the
  paint-first frame yield, and the in-flight guard that let a newer request
  supersede a running one, none of which a single synchronous pass can need.
  The Layout picker goes too, having nothing left to pick. `layout` stays an
  enum so a replacement mechanism has somewhere to land. First paint also now
  uses the layout the view settles into: mount laid out every element before
  the structural filter result landed, then hid the ones the view excludes,
  leaving the survivors spread across a layout built for a graph no longer on
  screen. Measured on the solution view, first paint spanned 1910x2958 with
  25,235px of edge at fit zoom 0.34, against 922x2584 and 21,335px at 0.39
  once any control was touched: more than twice as wide for the same twenty
  nodes. Relaying out when the matched set changes closes it (#219).

- **Breaking.** `applyOperations` is a pure function from sources to sources
  (ADR 0100). It takes an `ApplyInput` - the resolved workspace, every source
  that workspace resolves to, the operations document, and where the manifest
  sits - and returns the documents it changed rather than writing them. It
  reads no file and writes none. `landOperations(store, input)` is the
  composition both callers use: read the workspace through a `SourceStore`,
  apply, and write back only what still holds what was read. Both are exported,
  with `ApplyInput` and `ApplyOutcome`, so an engine embedded over D1 or an
  object store can be handed its own sources.
  This closes a gap ADR 0093 left open. The visual runtime pinned a digest per
  document and refused a batch whose pin no longer matched, but the check sat
  in the adapter and the write sat in Core with a whole workspace compile
  between them, so a write landing in that window was overwritten by a batch
  that had already proved it was current. The pin stays, unchanged, along with
  `YMVS312` and `YMVS313`; the store's comparison now runs immediately before
  the bytes land, so nothing can move in between. New `YM704` refuses a batch
  whose document changed or was removed after it was staged, and `YM705` one
  that expected to create a document already there. `apply` from a terminal,
  which had no precondition at all, now has this one (#231).

- **Breaking.** Relationship endpoints are validated against the ArchiMate
  3.2 relationship table (ADR 0097), vendored from Archi's `relationships.xml`
  (MIT) and regenerated into a zero-import module a test keeps honest. The
  four aspect rules from ADR 0004 accepted 64% of the kind-pair combinations
  the table rejects and refused 1,803 it permits, `triggering` between
  active-structure elements among them; a workspace carrying a forbidden
  edge now fails `check` with `YM404`, which names the pair and the kinds
  the table does permit. The repository's own model carried 13 such edges
  and the shipped fixtures 12, every one a folded field or a direction
  error. Migrate with `access` where behaviour produces passive structure,
  `artifact -realization-> dataObject` where a file gives a data object its
  form, `node -realization-> applicationComponent` for "deployed on", a
  swapped direction where a capability was realized by what it realizes,
  and `association` where nothing stronger carries the meaning. New `YM414`:
  every relationship on one junction must be the same kind. Product,
  plateau, and gap are composite, and only grouping draws dashed.
  `ask --kinds` reports the aspect shadow for all eleven kinds and the packed
  table as `relationshipMatrix`. `inspiredBy` values read `archimate:`.
  Catalogue `core-enrichment` goes to 1.0 (ADR 0098): seven questions that
  prescribed forbidden shapes are retargeted, the application service joins
  the interaction wave and is asked what data it accesses, and
  `kind-untested` asks whether a subject's relationships would survive
  reclassification to another aspect. The skill retires the degraded-edge
  pattern. Positioning: the core profile implements the ArchiMate vocabulary
  and relationship table; the custody layer is additive; not affiliated with
  or certified by The Open Group.
- **Breaking.** Visual session paths are published as canonical local `file:`
  URIs rather than bare path strings (ADR 0096). `sessionRoot`,
  `descriptorPath`, `journalPath`, and `transcriptPath` are encoded with
  `pathToFileURL` and decoded with `fileURLToPath`, refusing anything
  malformed, nonlocal, or noncanonical as `YMVS414` before a descriptor's
  bearer capabilities are read. This closes two defects the old
  backslash-to-slash transform could not: two distinct native paths could
  produce one indistinguishable wire string, and a UNC path passed as an
  ordinary local one. `yarramate/visual-protocol/v3` becomes `v4`;
  `visual-session-started`, `visual-session-descriptor`, and `visual-handoff`
  become `v2`; the eight documents that carry no path stay at `v1`. A v3
  document is refused, never translated. `yarramate-visual
  wait|respond|status|recover|stop` now take the exact `descriptorPath` URI
  `start` published, copied back verbatim: a native path is refused, and the
  argument is no longer resolved against the working directory (#208).

- A `SourceStore` names where a workspace's sources come from and where they go
  back to, exported as `createFileSystemStore` with `SourceStore`,
  `StoredSource`, `PendingWrite`, `WriteConflict` and `WriteOutcome`
  (ADR 0100). It is `list`, `read` and `writeAll`, and a revision is opaque
  outside the store that minted it: a content hash here, an ETag or a
  rowversion elsewhere, compared only for equality and only by its issuer.
  There is no unconditional write, because a caller with nothing to state is
  the caller that cannot detect a conflict; `expected: null` requires that the
  document not exist yet. `writeAll` checks every expectation before moving a
  byte, so a batch whose last document is stale does not leave its first one
  rewritten, and each file lands whole through a staged write and a rename.
  The batch as a whole is not atomic on a filesystem, which is stated rather
  than implied. Nothing in the engine uses it yet: this is the seam, ahead of
  the callers moving onto it (#230).

- A LikeC4 project generated before 1.0 is regenerated rather than refused.
  Its marker records a comparison's endpoints in the qualified
  `<document>#<local>` form, which `subjectIdentity` no longer admits in either
  marker version, so `export-project` and `export-project --check` rejected it
  as "not a YarraMate-generated project" - a message about the wrong thing,
  since the directory is one we wrote and the ids in it are recorded metadata
  rather than addresses anything resolves. Continuous integration never saw
  this, checking out clean with no prior output directory, so it fired only for
  people who already used the tool, on their first command after upgrading.
  Such a marker is now accepted where an existing project is read, exactly as a
  marker written before output digests existed is, and the next write upgrades
  it with nothing for the reader to do. `--check` reports the project stale and
  safe to regenerate, which is the truth it always had (#225).

- A view says what nesting means in it. `presentation.nesting` names the
  relationship kinds that draw as containment, in precedence order (ADR 0101),
  defaulting to `[composition]` - the behaviour that shipped, now stated rather
  than assumed - with `[]` drawing everything as a line. `assignment` may now
  nest, so a component's functions and processes draw inside it the way
  ArchiMate renders them, instead of scattering as lines the reader
  reconstructs edge by edge.
  Nesting was widened this way rather than outright because a nested box
  carries no label saying how it got there: with two kinds nesting, an inner
  box means either "is a part of" or "is behaviour performed by" and nothing on
  screen separates them. Declaring the vocabulary makes that a choice rather
  than an accident, and a view naming one kind has no ambiguity to resolve. A
  child claimed by two kinds nests under the earlier-listed one; two claims at
  the same precedence naming different parents stay undecidable and draw
  unnested with every claim still a line, as does a nesting cycle, which a
  mixed vocabulary can form where composition alone could not. Assignment never
  nests a service whatever the view says, because a service is the promise the
  layer above consumes and burying it inside its provider inverts what it is
  for; that declines to draw a containment rather than to accept the model,
  since the ArchiMate 3.2 table permits the relationship. Unlike the
  presentation toggles, a view that declares no nesting is restored to the
  default rather than inheriting the previous view's (#233).

- A canvas node carries `coreKindLabel`, the core-vocabulary kind it resolves
  to, the way an edge already carried its own. The ArchiMate relationship
  table is keyed on core kinds, so anything deciding what may connect two
  nodes needs the core ancestor rather than the profile kind the concept was
  authored as. `yarramate/visual-graph/v1` gains the field on `canvasNode`;
  nothing is removed or renamed.
  This is what a connection tool rests on, and the property it rests on is
  held here rather than in the tool, because it is about the table and the
  compiler agreeing and neither knows a tool exists: across a spread of kind
  pairs, every relationship kind `permittedRelationshipKinds` offers compiles
  without `YM404`, and every kind it withholds is one the compiler actually
  refuses. An editor offering exactly that set cannot draw an edge the
  compiler would reject, and cannot hide a legal one either. `association` is
  always among the offered kinds, so no pair is a dead end (#234).

- `YM302` says what became of a reference written the way ids read before 1.0.
  Flattening subject ids is the change most likely to produce an unresolved
  reference, and `<document>#<local>` is too far from `<local>` for an
  edit-distance suggestion to reach, so the one migration everybody performs
  got the one message that said nothing beyond the address it could not
  resolve. It now names the cause and the id that exists. A reference whose
  local part is also unknown gets no such hint, because a false one is worse
  than none. The diagnostic also suggests a near miss now, which it never did
  before: a plain typo was as silent as a migration (#235).

- Drafting a relationship between two subjects on a canvas, as pure functions:
  `connectableKinds`, `proposeRelationshipId` and `draftRelationship`. The
  first returns what the ArchiMate table permits between two rendered nodes,
  read through each one's core kind so a model using a profile gets a palette
  rather than nothing. The second proposes `<from>-<kind>-<to>`, which reads as
  the sentence the relationship makes and is already a valid id, stepping to a
  numeric suffix on collision because the id is authored text a human reads in
  a diff. The third returns the `add-relationship` operation, into the source
  subject's document, and returns `null` for a kind the table does not permit
  rather than trusting the caller to have filtered first - the guarantee has to
  hold for any caller, not only a careful one.
  These hold no React, so what an editor would produce is compiled rather than
  asserted about: every kind the palette offers is drafted, applied through
  `applyOperations` and compiled clean, with no filesystem involved anywhere
  now that Core is pure (#236).

- A connection tool. Selecting a subject offers **Connect**; the next subject
  named on the diagram becomes the target; the panel offers the relationship
  kinds the ArchiMate 3.2 table permits between the two, and choosing one
  stages an `add-relationship` into the source subject's document. Until now
  the browser could only update a subject that already existed.
  The reviewer cannot draw an edge `check` would refuse with `YM404`: the
  palette is `permittedRelationshipKinds`, the same lookup the compiler
  performs, and `draftRelationship` refuses a kind outside it even if a caller
  offered one. Naming the source again backs out, because a subject related to
  itself is a mis-click far more often than an intention. An empty palette can
  only mean an endpoint outside the ArchiMate vocabulary, since a pair the
  table knows always permits `association`, so the panel says that rather than
  showing an empty list. Selection rather than dragging, so every step is a
  state transition a test can make and a keyboard can reach (#237).

- Adding a subject. **Add subject** opens a form over the canvas taking a name,
  a kind and a document, and stages an `add-concept`. The kinds are the
  workspace's own vocabulary, already sent with every model frame, so nothing
  in the browser decides what a workspace may contain; the document defaults to
  the selected subject's and any declared document may be chosen. Until now the
  canvas could connect two subjects but not bring one into existence.
  The id is derived from the name rather than asked for, and shown before the
  subject lands: an id is a stable address a human reads in a diff, a reviewer
  thinking about a name writes worse ids than a transliteration does, and a
  derived address the author never saw is one nobody agreed to. `Order Intake
  (v2)` becomes `order-intake-v2`. Two kinds of name are refused rather than
  mangled: one no id can be made of, and one that would start with a digit,
  since `2FA Gateway` would otherwise become `fa-gateway` and stop naming the
  thing. Adding and connecting are alternatives rather than layers, so a click
  on the diagram always belongs to exactly one of them (#238).

- Deleting from the canvas, which completes the four motions the write surface
  has had since ADR 0069 and the canvas had none of. **Delete** on a selected
  subject or relationship asks first, because this is the one motion that
  removes authored text.
  Deleting a subject stages every relationship naming it in the same batch.
  `apply` will not remove a subject something still references and evaluates
  that against the post-batch state, so the two go together or neither does;
  composing that batch is the point, since a reviewer would otherwise have to
  find every relationship touching the subject by hand and the canvas already
  knows them. The confirmation names what else still holds the subject, an
  `owner` or a `supersedes` or a constraint, and warns rather than refuses: the
  list is derived from what a canvas holds, a canvas does not hold everything
  that can reference a subject, and treating it as authoritative would block
  deletions that would land (#239).

- **Fix.** The visual app did not load at all. `DEFAULT_NESTING` was defined in
  `projection.ts`, which loads Ajv through `createRequire`, and importing that
  one constant for its value put `(0, cre.createRequire)(import.meta.url)` in
  the browser bundle, where it is not a function: the app failed to mount and
  the page was blank. It had been broken since the constant was introduced,
  through four subsequent merges, because every test runs in Node and a bundler
  has no opinion about it. `NestingKind` and `DEFAULT_NESTING` now live in
  `nesting.ts`, which imports nothing, and `projection.ts` re-exports them.
  A test now walks every value import out of `src/visual-app` and fails on one
  that reaches `node:`, naming the chain that got there.

- **Fix.** Adding a subject could never have worked. The form offered each
  kind's wire identity, `yarramate/core@0.1#applicationComponent`, where a
  document names a kind the short way, so `apply` refused every commit with
  `YM401 Unknown concept kind`. The editable inspector had always used the
  short label; this form did not. The form also defaulted to the first kind
  alphabetically, `andJunction`, so a reviewer who typed a name and pressed Add
  made a junction by accident; it now asks for a kind and stays disabled until
  it has one (#240).

- A refusal is visible on the canvas, or it is counted (ADR 0102). Core
  populates a diagnostic's `subjects` wherever its pointer identifies one,
  precisely so a drawing consumer can mark the element a rule refused, and it
  is derived where a result is published so compiler diagnostics stay a pure
  function of the model. `check` had always called it. **The visual session
  server never did**, so every diagnostic it sent a browser arrived anchored to
  a byte offset a browser cannot use, and the one consumer the derivation was
  written for was the one that never received it. It does now, and
  `VisualDiagnostic` carries the field.
  A refused commit now marks every subject it named on the diagram, and the
  changeset tray states how many of its problems could be marked and how many
  could not: `2 problems: 1 marked on the diagram, 1 not on it.` Marking the
  ones that can be marked and staying silent about the rest is how a reviewer
  learns the report is unreliable, so the count on screen is always the whole
  count. A subject the active view does not draw counts as not on the diagram,
  because calling it marked would promise a mark that never appears. The mark
  is applied by its own effect rather than with the selection highlight, so
  inspecting a refused element cannot erase the evidence (#241).

- **Fix.** A refused commit marks the subject it is actually about. `subjects`
  was derived by the visual session server from the documents on disk, but a
  refused batch never wrote to those, so the bytes the derivation read were not
  the bytes the diagnostics were located against. A subject the batch added sat
  past the end of the authored array and resolved to nothing, so the canvas
  marked nothing and the tray counted the refusal as not on the diagram: the
  whole of what #241 fixed, undone one layer down, for the commonest refusal a
  reviewer meets. Worse, a batch that also deleted a subject shifted every index
  below it, so the refusal named a subject the reviewer never touched while the
  one at fault showed clean. The derivation moves into `applyOperations`,
  against the candidate sources its compile gate was actually shown, which is
  the only place those indices agree. It stays where a result is published
  rather than inside `compileWorkspace`, so compiler diagnostics remain a pure
  function of the model, and `check` is unaffected because
  `withDiagnosticSubjects` leaves a diagnostic that already names its subjects
  alone (#242).
  Both faults were found by the test that closes #242, and neither could have
  been found without it. The commit path is now walked end to end by the
  browser's own code: the palette is the one the session sent, the operations
  are the ones the drafting modules build from it, the staged set and its pins
  are the ones the real reducer holds, the frame is the one
  `visualBrowserInputFor` mints, and the refusal is read back through the same
  reducer the canvas marks from. Nothing in it is shaped by hand, which is the
  point: the three defects of #240 and #241 all had the shape of a test
  supplying the right-shaped input rather than the one the application produces.
  A commit of one subject per concept kind the palette publishes, all 62 in one
  batch, also proves the vocabulary a canvas offers is one a document can
  actually name.

- `apply` accepts an operation's `document:` as the manifest names it. The
  address was resolved only against the working directory, so the
  manifest-relative form an author naturally writes was refused whenever the
  manifest did not sit in the working directory, which is the standard
  `.yarramate/` layout that `init` produces and every gallery showcase uses. It
  also made an operations document non-portable, applying from one directory
  and failing from another. Both readings are now tried, manifest-relative
  first, and only a path that actually names a document of this workspace is
  accepted, so admitting the second form cannot make an address ambiguous. The
  working-directory form keeps working deliberately, because the visual session
  server addresses documents that way while running with the workspace root as
  cwd. A refusal now also names the documents the workspace declares, up to
  five, instead of only saying the address was wrong (#216, #221).

- A published diagnostic names the subject it is about. Results carry
  `subjects`, most relevant first, wherever a diagnostic's pointer identifies
  one, so a consumer that draws the model can badge the element a rule refused
  instead of resolving a byte offset. It is derived in one place from the
  pointer the diagnostic already carried, so no rule has to remember to name
  what it refused and none of the forty-odd construction sites change. The
  derivation runs where the result document is published rather than inside
  `compileWorkspace`, which keeps the compiler's diagnostics a pure function of
  the model, and is not only a layering preference: enriching the compile path
  broke 23 existing tests that legitimately assert exact compiler output and
  had nothing to say about subjects. Absence is meaningful rather than "not yet
  populated" - a diagnostic that carries no subject is one that belongs to no
  subject, such as a YAML parse failure, a whole-document schema violation, a
  projection's own definition, or a manifest - which gives a UI a complete
  rule: subjects present, badge those elements; subjects absent, route to the
  document lane, the view's properties, or a workspace banner. Only documents
  something was actually said about are parsed, so a clean workspace pays
  nothing (#220).

- `apply` no longer refuses a document whose target field is a block scalar.
  Every `>-` or `|-` field failed with `YM101 Nested mappings are not allowed
  in compact mappings` and wrote nothing, on documents `check` accepts, and
  that style is the idiomatic one in every shipped model, so in practice
  `apply` could not update the description of most real subjects. A block
  scalar's YAML range ends after its terminating newline where a plain
  scalar's ends at its last character, so splicing the range wholesale
  swallowed the line break and glued the following field onto the value's
  line, which then failed to reparse. The splice now puts back whatever
  trailing newlines the replaced range occupied, so both scalar styles behave
  identically, and the value-replacing splice behind `appendListField` uses it
  too so the same class of bug cannot recur there (#215, #217).

- A compound container keeps its own presentation. `archimateNodeShapes` built
  one `node[aspect = "..."]` rule per aspect and appended them after
  `node:parent` in the same array, so for any container whose own kind shares
  that aspect the later rule's plain `rectangle` won the cascade and silently
  undid `node:parent`'s `roundrectangle` and dashed border: a compound box
  rendered as whatever aspect its own kind happened to be rather than as a
  container. Scoping each aspect selector to `:childless` confines it to leaf
  nodes. A container does draw its own kind glyph, which an earlier suspicion
  of a cytoscape limitation on `background-image` for compound nodes had put in
  doubt; the `background-image-opacity: 1` pin added for that goes as a no-op
  resting on a mechanism that does not exist, since image alpha comes from that
  property alone, it already defaults to `1`, and neither `drawImages` nor
  `drawInscribedImage` carries an `isParent` guard. The glyph is 14px in the
  corner of a large dashed box, which is the likeliest reason it read as
  absent. Ships with the `contact-update` journey fixture the bug was found on
  (#212).

- Every core concept kind draws a glyph. Only 17 of 62 had one in
  `BASE_KIND_SVG`, and the rest fell back to `glyph: null`; since shape and
  colour are driven by aspect and layer rather than by kind, that left
  same-aspect siblings visually identical, an `applicationInterface` next to
  its owning `applicationComponent` reading as the same blank rectangle in the
  same colour. The remaining 45 are added, and silhouettes are reused
  deliberately across layers - two overlapping circles for every
  `*Collaboration`, a lollipop for every `*Interface`, a forward arrow for
  every `*Process`, opposing arrows for every `*Interaction`, a pointed
  pentagon for every `*Event`, the existing pill for every `*Service` - so a
  kind reads the same regardless of which layer colours it, matching
  ArchiMate's own convention. The notation coverage test now asserts a glyph
  for every core concept kind rather than for the original 17 (#210, #211).

## 0.23.0

- Interrogation: `has-linkage`, `exists-linkage` (`direction` includes
  `either`), `missing-constraint`, and `missing-flow-content` conditions.
  Questions that name kinds from a profile no document has selected are
  omitted from the report rather than reported closed or stuck open.
  `no-subject-of-kind` honours `kindMatching` (default `descendants`), a
  loosening of `outcome-missing`, `stakeholders-missing`,
  `constraints-missing`, and `no-service-declared` for profile-derived
  kinds.
- Ship `yarramate/policy@0.1` as a built-in optional profile (ADR 0095):
  `authentication-constraint`, `rate-limit-constraint`,
  `reliability-constraint`, `mechanism-constraint`. Select it on a
  document; do not copy a file. Catalogue `core-enrichment` 0.9 adds an
  `interaction` wave before business so hop questions rank ahead of
  `owner-missing`.

## 0.22.0

- Export a Workers-safe visual-graph projector as
  `yarramate/adapter/visual-graph` (`projectGraphForCanvas`) and a
  renderer-neutral ArchiMate notation vocabulary as
  `yarramate/notation/archimate` (layer colours, aspect shapes, kind glyphs,
  relationship line styles). The local visual app consumes the same
  vocabulary. `canvasNode.layer` / `aspect` in
  `yarramate/visual-graph/v1` are closed on the profile enums (plus null).
  No session-protocol or apply changes (#201).

- Correct the conservative-extension property in `docs/PROFILES.md` and ADR
  0079. It was published as one statement — loading a profile extension adds
  subjects and never changes verdicts — quantified over the profile together
  with any documents that select it, and quantified that way it is false: an
  extension document declaring `orders` with a realization to a pre-existing
  goal resolves that goal's `goal-unrealized` question, and so does the same
  document written in plain core. It is now two properties: a vocabulary
  nobody selects changes nothing, and an extension document is never a worse
  neighbour than its core twin — the same subjects declared under the nearest
  core ancestor of each kind it uses. The first keeps its degenerate-case
  identity test; the second is measured by control, running one arrival
  through an extension kind and through its core twin and comparing the
  verdict changes about pre-existing subjects, with a witness that the
  inclusion is strict: exact-kind bucketing leaves a near-duplicate question
  closed where the core twin opens it. No engine change — the properties hold,
  the single sentence overclaimed (#172).

## 0.21.0

- Move a subject's local id through `apply`. Two operations,
  `rename-concept` and `rename-relationship`, re-point the declaration and
  every declarative reference to it — across documents, projections, evidence
  overlays and adapter mappings — in one atomic batch. A rename is an identity
  edit, not a succession: it writes no `supersedes` entry and retires nothing,
  because one subject kept its identity and changed its address (ADR 0094).
  Only matched scalars' own bytes change, so a bare reference stays bare, a
  qualified one stays qualified, an `~aspect` suffix is preserved, and the
  original quoting is kept; comparison is on the qualified address, so a
  same-local id in another document is untouched. Refused when the id is not
  declared, when `to` equals the current id, when the document declares an
  architecture state with the old or new local id, when a reference position
  holds a YAML alias, and — by the compile gate, before a byte is written —
  when the new local id is already taken. New diagnostic `YM913`: `apply`
  re-reads every file it touched and refuses if any of them still names an
  address a rename moved off. The apply result gains `renamedConcepts` and
  `renamedRelationships` counters.
- Walk the staged visual changeset back and forward. The tray gains Undo and
  Redo beside Discard all, over an ordered history of whole staged-operation
  snapshots: staging replaces on a repeated `(target, field)`, so an inverse
  operation would have nothing left to restore a value a re-edit had already
  overwritten, and re-editing one field twice then undoing once now returns
  the earlier edit rather than skipping to the model's own value (ADR 0092).
  Staging, discarding one row, and discarding all are undoable by the same
  mechanism; a refused commit keeps the rows and both stacks; a landed batch
  empties them, because what has landed is reverted with `git revert`, never
  from the browser. Index-attributed commit diagnostics are dropped whenever
  the staged rows move, so row 1's error is never redrawn against whatever now
  occupies row 1. Local state only: the stacks never reach the wire.
- Refuse a visual commit staged against bytes another writer has replaced. Each
  staged row pins the sha256 the browser rendered for the document it targets,
  taken from the model frame the row was staged against and never refreshed
  from a later one, and the commit carries those pins as
  `sourceDigests`. The server checks every document the batch targets — not
  just every pin sent, so a batch that vouches for nothing is refused rather
  than trusted — and answers a mismatch with preserve-and-refresh: the rows
  stay staged, the freshly compiled model is broadcast, and the affected rows
  are marked with the value that is there now. Two reviewers editing the same
  field previously produced one silent overwrite reported as landed (ADR 0093).
  New diagnostics `YMVS312` (a pinned document changed or is gone) and
  `YMVS313` (an existing targeted document was left unpinned).
- **Breaking:** the wire is `yarramate/visual-protocol/v3`.
  `VisualChangesetCommitPayload.sourceDigests` is required, so a v2 browser's
  commit is refused rather than written unconditionally, and
  `VisualRenderedModel` now forwards the per-document `sourceDigests` the
  session request already minted.

## 0.20.0

- Add `compileWorkspaceIncremental`, a delta entry point for consumers that
  compile a whole workspace on every commit. It takes the opaque
  `CompilationCache` the previous call returned and re-parses only the
  documents whose source text changed. Reuse is decided by exact source-text
  equality, never by a caller-declared change set, so a stale cache can only
  fail to save work — it can never alter compiled output (ADR 0091). A
  40-document commit against a 40,000-document workspace costs 698ms instead
  of 5.4s, and `compileWorkspace` and `compileWorkspaceWithProfileContext`
  keep producing byte-identical graphs, profile contexts, and diagnostics.
- Parse each workspace source once. `compileWorkspaceResolved` parsed every
  source twice — once to read its `format` key for profile-versus-document
  classification, then again in its own loop — and re-parsed a document to
  resolve each claim's line and column. Classification now reads the composed
  value the first parse produced, and positions are memoised per document:
  a full compile of 1,000 documents falls 233ms → 193ms and 40,000 falls
  7.9s → 5.3s, with output unchanged byte for byte.
- Refuse a LikeC4 export whose selected concepts never reach the emitted
  model. `likec4 validate` reads an empty model as valid, so the emitter was
  the only place that could notice a projected concept silently missing from
  the generated text; it now compares the assembled definition lines against
  the projection and reports `YMLC112`, located at the concept that went
  missing. `YMLC111` joins the published diagnostic envelope, which never
  admitted the code its own relationship-gap report emits, and `pnpm validate`
  runs `export-project --check` before handing the directory to
  `likec4 validate`, which passes vacuously on absent output. `likec4` is
  pinned to the exact `1.59.2` the docs already name, so the grammar oracle
  cannot drift away from the emitter under a caret range.
- Delete a visual session's entries in a decided order. Recursive removal
  rejects on the first entry that refuses deletion while the sibling
  deletions it already started are still in flight, so a failed cleanup could
  still take `journal.jsonl` with it and leave the retry the failure invites
  nothing to recover from — 40 of 40 runs lost the journal on Linux Node 22,
  8 of 40 on macOS, which is why the suite was green here and red there.
  Removal now walks one awaited entry at a time and keeps back the journal a
  retry reads and the marker that authorises deleting the directory at all.

## 0.19.0

- Render and edit the native model in the browser. `yarramate-visual` now
  draws the compiled graph v2 model directly with cytoscape.js — no LikeC4
  DSL, no compiler round-trip, no external renderer to resolve or consent to.
  Inspector fields are constrained to what the model allows, edits stage as a
  changeset, and **Commit changes** lands them as one `yarramate/operations/v1`
  batch through the same validated `yarramate apply` write the CLI performs;
  a refused batch writes nothing and shows the diagnostics on the row that
  caused them. The runtime never runs `git commit`, so Git review still
  decides what becomes declared architecture. Dragged positions persist per
  projection in `.yarramate/visual-layout/` sidecars. The wire is
  `yarramate/visual-protocol/v2`: the agent's `model.replace` mutation path is
  gone, so a v1 child is refused rather than misread (ADRs 0084 to 0088).
- Resolve a chat-issued filter server-side against the compiled graph. A
  delegated agent sets `appliedQuery: { query }` and the runtime evaluates the
  `ProjectionQuery`, so the panel and the chat agent can no longer produce two
  different match sets for one query; an agent-supplied `matchedIds` is
  refused with `YMVS311`. A chat-issued narrowing is badged with the query
  that produced it and dismissible in one click (ADR 0090).
- Land evidence observations through `yarramate apply`. An observation is a
  write addressed by its `(target, key)` pair, batched and validated with
  every other operation rather than written by a separate path (ADR 0089).
- Rename the question catalogue's `authority: evidence` to `agent`, matching
  the runtime, `yarramate-interrogation-report/v1`, and `docs/INTERROGATION.md`.
  A catalogue that declared `evidence` passed catalogue validation and then
  produced a report that failed its own schema; the shipped catalogue never
  used the value, so no interview changes.
- Add the `unconstrained-kind` trigger condition and a `kind-untested` hygiene
  question (core-enrichment 0.7 → 0.8): a subject whose kind is pinned by no
  relationship claim could be reclassified freely and still compile, so the
  interview asks rather than the engine inferring (ADR 0083). 153 of the
  repository's own 238 concepts carry such a kind; the shipped question is
  scoped to active-structure, where it opens 4.
- Publish `relationshipKindEndpointAspects` on `ResolvedProfileContext`, the
  lineage-resolved table of which endpoints each relationship kind constrains.

## 0.18.0

- Resolve `attestations[].by` as a subject reference, reusing `YM304` when it
  does not resolve, instead of accepting free text: an authority has to be
  someone the model already knows (ADR 0082). Documents whose `by` is a name
  rather than a reference no longer compile.
- Add optional `attestations[].recordedBy` naming whoever held the pen.
  `apply` requires it on every attestation an operations batch writes, since a
  batch is by construction a machine's transcription of someone's judgment.
- Report `unconfirmed-attestation` from `reconcile`, with a matching
  `summary.unconfirmedAttestations` counter, when a record names a recorder
  other than its attesting authority. Advisory like `stale-attestation`:
  `check --strict` is unaffected.
- Render the recorder beside the authority in `export rtm` attestation cells.

## 0.17.0

- Add the `yarramate-visual` adapter (beta): a sibling runtime that renders
  LikeC4 diagrams of a bounded slice in a local, authenticated browser
  session and delegates a chat conversation about what is on screen to a
  visual agent, over a published, closed `yarramate/visual-*/v1` contract.
  Git review remains responsible for accepting any resulting architecture
  proposal; the runtime never becomes canonical architecture by itself.

## 0.16.0

- Add optional profile concept-kind layers and layer-aware projections.
- Add bounded, directional connected expansion and deterministic presentation metadata.
