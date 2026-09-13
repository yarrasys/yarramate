# An agent answers a delegated question by proposing, and the reviewer commits

Status: accepted

## Context

ADR 0150 gave every open question a verb a person runs by hand. The same
day Nabeel asked for the other door: "answer via agent". Issue #515 sketched
it as the agent running `design --subject`, talking to the person in the
chat section, and landing the answer with `apply`.

That last step contradicts two decisions this adapter rests on. ADR 0084
made every mechanical edit land through the reviewer's changeset and
`apply`, not through the agent, and ADR 0088 removed the agent's mutation
path from the wire and bumped the protocol to make a v1 child refusable.
The delegated visual agent's prompt states its authority verbatim: it
explains, filters and focuses the diagram; it never authors or mutates the
model. An "answer via agent" that had the agent write would reopen the path
those two ADRs closed, and it would also reintroduce the race ADR 0093 pins
against: an agent writing under a canvas that holds staged rows.

There is also a second population to serve. A host with no agent on the
socket (the mounted editor, a desktop app with no session, claude.ai in a
tab) has nobody to delegate to, and still has a person with an assistant
somewhere.

## Decision

1. **A delegated question is a chat turn by another door.** The browser
   sends `question.delegate` with the question id, the subject id (null for
   a workspace question) and the phrasing. The runtime journals it, shows it
   in the transcript as the reviewer's own line ("Answer via your agent:
   …"), and queues it for the agent like a chat message. It needs the chat
   capability, because it needs the agent.
2. **The agent answers by proposing.** A new response type,
   `operations.propose`, carries a `note` and a `yarramate/operations/v1`
   list. The browser stages each operation into the reviewer's changeset as
   if drafted by hand, and shows the note in the transcript. The reviewer
   reads the rows and commits, through the same `apply` path as every other
   edit. The agent's authority is unchanged: it proposes, the reviewer lands.
   `operations.propose` completes the turn, so the next question can follow.
3. **Authority stays with the catalogue.** For a question marked `human`
   the agent asks the person in the chat, by message or by a choice, and
   proposes what they said. For `agent` or `either` it may propose from the
   record and the evidence, and its note says which it did.
4. **Two more doors, one label each.** A mounted host may pass
   `onDelegateQuestion` and route the question to its own assistant; the row
   reads "Answer via assistant". A host that passes nothing gets "Copy for my
   assistant": the row puts the question, why it matters, what closes it and
   the operations skeleton the trigger implies on the clipboard, so the
   answer comes back as a document `apply` accepts. Neither door touches the
   socket, and the local host still refuses `question.delegate` with
   `YMVS316`, as it refuses every question for an agent.
5. **Viewers keep reading.** Under `readOnly` no row offers any door.

## Consequences

- The wire grows one browser event and one response type. The event journal
  carries eleven kinds and frames carry ten response types; the visual
  event and response schemas gain a branch each. No version bump: an old
  child never sees `question.delegate` unless a new browser sends it, and an
  old browser never receives `operations.propose` unless a new child sends
  it; both are refused by the schema they do not know, which is the
  existing behaviour for an unknown type.
- The child's prompt gains one paragraph: what to do with a delegated
  question and how to answer it. Its authority sentence does not change.
- The "lands it with apply" wording in #515 is superseded by this ADR.
- `apply` of a proposed batch is where an agent's mistake is caught, in
  front of the reviewer, with the diagnostics pinned to the staged rows:
  exactly where a hand-drafted mistake is caught today.

## Verification

- `visual-app-state.test.ts`: a `delegate` intent becomes a
  `question.delegate` input; an `operations.propose` frame becomes a
  transcript line and one staged row per operation.
- `visual-session-server.test.ts`: the browser's `question.delegate` is
  accepted, journaled, shown in the transcript as the reviewer's line, and
  reaches the agent's feed; the agent's `operations.propose` is accepted,
  completes the turn, and reaches the browser as a response frame.
- `visual-local-host.test.ts`: `question.delegate` is refused with
  `YMVS316` like every question for an agent.
- `open-questions.test.ts`: the delegate button renders with the label the
  host gave it, and not for a viewer.
- `question-verbs.test.ts`: the assistant brief carries the question, the
  materiality, the resolution and a skeleton with the subject on the right
  end for an incoming relationship.
