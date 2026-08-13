# Visual conversation adapter

> **Beta.** The browser workspace and the delegated-chat journey are new and
> still settling — expect rougher edges than the rest of YarraMate. The wire
> stays governed by the versioning rule in
> [ADR 0081](adr/0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md):
> `yarramate/visual-*/v1` is closed and stable now: beta status describes the
> browser experience, not the published contract.

The optional visual adapter opens one local, loopback-only browser session
that renders LikeC4 diagrams of a bounded slice and, when the host harness can
delegate a long-lived child agent, carries a chat conversation about what is
on screen. `yarramate-visual` is a sibling binary beside `yarramate-likec4`,
`yarramate-graphify`, and `yarramate-mcp` — presentation and runtime, never a
subcommand of the semantic `yarramate` CLI, and never a second claim origin.
YarraMate Core does not depend on it and stays unaware of any session.

## Authority is labeled, not inferred

Every rendered model is either `canonical` — derived from a projection result
of a workspace that already passed `check` — or explicitly `ad-hoc`, and the
browser states which. A diagram drawn or a choice confirmed during a
conversation never quietly becomes declared architecture; it becomes
canonical only through the normal **Design a new solution** journey and Git
review, after the user asks for that as its own step.

## Commands

```sh
yarramate-visual start <request.json>
yarramate-visual wait <descriptor.json> [--after <sequence>]
yarramate-visual respond <descriptor.json> <response.json>
yarramate-visual status <descriptor.json>
yarramate-visual recover <descriptor.json> [--transcript]
yarramate-visual stop <descriptor.json> <reason>
```

`start` is a managed foreground process, not a one-shot call: it publishes one
`yarramate/visual-session-started/v1` line on stdout carrying `browserUrl` and
`descriptorPath`, then blocks, serving the session until `stop` ends it. Every
other command is an ordinary one-shot call against the printed
`descriptorPath`. A harness with no facility for hosting a foreground process
across tool calls cannot run this journey; fall back to `yarramate ask`,
`export markdown`, or `yarramate-likec4 export-project`.

## Wire

Nine closed `yarramate/visual-*/v1` JSON documents, each with
`additionalProperties: false`, published from `./schema`:
session request, session started, session descriptor, event, response,
status, handoff, model, and diagnostic result. `yarramate/visual-protocol/v1`
is the version the started result, the descriptor, and status agree on. The
wire is a published contract, not a process-local convention, because the
journal that recovers a crashed session has to be readable by a process that
did not write it — see
[ADR 0081](adr/0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md).

## Boundary

The adapter does not:

- add a Core semantic verb, or widen native YarraMate meaning;
- promote a rendered or chosen diagram to canonical architecture by itself;
- call a model provider or hold credentials — the delegated chat agent
  belongs to whatever harness hosts the session;
- persist beyond the session: the server is loopback-only, ephemeral, and its
  directory is deleted on `stop`;
- accept a partial model patch — replacement is always the whole model, so
  validation and recovery operate on one atomic candidate at a time.

The full operating sequence — authority classification, compiler preflight,
harness capability detection, delegating the visual agent, and end/failure
recovery — is the canonical
[`yarramate-architecture` skill's visual-conversations reference](../skills/yarramate-architecture/references/visual-conversations.md).
Git review remains responsible for accepting any resulting architecture
proposal.
