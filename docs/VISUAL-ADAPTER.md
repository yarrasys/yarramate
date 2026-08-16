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
`yarramate/visual-protocol/v1` is the version the started result, the
descriptor, and status agree on. The wire is a published contract, not a
process-local convention, because the journal that recovers a crashed session
has to be readable by a process that did not write it — see
[ADR 0081](adr/0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md).

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
