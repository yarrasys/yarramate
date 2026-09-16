# A host-built mount takes options, and a closing frame carries the host's sentence

Status: accepted

Two things the hosted editor page (#545) could not say to the editor.

`mountEditor(element, options)` installs the ELK worker from
`options.workerFactory` and terminates it on unmount (#490).
`mountEditorWith(element, host, sections, readOnly, decorations,
onDelegateQuestion, view, onFirstModel)` is positional, kept that way for
the 1.1.0 callers (ADR 0117), and stops at the first-model callback: a page
that brings its own host had no worker slot and laid out on the main thread,
the freeze #490 removed for the store-backed mount.

The `closing` frame carried a reason code from the session server's own
vocabulary and nothing else. The reducer stored it and the shell showed one
fixed sentence for every closed session, "Visual conversation ended.
Continue in the main agent.", true of a session server session and false
of a hosted workspace with no agent. `lost` on the host seam means "may
come back" and the socket host retries it. So a host that ended a session
for good with something to say, a connection cap, a member removed while
connected, a workspace deleted, had nowhere to put the sentence and no
way to stop the retries but a custom DOM event beside the seam.

## Decision

`mountEditorWith` has an options form beside the positional one:
`mountEditorWith(element, host, options?: MountWithOptions)`, where
`MountWithOptions` is every `MountOptions` field that is not the local
host's (`sections`, `readOnly`, `decorations`, `workerFactory`,
`onDelegateQuestion`, `onFirstModel`, `view`). Both forms run one mount,
which owns the worker's install and teardown, so a host-built mount and a
store-backed one treat a factory identically. The positional form stands.

The `closing` frame's `reason` admits `host-ended` beside the session
server's reasons, and the frame may carry `message`, the host's own
sentence. The reducer keeps it as `closedMessage`; the shell shows it in
place of the fixed sentence when present. `createSocketHost` maps a
WebSocket close code in 4000 to 4999, the application range, to a `closing`
frame with `reason: 'host-ended'` and the close frame's reason text as
`message`, and stops; every other code stays `lost` plus retry. The frame
is TypeScript on the seam and not a published JSON document (the event
schema's `terminationReason` binds the End event and the handoff, not this
frame), so the addition is additive and no schema moves.

## Consequences

- The hosted page drops its custom DOM event and keeps the close codes it
  chose; they are the published behaviour now.
- `VisualAppState` gains `closedMessage: string | null`; the two test
  fixtures that construct the state literally gained the field, which is
  the readers-versus-constructors rule doing its job.
- `createLocalHost` never sends `closing`; nothing changes there.
- A future white-labelling option (#546) will word the fixed sentence too;
  this decision gives the host a sentence per event, which is a different
  thing.
