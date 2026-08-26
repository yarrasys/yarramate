# Visual conversation adapter

> **Beta.** The browser workspace and the delegated-chat journey are new and
> still settling — expect rougher edges than the rest of YarraMate. The wire
> stays governed by the versioning rule in
> [ADR 0081](adr/0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md):
> `yarramate/visual-*/v1` is closed and stable now: beta status describes the
> browser experience, not the published contract.

The optional visual adapter opens one local, loopback-only browser session
that renders a bounded slice of the native YarraMate model directly with
[cytoscape.js](https://github.com/cytoscape/cytoscape.js) — no DSL round-trip,
no compiler shell-out — lets a reviewer edit the concepts and relationships on
the canvas, and, when the host harness can delegate a long-lived child agent,
carries a chat conversation about what is on screen. `yarramate-visual` is a
sibling binary beside `yarramate-likec4`, `yarramate-graphify`, and
`yarramate-mcp` — presentation and runtime, never a subcommand of the semantic
`yarramate` CLI, and never a second claim origin. YarraMate Core does not
depend on it and stays unaware of any session.

## Host seam

The editor's seam is the existing visual protocol: a host delivers server
frames and accepts browser inputs. The socket/session host behind
`yarramate-visual` is one implementation, preserving the conversation journey,
session lifecycle and journal. The mounted local host is another: it runs the
same browser engine over a caller-owned synchronous `SourceStore` and
pre-resolved `ResolvedWorkspace`, with no server.

Both hosts compile and project the workspace, evaluate filters, commit changes,
and save layouts. The local host sends model and view writes from one changeset
to its store in one compare-and-swap batch. It cannot provide chat, choices, a
journal, handoff, or session end; consumers omit the `chat` section when they
mount it. An asynchronous product fetches into a synchronous in-memory store
and flushes writes itself, as [ADR 0100](adr/0100-sources-come-from-a-store-and-a-batch-lands-by-compare-and-swap.md)
decides.

[...]

## Editing is mechanical, and it lands through `apply`

A rendered model is always `canonical` — the projection of a real workspace
that already passed `check`. Edits are made in dropdown- and text-constrained
inspector forms, accumulate client-side as a list of typed
`yarramate/operations/v1` entries, and land only when the reviewer presses
**Commit changes**: the runtime assembles them into one operations document
and calls the same `apply` core the CLI calls, which validates and compiles
the whole candidate workspace before a byte is written
([ADR 0057](adr/0057-writes-land-as-one-validated-batch.md)). A rejected batch
writes nothing and the browser is shown exactly the diagnostics that refused
it, pointed at the changeset row that produced them
([ADR 0062](adr/0062-an-apply-diff-is-exactly-the-answer-it-landed.md)).

**A saved view is a staged change too**
([ADR 0103](adr/0103-a-write-can-remove-and-a-view-lands-in-the-same-batch-as-the-model.md)).
Saving, overwriting and deleting a view all put a row in the same changeset,
marked `view` where a subject's row is marked `model`, and land in the same
batch: the runtime plans the model's writes, composes the projections', and
hands the store **one** `writeAll`, so a view and the subjects it shows arrive
together or not at all. The rows have different blast radius and the tray says
which is which — a view row rewrites one projection, a model row changes every
view that drew the subject.

Core is untouched by this: `yarramate/operations/v1` has no projection
operation, and a projection is still never an operation's own target. What made
it possible is `SourceStore` learning to remove a document — a `PendingWrite`
with a `null` source — which is also what makes a view rename expressible at
all, since renaming writes one document and removes another.

A view saved where the manifest's patterns cover no projection is refused
rather than written: a projection nothing loads is worse than a refusal, and
nothing later would say so.

Before a commit, the tray walks its own staged set: **Undo** and **Redo** step
through whole snapshots of the staged operations, so staging, discarding one
row, and discarding all are reversible by the same control, and undoing a
field edited twice returns the earlier edit rather than the model's own value.
The history is browser-local, reaches no wire event, and stops at the commit —
what has landed is reverted with `git revert`, never from the browser
([ADR 0092](adr/0092-undo-restores-a-snapshot-not-an-inverse-operation.md)).

A commit also states what it was staged against. Each row pins the sha256 the
browser rendered for the document it targets, taken from the model frame that
row was staged against and never refreshed from a later one, and the server
refuses the whole batch if any document it touches no longer matches
(`YMVS312`) or was left unpinned (`YMVS313`). The refusal is
preserve-and-refresh: the rows stay staged, the freshly compiled model is
pushed, and the affected rows are marked with the value that is there now, so
two reviewers editing one field can no longer produce a silent lost update
([ADR 0093](adr/0093-a-commit-states-what-it-was-staged-against.md)).

The chat agent can no longer author a mutation — it explains, filters, and
focuses. A commit lands in the working tree and nothing else: the runtime
never runs `git commit`, so Git review still decides what becomes declared
architecture, and revert is `git revert`/`git checkout`. This supersedes
ADR 0081's clause that a diagram drawn in the browser can never become
canonical; see
[ADR 0084](adr/0084-a-mechanical-edit-lands-through-apply-not-through-the-agent.md)
for what changed and why a mechanical operation batch is not an inferred
model.

## The shell

Three columns, and the middle one is the diagram.

**The command strip carries identity and nothing else** (#249): the session's
name, its beta badge, the authority line, the connection state, and one line of
description. Every control it used to hold has gone to the thing it acts on —
the quick filter to the canvas it narrows, saving a view to the rail that lists
views, ending the session to the chat section that owns the conversation. The
`Details` disclosure went with them: it only ever revealed a sentence, and a
sentence about what the session *is* belongs beside the name.

**The right column is a stack of collapsible sections**, split by handles a
pointer or the arrow keys can drag:

1. **Kind palette** — the profile's concept kinds, grouped by layer, dragged
   onto the canvas or clicked: either way the Add-subject dialog opens with
   the kind preselected (#295).
2. **Element properties** — the subject form. Its header names the selected
   subject; selecting one opens the section, because that is what selecting was
   for.
3. **Open questions** — what the interrogation overlay asks, beside what is
   declared; drawn only when the host ships the overlay (#292).
4. **Changes** — the staged rows, and how many are staged.
5. **Chat** — pinned at the foot, owning the session's own control.

There is no open/closed mode for the column. The sections collapse one at a
time, and a shut header still says what is behind it — the selected subject,
the staged count, whose turn it is — where a shut column said nothing at all.
That is also why an unread count only appears while **Chat** is shut: a reply
that lands in front of the reviewer needs no number standing in for it.

**`Return to agent` is one button, and it does what it always did**: hand
control back to the main agent, which is what the notice it writes has always
said. The design draws a second, `End session`, for a handback that leaves the
session live. Nothing can do that yet — `session.end` freezes the session — and
a button that claimed otherwise would be lying about the lifecycle.

## Layout is presentation the repository keeps

Dragging a node saves absolute positions to an adapter-owned sidecar,
`.yarramate/visual-layout/<projectionId>.yaml` — one
`yarramate/visual-layout/v1` document per saved projection. It is validated by
the adapter, never by Core, never routed through `apply`, and never
`git commit`ed by the runtime. It lives under `.yarramate/` because a
hand-arranged layout cannot be regenerated from the model, so it is a
reviewable input rather than a reproducible artifact
([ADR 0085](adr/0085-a-dragged-position-is-presentation-the-repository-keeps.md)).
An unreadable or invalid sidecar is skipped: presentation must never fail a
session.

### Layout

One backend: **`layered`** (`elk layered`), selected by `presentation.layout`,
which now admits only that value. It honours `presentation.direction`
(`top-down` → `elk.direction: DOWN`, `left-right` → `RIGHT`) and measured
112 ms on this repository's 258-node graph.

`radial` (cytoscape `concentric`) and `force` (elk `stress` then
`sporeOverlap`) were removed in 1.0. Measured against `layered` on every view
of the contact-update journey, both lost on all three counts that decide
whether a diagram can be read: edge crossings, total edge length, and how
large the graph draws once fitted to the canvas. On the solution view, for
instance, `layered` produced 79 crossings and 16,349px of edge at a fit zoom of
0.94, against `radial`'s 86 / 18,634 / 0.75 and `force`'s 73 / 25,783 / 0.71.
`force` also cost seconds of blocked main thread and the whole apparatus that
went with it: a busy notice, a two-pass chain, and an in-flight guard so a
newer request could supersede a running one. None of that has anything left to
guard now.

`presentation.seed` went with them. Only `force` ever read it, yet the
projection schema had required a seed of every view that declared a layout at
all. Removing it also removes that conditional, so declaring a layout no longer
obliges a view to invent a seed it has no use for.

[ADR 0086](adr/0086-radial-is-concentric-and-force-is-stress-then-spore.md)
recorded what those two backends mapped onto and why the obvious ELK choices
were rejected; it is superseded here. A future layout mechanism is expected,
and `presentation.layout` stays an enum so it has somewhere to land.

### Deleting

**Delete** on a selected subject or relationship asks first, because this is the
one motion that removes authored text.

Deleting a subject takes every relationship naming it in the same batch.
`apply` will not remove a subject something still references, and it evaluates
that against the post-batch state (ADR 0069), so the two go together or neither
does. Composing that batch is the point: a reviewer would otherwise have to find
every relationship touching the subject by hand, and the canvas already knows
them.

The confirmation states what else still names the subject: an `owner`, a
`distinctFrom`, a `supersedes`, a constraint or a reference. It **warns rather
than refuses**. That list is derived from what a canvas holds, and a canvas does
not hold everything that can reference a subject, so treating it as
authoritative would block deletions that would actually land. `apply` is the
gate.

### Adding a subject

**Add subject** opens a form over the canvas: a name, a kind, and the document
to write it into. The kinds are the workspace's own vocabulary, sent with every
model frame, so nothing in the browser decides what a workspace may contain.
The document defaults to the selected subject's, or the first the workspace
declares, and any declared document may be chosen.

The id is *derived* from the name rather than asked for, and shown before the
subject lands. An id is a stable address a human reads in a diff, and a
reviewer thinking about a name writes worse ids than a transliteration of the
name does; showing it first keeps a derived address from being one nobody
agreed to. `Order Intake (v2)` becomes `order-intake-v2`, and a name already
taken steps to a numeric suffix.

Two kinds of name are refused rather than mangled: one an id cannot be made of
at all, and one that would start with a digit. `2FA Gateway` would otherwise
become `fa-gateway`, an id that no longer names the thing.

Adding and connecting are alternatives rather than layers: starting one puts
the other away, so a click on the diagram always belongs to exactly one of them.

### Connecting two subjects

Selecting a subject offers **Connect**. The next subject named on the diagram
becomes the target, and the panel then offers the relationship kinds the
ArchiMate 3.2 table permits between the two, read through each endpoint's
`coreKindLabel` so a model using a profile gets a palette rather than nothing.

Choosing one stages an `add-relationship` into the *source* subject's document,
with an id of the form `<from>-<kind>-<to>`, taking a numeric suffix if that is
already taken. Nothing is written until the changeset is committed.

The reviewer cannot draw an edge `check` would refuse with `YM404`: the palette
is `permittedRelationshipKinds`, the same lookup the compiler performs, and
`draftRelationship` refuses a kind outside it even if a caller offered one.
Naming the source again backs out, since a subject related to itself is a
mis-click far more often than an intention. A pair the table knows always
permits `association`, so an empty palette means an endpoint outside the
ArchiMate vocabulary, and the panel says so rather than showing an empty list.

Selection is chosen over dragging deliberately: every step is a state
transition a test can make and a keyboard can reach.

### Right-click menus

Four things carry a menu — a subject, a relationship, the empty canvas, and a
row in the rail — and one rule runs through all four: **operations that edit
the view are separated from operations that edit the model.** The groups are
named, view before model, and anything model-destructive sits last, behind a
firm rule, drawn in `--failure`.

The rule is not decoration. Removing a subject from a view rewrites one
projection and leaves every other view alone; deleting it from the model takes
every relationship naming it and changes every view that drew it. Rendered as
neighbours in a flat list, the second is one slip away from someone who meant
the first. Delete still asks through the same confirmation the side panel uses,
so a menu adds a way to ask and no way to skip being asked.

`Change kind` on a relationship offers only what the endpoint pairing permits,
which is the guarantee the connection tool already gave a new edge, given to
one that exists. An extension kind is judged by the core kind it descends from,
read off `VisualKindOption.coreLabel`; a kind whose lineage never reaches the
ArchiMate table has no row to judge it against and is offered rather than
refused on a guess. The kind an edge already carries is always offered, because
a model authored outside this editor is not the editor's to silently rewrite.

A view row carries its own CRUD: **Open**, **Rename…**, **Duplicate**, **New
view in this folder…**, **Copy projection path**, and **Delete view…** behind
the rule. Rename and duplicate stage rows like anything else.

**A rename changes what a view is called and moves nothing.** A projection's id
decides its filename and also keys its layout sidecar
(`.yarramate/visual-layout/<id>.yaml`), so a rename that carried the id along
would silently orphan the positions the reviewer dragged. Duplicating keeps the
source's folder and takes a free id, and does not inherit the layout — that is
keyed by id, and a copy is a different view that lays itself out.

Folders are read off projection paths (#245), so the only way to name one is to
point at a view already in it — which is also what makes it a folder the
manifest demonstrably reaches. **Export PNG** on the canvas menu photographs
what is drawn, at 2× on white.

What a menu contains is a pure function of the model (`contextMenuFor`), and
its items name intents rather than carrying callbacks, so what a right-click
puts on screen is something a test can read. It is rebuilt on every render
rather than captured when it opened: a commit landing underneath an open menu
redraws it instead of leaving items pointing at a subject that has gone.

### View membership

A view that ENUMERATES `subjects:` is the only kind that can be told which
subjects it holds. A view that describes them with facets — a layer, a kind, a
state — already includes anything matching them, so there is nothing a
membership edit could say to it: the subject is in or out by what it *is*, and
changing that means editing the query.

Three motions stage the same thing, a `write-view` amending that list:

- **creating a subject** stages two rows, the model's `add-concept` and the
  view's membership, so a subject the reviewer made on a view appears on that
  view rather than nowhere;
- **Add to this view**, on a subject in the rail's Model tree or on one drawn
  but not listed (`relationships: connected` takes the other end of a
  relationship with it);
- **Remove from view**, which rewrites one projection and leaves every other
  view — and the subject itself — alone. It is a different item, in a different
  group, from **Delete from model…**, which takes every relationship naming the
  subject with it.

Neither item appears where the active view has no list to edit.

The reducer composes the amendment, not the caller. Staged view rows replace by
path, so a second membership edit composed from the SAVED document would
silently drop the first; composing where both the saved views and the pending
rows are held is the only place it cannot be forgotten. An edit that returns the
document to what is on disk drops the row rather than staging a write that
changes nothing, and a rename staged underneath it survives that.

The tray names what a row moved rather than which file it writes:
`write-view · Payment flow · +fraud-screening`, badged `view`.

### Folders

The rail's folders are DECLARED, not derived from where a projection sits
(ADR 0104). A view files itself with `presentation.folder`, a concept with
`folder`, and both are labels nested with `/`.

- **Views.** `buildViewTree` reads `presentation.folder`; a view that declares
  none is loose under the root. Every projection is written into one directory,
  so a new view can never land where the manifest's patterns do not reach —
  which is what makes **New folder…** something the editor can offer at all. It
  names the folder and opens the save form with it filled in, because a folder
  no document declares is not a folder.
- **The model.** `buildModelTree` groups by a subject's declared folder where
  it has one and by its ArchiMate layer where it does not. Layer is the
  default: it is derived from the kind and always correct, so a model nobody
  has organised is grouped exactly as it was. A declared folder OVERRIDES the
  layer rather than sitting beside it — a subject in two groups is one the
  reviewer finds twice and edits once. Each group says which of the two put it
  together, and a folder named `business` and the `business` layer keep
  separate collapse keys.

One level: the rail draws a folder, not a folder tree, so `Current/Engine` is
one folder with that name.

### Nesting

`presentation.nesting` names the relationship kinds that draw as containment in
this view, in precedence order
([ADR 0101](adr/0101-a-view-says-what-nesting-means-in-it.md)):

```yaml
presentation:
  nesting: [composition, assignment]
```

It defaults to `[composition]`, which is the behaviour that shipped before a
view could say. `[]` draws every relationship as a line.

A nested box carries no label saying how it got there, so a view that nests two
kinds has accepted that an inner box means either "is a part of" or "is
behaviour performed by". Declaring the vocabulary is what makes that a choice
rather than an accident: a view listing one kind has no ambiguity to resolve.

A child claimed by two kinds nests under the earlier-listed one. Two claims at
the same precedence naming different parents stay undecidable: the child draws
at top level and every claim stays drawn as a line, so the conflict stays
visible rather than being silently resolved. The same is true of a nesting
cycle, which a mixed vocabulary can form where composition alone could not.

Assignment never nests a service, whatever the view says. A service is the
promise the layer above consumes, so burying it inside the thing that exposes
it inverts what it is for. This declines to *draw* a containment, not to accept
the model: `applicationComponent -assignment-> applicationService` is permitted
by the ArchiMate 3.2 table and stays drawn as a line. Composition is
unaffected, because a composed service is a part.

Unlike the toggles below, `nesting` is restored to the default by a view that
does not declare it, rather than carried across. The toggles are things a
reviewer changes on screen, so their choice should survive a view switch;
nesting has no control and is a property of the view, and inheriting one view's
containment meaning into a view that never asked for it is the ambiguity this
is meant to prevent.

### Presentation toggles

Three presentation state fields ride alongside layout in `presentation`, staged with the view and persisted in the projection document:

- `showLifecycle` — renders a status badge (lifecycle: `planned` / `current` / `retired`) on each node's top-left, using the existing CSS tokens from `src/visual-app/styles.css`.
- `showEvidence` — renders a checkmark badge on each node's bottom-left, only when the node has attestations (`hasAttestations: boolean`). Binary presence, never a graded state.
- `showOwnership` — renders the owner's initials in a coloured circle on each node's bottom-right, hashing the owner ref onto a four-colour palette from `styles.css` (eucalyptus, ochre, cobalt, ink) deterministically and stably across reloads and machines. Colour is only informative here; initials identify the owner at a glance.

The three checkboxes live in the query panel's **View query** tab, beside the facets and above the document they are written into. None of them toggles a projection query or composes a `filter.query` event; toggling a checkbox dispatches `onTogglePresentation` and updates local state only. They are presentation, not semantic queries, so they save without consulting the model, reload without validating against the model, and appear in no changeset. Switching views triggers a relayout; toggling a badge does not, since badges are derived from existing node data.

A fourth toggle, `showNudges`, sits beside them but is workspace presentation only — never written into a view's `presentation`, because a saved view does not decide whether a reviewer sees the interview.

### Open questions (ADR 0111)

Each host evaluates the shipped question catalogue against the compile the graph came from and ships the result beside it as `VisualRenderedModel.interrogation`: workspace-scoped question entries, per-subject entries (phrasings already interpolated), the catalogue `id@version`, and the engine `semantics` stamp (ADR 0106). The app draws a quiet count chip on each node with open questions — bottom-right, inset from the corner, stepping left when the ownership chip is drawn on that corner (zero draws nothing; the chip never borrows the failure palette — an open question is the catalogue deepening honestly, not a defect) and an **Open questions** section that scopes to the selected subject, showing the workspace-scoped list when nothing is selected. The panel is read-only: answers land through the changeset, or through an agent running the interview.

The overlay is recomputed per landed commit and never stored, so a drafted-but-uncommitted edit moves no badge — the stateless-interview rule as the canvas sees it. The field is optional: a host that computes no overlay ships none, and the app hides the chips, the section, and nothing else changes. Embedded hosts get the same overlay from the catalogue bundled into the browser build; `mountEditorWith` hosts that speak the protocol themselves may simply omit it.

### ArchiMate notation

The canvas draws ArchiMate. The stylesheet shapes nodes by aspect (resolved
from each concept kind's inheritance), applies line-notation conventions by
core relationship kind (derived kinds resolve through lineage), draws each
kind's glyph, and lays out `DOWN` because ArchiMate's layer bands only read
top-down.

This is not a mode: there is no picker and no second renderer to pick.
`presentation.notation` stays in the projection format, admitting `archimate`
alone, so a second notation has somewhere to land — the same reason
`presentation.layout` stayed an enum when `radial` and `force` were removed. A
projection asking for `native` is refused rather than quietly drawn as
ArchiMate.

`presentation.direction` also stays, and the canvas ignores it: the LikeC4
export reads it for its own `autoLayout`, and that export draws no layer bands.
A save carries a view's declared direction through untouched rather than
dropping a value the canvas never offered to set.

The kind colours, aspect shapes, glyphs, and relationship line styles are
defined once in the published `yarramate/notation/archimate` module; this app
imports that module rather than keeping a parallel table.

Node shapes by aspect: `active-structure` → `rectangle`, `behavior` → `round-rectangle`, `passive-structure` → `rectangle` + top accent, `motivation` → `octagon`, `composite` → `rectangle` + dashed border.

Line notation (element-line convention pairs) covers all 11 core relationship kinds: `composition` (solid, filled diamond → none), `aggregation` (solid, hollow diamond → none), `assignment` (solid, filled circle → filled triangle), `realization` (dotted, none → hollow triangle), `specialization` (solid, none → hollow triangle), `serving` (solid, none → vee), `access` (dotted, none → vee), `influence` (dashed, none → vee), `triggering` (solid, none → filled triangle), `flow` (dashed, none → filled triangle), `association` (solid, none → none). Derived kinds like `implements` (inherits `realization`) resolve to their core ancestor and render with the core kind's notation.

19 kind icons — one per distinct kind in this repository's graph — render in each node's top-right slot under `archimate` notation, with unknown kinds rendering nothing. Icons are 14×14 px single-stroke SVGs using `--ink` (`#182228`); notation is presentation, never vocabulary (see [ADR 0087](adr/0087-archimate-notation-is-a-rendering-mode-not-a-vocabulary.md)).

ArchiMate mode is pure rendering: the schema, vocabulary, kinds, relationships, and semantic model are completely unchanged. Switching notation changes only what is drawn on the canvas, not what is compiled or what lands when a reviewer commits changes.

## A filter is a query the server evaluates

Narrowing the canvas is one mechanic with one evaluator. The browser sends
`filter.query` carrying a `ProjectionQuery`; the runtime evaluates it against
the compiled graph the session is already rendering and answers a
`filter-result` frame with `{ query, matchedIds, excluded }`. The panel and the chat
agent both go through it: an agent asked to "show me only the application
layer" sets `appliedQuery: { query }` on its `chat.response` and the runtime
resolves `matchedIds` server-side, so the same query never lights up two
different sets. An agent that sends its own `matchedIds` is refused with
`YMVS311` ([ADR 0090](adr/0090-a-chat-filter-is-a-query-not-a-match-set.md)).

A filter is ephemeral: it narrows what is drawn, never what is saved, and
appears in no changeset. A chat-issued filter is badged on the canvas with the
query that produced it and a one-click way back to the full model, because a
narrowing the reviewer did not perform is one they must be able to see and
undo. Clearing a filter also returns the picker to the unfiltered view rather
than leaving a stale named view selected.

`excluded` is every concept the query DROPPED, each with the facet that dropped
it, resolved by `explainProjection`. It shares its selector with
`evaluateProjection`, so the reason the editor gives and the set the canvas
draws cannot come from two readings of one query. A subject is reported against
the FIRST facet that rejects it, in the order the query applies them
(`states`, `subjects`, `documents`, `kinds`, `layers`, `statuses`,
`excludeStatuses`, `owners`, `constraints`): a list of every reason is a list
nobody reads. Relationships are absent by construction — they enter a view
through their endpoints, so "why" for a relationship is a statement about the
concepts it joins.

It is a frame field, never a document field:
`yarramate/projection-result/v1` is `additionalProperties: false`, and this is
a question about a query rather than part of what a projection is. A chat
turn's `appliedQuery` carries no exclusions either — it is a schema-bound
document holding exactly `query` and `matchedIds` — so the browser records
"unknown" for a chat filter rather than reporting that it dropped nothing.

### The query panel

A collapsible tabbed panel runs along the foot of the CANVAS COLUMN, collapsed
at rest so the diagram keeps the room. It spans the canvas column rather than
the window: the right column runs full height and its own foot is chat. **View
query** is its first tab, and the tab strip carries the live match count so a
collapsed panel still answers what it was opened for.

The tab holds the same 13 facets the old filter dropdown did, and three things
that dropdown could not offer:

- a **live match count** against the checked model, counting SUBJECTS rather
  than the match set — `matchedIds` names concepts and relationships together,
  so counting it whole reports five for three components with two
  relationships between them;
- the **excluded, and why** list, grouped by facet. Its SET comes from
  `matchedIds` and its REASONS from `excluded`, so the list can never disagree
  with the diagram beside it. A concept a facet dropped can still be drawn —
  `relationships: connected` takes the other end of a relationship with it —
  and that is reported as a line rather than hidden; a concept no facet reports
  was dropped by `isolatedConcepts: exclude`, which runs after the facets;
- the **projection document** the query resolves to, serialised with the same
  `yaml` the runtime writes it with, so what the reviewer reads is what a
  commit would put on disk.

Editing a query **stages** a `write-view` rather than saving it, so a query
edit lands in the same batch as every other change (ADR 0103). An edit is
filtered under the `editor` source, which leaves the view's name standing in
the tree — a keystroke that made the app forget which view was being edited
would take away the document the edit is written to.


## Commands

```sh
yarramate-visual request [--view <id>] [--title <text>]
                         [--description <text>] [--chat]
yarramate-visual start <request.json>
yarramate-visual wait <descriptor-uri> [--after <sequence>]
yarramate-visual respond <descriptor-uri> <response.json>
yarramate-visual status <descriptor-uri>
yarramate-visual recover <descriptor-uri> [--transcript]
yarramate-visual stop <descriptor-uri> [--transcript]
```

`request` is the only verb that reads the repository instead of a session: it
compiles the workspace at `.yarramate/workspace.yaml`, projects the native
graph, digests every source it consumed, and prints the whole
`yarramate/visual-session-request/v1` document on stdout, ready to hand to
`start`. A session's model is a machine's transcription of a checked
workspace — for this repository, hundreds of nodes and edges — so no agent
hand-authors one. A workspace that cannot be read or cannot compile refuses
here, before any session exists, with the compiler's own diagnostics.

`start` is a managed foreground process, not a one-shot call: it publishes one
`yarramate/visual-session-started/v2` line on stdout carrying `browserUrl` and
`descriptorPath`, then blocks, serving the session until `stop` ends it. Every
other command is an ordinary one-shot call against the printed
`descriptorPath`, which is a canonical local `file:` URI and is passed back
verbatim: it is never hand-typed as a native path and never resolved against
the working directory (ADR 0096). A harness with no facility for hosting a foreground process
across tool calls cannot run this journey; fall back to `yarramate ask`,
`export markdown`, or `yarramate-likec4 export-project`.

## Wire

Eleven closed `yarramate/visual-*/v1` JSON documents, each with
`additionalProperties: false`, published from `./schema`:
session request, session started, session descriptor, event, response,
status, handoff, model, graph, layout, and diagnostic result.
`yarramate/visual-protocol/v4` is the version the started result, the
descriptor, and status agree on. Every filesystem path any of these documents
carries - `sessionRoot`, `descriptorPath`, `journalPath`, `transcriptPath` - is
a canonical local `file:` URI rather than a bare path string, which is why the
three documents that carry one are at `v2` while the eight that do not stay at
`v1` (ADR 0096). The wire is a published contract, not a
process-local convention, because the journal that recovers a crashed session
has to be readable by a process that did not write it — see
[ADR 0081](adr/0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md).
v1 said `model.replace`: the delegated agent could re-author the whole model
and the runtime would adopt it. That response no longer exists, so a v1 child
is refused rather than misread — see
[ADR 0088](adr/0088-removing-the-agents-mutation-path-bumps-the-wire.md).
v2's commit payload said only which operations to apply. v3 requires
`sourceDigests` alongside them, because a browser that omits the digests is
exactly the one that cannot detect a concurrent change, so the precondition
cannot be optional — see
[ADR 0093](adr/0093-a-commit-states-what-it-was-staged-against.md).

The journal carries ten event kinds. Eight are the browser's to send —
`chat.message`, `choice.selected`, `view.navigate`, `view.save`,
`filter.query`, `changeset.commit`, `layout.save`, `session.end` — and
`browser.connected` / `browser.disconnected` are the runtime's own. Frames
back to the browser carry nine response types.
`changeset.commit` and `layout.save` are answered synchronously, by an
`apply-result` or `layout-save-result` frame, and never wake the agent: a
mechanical edit is not a question. A successful commit is followed by a fresh
`model` frame, so the browser renders what actually landed rather than an
optimistic local guess.

## Boundary

The adapter does not:

- add a Core semantic verb, or widen native YarraMate meaning — a commit
  calls the existing `apply` batch, and every operation is one the CLI
  already accepts;
- run `git commit`, `git add`, or any Git command — a landed edit is an
  ordinary working-tree diff for Git review to accept or discard;
- let the chat agent author a model mutation; chat explains, filters, and
  focuses, and the only mutation path is a reviewer-pressed commit;
- accept a free-text or agent-inferred model — a commit carries typed
  operations only, validated against `yarramate/operations/v1` and then
  compiled as one atomic candidate;
- call a model provider or hold credentials — the delegated chat agent
  belongs to whatever harness hosts the session;
- persist server state beyond the session: the server is loopback-only,
  ephemeral, and its directory is deleted on `stop`. The files a commit or a
  layout save writes are the workspace's, not the session's.

The full operating sequence — workspace compile preflight, harness capability
detection, delegating the visual agent, the synchronous commit path, and
end/failure recovery — is the canonical
[`yarramate-architecture` skill's visual-conversations reference](../skills/yarramate-architecture/references/visual-conversations.md).
Git review remains responsible for accepting any resulting architecture
proposal.
