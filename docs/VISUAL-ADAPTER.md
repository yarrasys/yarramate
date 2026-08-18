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

### Layout backends

Three layout algorithms render the canvas automatically, selected via `presentation.layout`:

- **`layered`** (`elk layered`) — honours `presentation.direction` (`top-down` → `elk.direction: DOWN`, `left-right` → `RIGHT`). Measured 112 ms on this repository's 258-node graph. Deterministic; seed (`presentation.seed`) is ignored.
- **`radial`** (cytoscape `concentric`) — degree-ranked rings, hubs in the centre. Ignores `direction` and `seed`. Measured 4 ms with zero node overlaps. Not elk-based; compound parents wrap children instead of being positioned concentrically themselves.
- **`force`** (elk `stress` + `sporeOverlap`) — a two-pass layout: elk `stress` (`desiredEdgeLength: 320`) first, then (once that settles) `sporeOverlap` to remove overlaps. Takes 5.4 s on the full graph but reaches zero overlapping pairs. Seed deterministically shifts initial random placement — the only backend where seed visibly alters final positions. Shows a `"Laying out..."` busy notice during the run and supersedes a request while another is in flight rather than stacking a second pass.

The three measurements above are from this repository's own graph (258 concepts, 352 relationships, 220×64 px nodes), not a synthetic fixture. **`radial` is not elk `radial`** — ELK's radial is a tree algorithm that produced 17,578 overlapping pairs on this graph and did not terminate when overlap removal was attempted afterward. `radial` maps instead to cytoscape's built-in `concentric`, and `force` takes no new dependency beyond the already-installed `cytoscape-elk`, avoiding `cytoscape-cola` and `cytoscape-fcose` which either stalled, produced degenerate output, or left too many overlaps to be useful. See [ADR 0086](adr/0086-radial-is-concentric-and-force-is-stress-then-spore.md) for the full measurement table and rejected alternatives.

Seed is a string on the wire and is FNV-1a-hashed to a signed int32 before being handed to `elk.randomSeed` (the browser hashes it with `Math.imul`). It is saved for every view but only reproduces a `force` layout; `layered` is deterministic and ignores it, and `concentric` is deterministic by construction.

`elk.direction` is only honoured by `layered`; the other two backends ignore it entirely.

### Presentation toggles

Four presentation state fields ride alongside layout in `presentation`, saved via `view.save` and persisted in the projection document:

- `showLifecycle` — renders a status badge (lifecycle: `planned` / `current` / `retired`) on each node's top-left, using the existing CSS tokens from `src/visual-app/styles.css`.
- `showEvidence` — renders a checkmark badge on each node's bottom-left, only when the node has attestations (`hasAttestations: boolean`). Binary presence, never a graded state.
- `showOwnership` — renders the owner's initials in a coloured circle on each node's bottom-right, hashing the owner ref onto a four-colour palette from `styles.css` (eucalyptus, ochre, cobalt, ink) deterministically and stably across reloads and machines. Colour is only informative here; initials identify the owner at a glance.
- `notation` — toggles between `native` (the default) and `archimate` rendering mode (see below).

None of these toggle a projection query or compose a `filter.query` event; toggling a checkbox dispatches `onTogglePresentation` and updates local state only. They are presentation, not semantic queries, so they save without consulting the model, reload without validating against the model, and appear in no changeset. View switching, layout changes, and direction changes all trigger a relayout; toggling a badge or notation does not (notation is applied at stylesheet render time, badges are derived from existing node data).

### ArchiMate notation mode

Under `notation === 'archimate'`, the stylesheet swaps node shapes by aspect (resolved from each concept kind's inheritance), applies line-notation conventions by core relationship kind (derived kinds resolve through lineage), and forces `layered` direction to `DOWN` with the direction toggle disabled and a reason shown (`"ArchiMate notation fixes direction to Top-Down."`). The direction pin is applied only at layout-config build time; nothing is overwritten in state, so switching back to `native` restores the projection's declared direction on the next layout.

The kind colours, aspect shapes, glyphs, and relationship line styles are
defined once in the published `yarramate/notation/archimate` module; this app
imports that module rather than keeping a parallel table.

Node shapes by aspect: `active-structure` → `rectangle`, `behavior` → `round-rectangle`, `passive-structure` → `rectangle` + top accent, `motivation` → `octagon`, `composite` → `rectangle` + dashed border.

Line notation (element-line convention pairs) covers all 11 core relationship kinds: `composition` (solid, filled diamond → none), `aggregation` (solid, hollow diamond → none), `assignment` (solid, filled circle → filled triangle), `realization` (dotted, none → hollow triangle), `specialization` (solid, none → hollow triangle), `serving` (solid, none → vee), `access` (dotted, none → vee), `influence` (dashed, none → vee), `triggering` (solid, none → filled triangle), `flow` (dashed, none → filled triangle), `association` (solid, none → none). Derived kinds like `implements` (inherits `realization`) resolve to their core ancestor and render with the core kind's notation.

19 kind icons — one per distinct kind in this repository's graph — render in each node's top-right slot under `archimate` notation, with unknown kinds rendering nothing. Icons are 14×14 px single-stroke SVGs using `--ink` (`#182228`) and are descriptive notation only; no trademark or conformance claim is made (see [ADR 0087](adr/0087-archimate-notation-is-a-rendering-mode-not-a-vocabulary.md)).

ArchiMate mode is pure rendering: the schema, vocabulary, kinds, relationships, and semantic model are completely unchanged. Switching notation changes only what is drawn on the canvas, not what is compiled or what lands when a reviewer commits changes.

## A filter is a query the server evaluates

Narrowing the canvas is one mechanic with one evaluator. The browser sends
`filter.query` carrying a `ProjectionQuery`; the runtime evaluates it against
the compiled graph the session is already rendering and answers a
`filter-result` frame with `{ query, matchedIds }`. The panel and the chat
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


## Commands

```sh
yarramate-visual request [--view <id>] [--title <text>]
                         [--description <text>] [--chat]
yarramate-visual start <request.json>
yarramate-visual wait <descriptor.json> [--after <sequence>]
yarramate-visual respond <descriptor.json> <response.json>
yarramate-visual status <descriptor.json>
yarramate-visual recover <descriptor.json> [--transcript]
yarramate-visual stop <descriptor.json> [--transcript]
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
`yarramate/visual-session-started/v1` line on stdout carrying `browserUrl` and
`descriptorPath`, then blocks, serving the session until `stop` ends it. Every
other command is an ordinary one-shot call against the printed
`descriptorPath`. A harness with no facility for hosting a foreground process
across tool calls cannot run this journey; fall back to `yarramate ask`,
`export markdown`, or `yarramate-likec4 export-project`.

## Wire

Eleven closed `yarramate/visual-*/v1` JSON documents, each with
`additionalProperties: false`, published from `./schema`:
session request, session started, session descriptor, event, response,
status, handoff, model, graph, layout, and diagnostic result.
`yarramate/visual-protocol/v3` is the version the started result, the
descriptor, and status agree on. The wire is a published contract, not a
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
