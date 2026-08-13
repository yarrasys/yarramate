# Visual architecture conversations

Beta: the browser workspace and delegated-chat journey are new and still
settling. Tell the user this is a beta feature when you hand over
`browserUrl` — do not present it as a finished journey.

One local browser session that renders LikeC4 views of a bounded slice, opened
and owned by you. `yarramate-visual` is a sibling runtime binary beside
`yarramate-likec4`; it is presentation, never a subcommand of the semantic
`yarramate` CLI, and it never becomes canonical architecture by itself.

Run the phases in order. Each one decides an input the next phase needs.

```text
classify authority -> preflight the compiler -> check harness capability
  -> write the session request -> start the managed process
  -> capable: delegate the child and await handoff
  -> incapable: diagram-only, conversation stays here
  -> End or failure: recover, transcript on demand, stop, resume
```

## 1. Classify authority

Decide `canonical` or `ad-hoc` before touching the runtime. The browser labels
the rendering with this value, so it is a claim about where the picture came
from.

| Request | Authority | Source of the model |
|---|---|---|
| This repository's architecture, and a workspace passes `yarramate check` | `canonical` | `yarramate ask <workspace> "<topic>" --json`, or an authored LikeC4 view when one already answers the request |
| This repository's architecture, but no workspace exists or `check` fails | neither yet | Offer **Discover an existing project** first; report the diagnostics. Do not depict repository architecture from a failing model |
| A general concept, a hypothetical question, or a comparison of options that are not declared intent | `ad-hoc` | A temporary LikeC4 model you author inside the session |

For `canonical`, render only concepts, relationships, and descriptions present
in the checked result:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate ask .yarramate/workspace.yaml "<the user's words>" --json
```

For `ad-hoc`, keep every source file inside the session model. Never write it
into `.yarramate/`, and never let it reach `apply`.

A choice confirmed in the browser is a recorded selection in the handoff, not
declared intent. It becomes canonical only through **Design a new solution**
and Git review, after the user asks for that as its own step.

## 2. Preflight the LikeC4 compiler

The request carries a trusted command vector; the runtime executes it and
nothing else. The browser and the child cannot change it. The compiler command
must be an absolute executable path; the runtime deliberately rejects relative
paths and `PATH` lookup.

1. Prefer a repository-local executable satisfying `>=1.59.2 <1.60.0`. Print
   its absolute path with
   `node -p "require('node:path').resolve('./node_modules/.bin/likec4')"`, run
   `<printed-path> --version`, then use
   `{"command": "<printed absolute path>", "args": []}`.
2. No compatible local executable? Ask the user once, in this turn, before
   resolving the pinned runner. Run `command -v npx`, require an absolute
   result, then use
   `{"command": "<printed absolute npx path>", "args": ["--yes", "likec4@1.59.2"]}`.
   Name the pin and say that it resolves into the npx cache and adds no
   repository dependency. Consent is per session; an unpinned or `@latest`
   runner is never the answer.
3. The pinned runner needs Node `>=22.22.3`. Below that floor, report the
   preflight diagnostic and stop — the semantic binaries keep the package's own
   Node contract, so nothing else is affected.

## 3. Check harness capability

Set `chatEnabled: true` only when all four are true of the harness you are
actually running in, judged from its tool inventory and documented lifecycle
guarantees rather than its name:

1. it can delegate a long-lived child agent;
2. that child can make blocking CLI calls;
3. child completion is delivered back to this parent conversation;
4. this parent stays interruptible and recoverable while the child runs.

`chatEnabled: true` also means the parent will attach the delegated visual LLM
agent described below. A canned, scripted, or transport-only responder may test
the wire, but it does not satisfy this capability gate and must not be presented
to the user as embedded chat. If no delegated LLM child will own the
`wait`/`respond` loop, use diagram-only mode.

A delegation tool alone is not enough. If any one is false, set
`chatEnabled: false`: the browser opens in **diagram-only mode**, the user
navigates views, and the conversation continues here in the main harness. Say
which capability was missing; a well-known harness name is not evidence.

## 4. Write the session request

`yarramate/visual-session-request/v1`. Session identifiers, ports, URLs,
capabilities, and filesystem locations are runtime outputs — never supply them.

```json
{
  "format": "yarramate/visual-session-request/v1",
  "authority": "canonical",
  "title": "Delivery architecture",
  "description": "Checked slice of .yarramate/workspace.yaml",
  "chatEnabled": true,
  "compiler": { "command": "/absolute/path/to/node_modules/.bin/likec4", "args": [] },
  "initialModel": {
    "format": "yarramate/visual-model/v1",
    "authority": "canonical",
    "initialView": "overview",
    "sourceDigests": { ".yarramate/workspace.yaml": "<sha256>" },
    "files": {
      "likec4.config.json": "{\"name\":\"delivery\"}",
      "model.likec4": "model { … }",
      "views/overview.likec4": "views { view overview { include * } }"
    }
  }
}
```

`authority` on the request and on the model agree. `sourceDigests` records what
a canonical rendering was derived from; leave it empty for `ad-hoc`.

For design choices, build one compact comparison view carrying the question,
the options, their principal consequences and any recommendation, then one
linked detail view per option, and state each view's source and authority in
its description.

## 5. Start the managed process

```text
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
`start` — it never returns, so a call timeout kills the session.

A harness with no facility that can host a foreground process across tool calls
cannot run this journey at all. Say so and answer with the semantic journeys
instead: `yarramate ask`, `export markdown`, and `yarramate-likec4
export-project` for a rendering the user opens themselves. Detaching `start`
with `nohup`, `setsid`, `&`, `screen`, or a process manager is not the
substitute — a detached server is one the harness can no longer stop, and
`stop` is what deletes the session.

Give the user `browserUrl` as soon as the log yields it, alongside a one-line
beta disclosure — the browser workspace is new and still settling. The
started line never carries the agent capability; that lives only in the mode
`0600` descriptor.
Pass the descriptor **path** to the child, never its contents.

## 6. Delegate the visual agent

Capable harness only. One main conversation owns at most one session, one
child, and one in-flight turn. The child prompt states its authority verbatim:

Do not replace this child with a fixed-response script: the protocol is
model-provider-neutral, but the embedded conversation still requires the
harness's delegated LLM.

```text
You are the delegated YarraMate visual agent for one session.
You may call read-only YarraMate commands and yarramate-visual wait/respond/status/recover.
You may replace only the temporary yarramate/visual-model/v1 session model.
You must not edit repository files, .yarramate/, credentials, or harness configuration.
On session.end or any terminal diagnostic, publish handoff.complete and exit.
```

Add the user's question, the descriptor path, the authority label, and the
checked slice or the ad-hoc marker. That authority is temporary and
visual-model-only; it does not widen because the browser asks.

The child loops on one event at a time:

1. `wait <descriptor> --after <lastSequence>`. Empty stdout is an idle window,
   not a failure — call again from the same sequence.
2. Answer from the bounded slice. Outside it, say so rather than inferring.
3. `respond <descriptor> <response.json>` with a
   `yarramate/visual-response/v1` document whose `sessionId` is this session's
   own identifier, `eventId` is the event being answered, `responseId` is a
   fresh 32 lowercase hex string, and `timestamp` is an ISO instant with
   exactly three millisecond digits. The type is `chat.response`,
   `agent.status`, `choice.present`, `model.replace`, `handoff.complete`, or
   `diagnostic`. A response for another session is rejected.
4. Advance `--after` to that event's `sequence`.

The next chat turn is released only once the current event has a response or a
terminal diagnostic; the browser may keep navigating meanwhile. A rejected
`model.replace` keeps the last good diagram and returns source-located
diagnostics — correct the sources and replace again; never patch partially.

Limits freeze input rather than truncate: 64 KiB per message, 5 MiB per
candidate model, 5 MiB of transcript, 32 pending events. A frozen queue routes
the session through recovery. `status` reports `lifecycle`, `frozen`,
`frozenReason`, `inFlightEventId`, and `lastSequence` without mutating
anything.

## 7. Diagram-only mode

`chatEnabled: false` still starts the same managed process and the same
renderer. There is no child. You hold the conversation in the main harness,
re-render by writing a new request when the user's question moves, and end the
session with the same recovery sequence.

## 8. End, failure, and recovery

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
   `yarramate/visual-handoff/v1` document on the way out — the runtime's own,
   journaled terminal event and all — so recovering first is still the rule but
   the stop is not silent. Do not delete `sessionRoot`, and do not signal the
   process tree by hand — `stop` owns both. A repeated `stop` reports the
   already-stopped state: exit 0 with no document, because the session it would
   hand off is gone. A descriptor that is unreadable for any other reason still
   fails.
4. Stop the managed process by its registered name.
5. Resume the main conversation. Report the handoff, then treat
   `requestedChanges` as proposals for the ordinary journeys — never as edits
   already made.

A session that never started delegates nothing: report the diagnostic and
continue in the main harness. A hard-killed runtime leaves its directory
behind; the next `start` prunes it once it is more than 24 hours old.

## Report

Add to the normal handoff: authority label and its source, whether chat or
diagram-only ran and which capability decided it, the compiler that was used
and whether the pinned runner was consented, confirmed selections and requested
changes from the handoff, the termination reason, and confirmation that the
session was stopped.
