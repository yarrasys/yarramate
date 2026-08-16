# Visual architecture conversations

Beta: the browser workspace and the delegated-chat journey are new and still
settling. Tell the user this is a beta feature when you hand over
`browserUrl` - do not present it as a finished journey.

One local browser session that renders the native YarraMate model directly with
cytoscape.js, lets a reviewer edit the concepts and relationships on the canvas
and land those edits through `apply`, and - when the harness can delegate a
child agent - carries a chat conversation about what is on screen.
`yarramate-visual` is a sibling runtime binary beside `yarramate-likec4`; it is
presentation and runtime, never a subcommand of the semantic `yarramate` CLI,
and never a second claim origin.

Run the phases in order. Each one decides an input the next phase needs.

```text
build the session request -> check harness capability
  -> start the managed process
    -> capable: delegate the child and await handoff
    -> incapable: diagram-only, the conversation stays here
  -> End or failure: recover, transcript on demand, stop, resume
```

## 1. Build the session request

```sh
yarramate-visual request [--view <id>] [--title <text>]
                         [--description <text>] [--chat] > request.json
```

This is the only verb that reads the repository instead of a session. It
compiles the workspace at `.yarramate/workspace.yaml`, projects the native
semantic graph the canvas draws, digests every source that compiled, resolves
the view list, and prints one `yarramate/visual-session-request/v1` document on
stdout. Redirect it to a file; that file is `start`'s only argument.

Never hand-author this document. Its graph is the whole compiled model -
hundreds of nodes and edges for a real repository - and its digests must match
the bytes that compiled.

| Flag | Effect |
|---|---|
| `--view <id>` | The projection the browser opens on. Defaults to the first the workspace declares. |
| `--title <text>` | Header title. Defaults to the workspace id. |
| `--description <text>` | Header description. Defaults to a line naming the workspace and its manifest. |
| `--chat` | Ask for the delegated-chat capability. Omit it for diagram-only. |

Authority is always `canonical`. The session renders the checked workspace and
every edit it commits lands in that same workspace, so there is no scratch or
hypothetical rendering to label. A hypothetical belongs in the semantic
journeys - `yarramate design`, `yarramate ask` - or on a branch.

Failure is a refusal on stderr carrying `yarramate/visual-diagnostic-result/v1`,
before any session exists: an unreadable manifest (`YMVS410`), an unreadable
source (`YMVS411`), a workspace that does not compile (the compiler's own
source-located diagnostics), no loadable projection (`YMVS412`), or a `--view`
the workspace does not declare (`YMVS413`, naming the ones it does). Fix the
workspace and build the request again - do not start a session around a
diagnostic.

## 2. Check harness capability

`--chat` is a request, not a guarantee. The delegated chat needs both a
long-lived child agent with a model provider and a harness that can host a
foreground process across tool calls. Without the child, drop `--chat` and run
diagram-only: the reviewer still edits, commits, filters, and saves, because the
runtime answers all of that itself. Without the foreground-process facility you
cannot run this journey at all - see phase 3.

The published `capabilities` block on the started line is the truth of what the
session offers: `chat`, `choices`, `navigation`, `transcript`.

## 3. Start the managed process

```sh
yarramate-visual start <request.json>
yarramate-visual wait <descriptor.json> [--after <sequence>]
yarramate-visual respond <descriptor.json> <response.json>
yarramate-visual status <descriptor.json>
yarramate-visual recover <descriptor.json> [--transcript]
yarramate-visual stop <descriptor.json> [--transcript]
```

`start` publishes one `yarramate/visual-session-started/v1` line on stdout
carrying `browserUrl`, `descriptorPath`, `sessionRoot`, and `capabilities`,
then blocks, serving the session until it is stopped.

It is a managed foreground process, not a shell job and not a daemon. Launch it
through the harness's long-running-process facility: register it under a stable
name with a readiness condition matching that first stdout line, read
`browserUrl` and `descriptorPath` out of the process log, drive every other
command as an ordinary one-shot call against `descriptorPath`, and terminate it
by that same name once the session is over. An ordinary tool call cannot host
`start` - it never returns, so a call timeout kills the session.

A harness with no facility that can host a foreground process across tool calls
cannot run this journey at all. Say so and answer with the semantic journeys
instead: `yarramate ask`, `export markdown`, and `yarramate-likec4
export-project` for a rendering the user opens themselves. Detaching `start`
with `nohup`, `setsid`, `&`, `screen`, or a process manager is not the
substitute - a detached server is one the harness can no longer stop, and
`stop` is what deletes the session.

Give the user `browserUrl` as soon as the log yields it, alongside a one-line
beta disclosure - the browser workspace is new and still settling. The
started line never carries the agent capability; that lives only in the mode
`0600` descriptor.
Pass the descriptor **path** to the child, never its contents.

## 4. What the runtime answers without an agent

Four browser events are mechanical: the reviewer's intent is fully determined,
so the runtime answers them itself, synchronously, with no agent in the loop.
They are why a diagram-only session is still a working session.

| Browser event | Runtime answer | What lands on disk |
|---|---|---|
| `filter.query` | `filter.result` | nothing - narrows what is drawn |
| `view.save` | `view.save.result` | the projection document for that view |
| `changeset.commit` | `apply.result` | the workspace documents the batch addresses |
| `layout.save` | `layout.save.result` | `.yarramate/visual-layout/<projectionId>.yaml` |

`changeset.commit` carries a `yarramate/operations/v1` batch that the inspector
assembled from dropdown-constrained field edits and the reviewer staged one row
at a time. The runtime hands it to the same `apply` write path a human runs:
the whole candidate workspace must compile before a single byte lands, a
rejected batch leaves the tree untouched, and its source-located diagnostics
come back pinned to the staged row that caused them. The runtime never runs a
Git command - a landed commit is an ordinary working-tree diff for Git review to
accept or discard, and revert is `git revert` or `git checkout`, never a
protocol verb
([ADR 0084](../../../docs/adr/0084-a-mechanical-edit-lands-through-apply-not-through-the-agent.md)).

A dragged position is presentation, not an operation: `layout.save` writes an
adapter-owned sidecar per projection and never routes through `apply`
([ADR 0085](../../../docs/adr/0085-a-dragged-position-is-presentation-the-repository-keeps.md)).

Four presentation toggles ride in `view.save`'s `presentation` object alongside `layout`, `direction`, and `seed`: `showLifecycle`, `showEvidence`, `showOwnership` (three badge toggles controlling what is drawn on each node — status, evidence marks, owner initials), and `notation` (switching between `native` and `archimate` rendering modes). None of these compose a filter or fire `filter.query`; toggling a badge or notation checkbox dispatches `onTogglePresentation` and updates state locally without consulting the model, and they save and reload as projection presentation fields, never as operations. They are why a reviewer can tweak the canvas appearance mid-session without publishing a semantic change.


The chat agent has no part in any of this and cannot author a model - the wire
has no `model.replace`. Chat explains, filters, and focuses; the reviewer edits.

## 5. Delegate the visual agent

Capable harness only. One main conversation owns at most one session, one
child, and one in-flight turn. The child prompt states its authority verbatim:

Do not replace this child with a fixed-response script: the protocol is
model-provider-neutral, but the embedded conversation still requires the
harness's delegated LLM.

```text
You are the delegated YarraMate visual agent for one session.
You may call read-only YarraMate commands and yarramate-visual wait/respond/status/recover.
You explain, filter, and focus the diagram; you never author or mutate the model.
You must not edit repository files, .yarramate/, credentials, or harness configuration.
On session.end or any terminal diagnostic, publish handoff.complete and exit.
```

Add the user's question, the descriptor path, and the workspace the session
renders. The child sees only the conversational events - `chat.message` and
`choice.selected`; the four mechanical events never reach it.

The child loops on one event at a time:

1. `wait <descriptor> --after <lastSequence>`. Empty stdout is an idle window,
   not a failure - call again from the same sequence.
2. Answer from the rendered model. Outside it, say so rather than inferring.
   When the turn resolves a filter or focus request rather than a pure
   explain request, call the `yarramate_ask` MCP tool with the resolved
   query text and no `budget` (the server then appends `--json`, so the CLI
   returns a `yarramate/ask-result/v1` document carrying `seeds` and
   `result.subjects` instead of budgeted prose). Build
   `query: { subjects: seeds, relationships: 'connected' }` - the identical
   seed-focus `ProjectionQuery` shape `ask-command.ts`'s `sliceProjection`
   already builds internally (`ask-command.ts:398`) - and set
   `appliedQuery: { query, matchedIds: result.subjects.map(s => s.id) }` on
   the `chat.response` payload (`VisualChatResponsePayload`,
   `protocol-contract.ts:254`) before calling `respond`. A pure explain
   request sends no `appliedQuery`, unchanged.
3. `respond <descriptor> <response.json>` with a
   `yarramate/visual-response/v1` document whose `sessionId` is this session's
   own identifier, `eventId` is the event being answered, `responseId` is a
   fresh 32 lowercase hex string, and `timestamp` is an ISO instant with
   exactly three millisecond digits. The type is `chat.response`,
   `agent.status`, `choice.present`, `handoff.complete`, or `diagnostic`. A
   response for another session is rejected.
4. Advance `--after` to that event's `sequence`.

The next chat turn is released only once the current event has a response or a
terminal diagnostic; the browser may keep navigating, filtering, editing, and
committing meanwhile.

Limits freeze input rather than truncate: 64 KiB per chat message, 5 MiB per
model, 5 MiB of transcript, 32 pending events. A frozen queue routes the
session through recovery. `status` reports `lifecycle`, `frozen`,
`frozenReason`, `inFlightEventId`, and `lastSequence` without mutating
anything.

## 6. Diagram-only mode

`chatEnabled: false` starts the same managed process, the same renderer, and
the same editing and commit path - the runtime answers all four mechanical
events itself. There is no child. You hold the conversation in the main
harness, and you learn what the reviewer did from `recover`, not from a chat
transcript.

## 7. End, failure, and recovery

Normal End, a child crash, a server or compiler failure, a browser that stays
away past its five-minute grace, a protocol mismatch, or your own cancellation
all take one path. You are the parent and the source of authority; the child is
disposable.

```sh
yarramate-visual recover <descriptor.json>              # structured handoff
yarramate-visual recover <descriptor.json> --transcript # only if the summary is not enough
yarramate-visual stop <descriptor.json>                 # shuts down, prints the handoff, then deletes
```

1. `recover` first, always, before anything is torn down. It returns
   `yarramate/visual-handoff/v1`: `summary`, `confirmedDecisions`,
   `requestedChanges`, `unresolvedQuestions`, `finalViews`, `authority`,
   `decision`, `terminationReason`, `lastSequence`, and `transcriptPath`. This
   is the record of what happened; your recollection is not.
2. Request `--transcript` only when the summary leaves a question open. It is
   available until you stop the session.
3. `stop` performs recoverable shutdown, terminates the server process tree,
   and deletes the session directory itself. It prints the terminal
   `yarramate/visual-handoff/v1` document on the way out - the runtime's own,
   journaled terminal event and all - so recovering first is still the rule but
   the stop is not silent. Do not delete `sessionRoot`, and do not signal the
   process tree by hand - `stop` owns both. A repeated `stop` reports the
   already-stopped state: exit 0 with no document, because the session it would
   hand off is gone. A descriptor that is unreadable for any other reason still
   fails.
4. Stop the managed process by its registered name.
5. Resume the main conversation. Report the handoff. Treat `requestedChanges` as
   proposals for the ordinary journeys - but a `changeset.commit` that landed is
   not a proposal, it is a working-tree change; surface it as one.

A session that never started delegates nothing: report the diagnostic and
continue in the main harness. A hard-killed runtime leaves its directory
behind; the next `start` prunes it once it is more than 24 hours old.

## Report

Add to the normal handoff: whether chat or diagram-only ran and which capability
decided it, what the reviewer committed and what `git diff` now shows, any view
or layout the session saved, confirmed selections and requested changes from the
handoff, the termination reason, and confirmation that the session was stopped.
