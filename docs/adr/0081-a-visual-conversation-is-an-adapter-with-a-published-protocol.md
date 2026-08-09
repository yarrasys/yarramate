# A visual conversation is an adapter with a published protocol

Status: accepted

The approved visual-architecture-conversations design adds a browser
application that renders LikeC4 diagrams, carries chat turns with a
delegated visual agent, and returns a recoverable handoff to the main
agent. Two questions had to be settled before any of it could be built:
where the runtime sits relative to the semantic CLI, and whether the wire
between skill, harness, browser, and delegated agent is a published
contract or an internal detail.

Decided: `yarramate-visual` is a sibling binary beside `yarramate-likec4`,
`yarramate-graphify`, and `yarramate-mcp`, and its wire is nine closed
versioned JSON documents exported from the package:

- `./schema/visual-session-request` — what the trusted main agent asks for,
  including authority mode, initial model, and the LikeC4 compiler command
  vector;
- `./schema/visual-session-started` — the public start result: session ID,
  authenticated browser URL, descriptor path, protocol version, and
  capabilities, never the agent credential;
- `./schema/visual-session-descriptor` — the private mode `0600` handle the
  one-shot commands authenticate with;
- `./schema/visual-event` and `./schema/visual-response` — the two halves
  of a turn;
- `./schema/visual-model` — one complete candidate model, never a patch;
- `./schema/visual-handoff` — what survives the session;
- `./schema/visual-status` — lifecycle without mutation;
- `./schema/visual-diagnostic-result` — every failure, in one shape.

`yarramate/visual-protocol/v1` is the version the started result, the
descriptor, and status agree on; each document additionally names its own
`format`. Four parties have to agree on this wire — the canonical skill,
the host harness, the browser bundle, and the delegated child — and no two
of them ship together. That is what makes it a contract rather than an
implementation.

## Not a Core verb

`yarramate visual` was the obvious shape and is wrong for the reason the
MCP affordance ships as `yarramate-mcp` (ADR 0044): the semantic CLI is the
tool-neutral surface, and a long-lived localhost webserver driving a React
bundle is presentation and runtime. ADR 0023 drew the same line in the
smaller case, keeping comparison colors in the adapter while Core kept the
classification.

The concrete costs of crossing it are three. Core's release contract would
acquire a browser bundle and a WebSocket transport as versioned surface,
so a renderer change would become a Core compatibility event. Core's
Node.js floor would have to rise to whatever the selected LikeC4 compiler
requires — `>=22.22.3` for the currently pinned runner — punishing every
`check` user for a feature they never open; as a sibling binary the same
mismatch is a visual preflight diagnostic instead. And a verb implies a
verb's semantics: `check`, `ask`, and `export` answer and exit, while this
one blocks in the foreground until a human clicks End, which is a
different kind of thing wearing the same word.

## Not process-local JSON

The cheaper alternative was to leave the wire unversioned and undocumented:
whatever objects the skill and the runtime happened to exchange, private by
convention. It fails on recovery, which is the feature.

The journal has to be readable by a process that did not write it. The
whole point of appending before acknowledging is that a runtime which died
mid-turn can be recovered by a later `recover` — possibly a later build.
An undocumented shape makes recovery a guess about the previous version of
ourselves. The same argument applies across the other three parties: a
harness that mis-parses a handoff silently loses confirmed decisions, and
a browser bundle one release out of step with the runtime fails in a way
nobody can attribute. ADR 0018 settled this for `check --json`, and the
reasoning transfers unchanged: the alternative to a versioned envelope is
not "no contract", it is an undeclared contract that breaks quietly.

## The trade-offs the boundary makes

**Authority is labeled, not inferred.** Every rendered model is either
`canonical` — derived from a projection result of a workspace that passed
`check` — or explicitly `ad-hoc`, and the browser says which. The cost is
that a diagram drawn during a conversation can never quietly become
declared intent; promoting it means authoring it through the normal write
surface. That is the point. A renderer that blurred the two would make the
model's central claim, that intent is declared, unverifiable by looking.

**The server is loopback and ephemeral.** It binds `127.0.0.1` on a random
port with separate high-entropy browser and agent capabilities, in a
session directory created `0700` with sensitive files `0600`, and it is
deleted on stop. Nothing is shareable, resumable, or reachable from another
machine, which rules out the demo-link use case. In exchange there is no
hosting story, no multi-tenancy, and no authorization model beyond two
capabilities.

**The journal is append-only and written before the acknowledgement.** An
accepted browser event is appended before it is acknowledged and an
accepted response before it is broadcast, so a crash cannot have
acknowledged something recovery cannot see. The cost is that nothing can be
unsaid: an accepted event is in the record for the life of the session, and
every limit — message size, model size, transcript size, queue depth —
freezes input and routes the session through recovery rather than
truncating an accepted event. Losing the tail is not available as a
shortcut.

**The child is provider-neutral.** `yarramate-visual` never calls a model
provider and stores no credentials; inference belongs to whatever harness
delegated the child. This means the runtime cannot answer a chat message on
its own, and a harness without delegation gets no chat at all. It also
means the runtime has no provider abstraction to maintain, no key handling,
and nothing to leak.

**The fallback is capability-detected, not name-detected.** The skill asks
whether the running agent can actually delegate a long-lived child, let it
block on CLI calls, and receive its completion or the user's interruption
while it runs. A delegation tool alone is not enough. When any of that is
missing the same renderer opens in diagram-only mode and the conversation
stays in the main harness. Detection by harness name would be shorter and
would be wrong the first time a harness changed, in the direction that
strands a user in front of a chat box nobody is reading.

**The transcript is opt-in.** `recover` returns the structured summary —
decisions, requested changes, open questions, final views, last sequence,
termination reason — and the raw transcript only when asked, until the
handoff is accepted or the session stops. The main agent pays for the full
text only when it wants it, and the default path does not force a whole
conversation back through a context window.

## Consequences

The nine documents and the `yarramate-visual` binary are public surface
from this point, and every one of the nine is closed:
`additionalProperties: false` throughout, enforced by Ajv in the runtime,
which parses every browser event, agent response, model, and handoff before
accepting it. Nothing silently ignores a field it does not recognize, so
there is no such thing as a quietly additive change here. Any change to a
v1 field set — adding an optional field included — is
compatibility-significant and lands as a coordinated schema-and-parser
update across the parties that read it. Changes that cannot be made
compatibly mint a new version beside v1: `yarramate/visual-event/v2` next
to `yarramate/visual-event/v1`, on the ADR 0018 rule.

Closing the schemas was the deliberate side of that trade. An open envelope
would buy tolerant readers at the cost of accepting a typo'd field name as
an unremarkable extension, in a protocol whose events are the recovery
record. The cost is paid in release coordination, which is visible, rather
than in silently dropped payloads, which is not.

Core stays unaware of any of it. Nothing in the semantic CLI, the graph, or
the native document format references a visual session, so the runtime can
be replaced or dropped without a Core compatibility event — which is the
property the sibling-binary boundary was chosen to buy.

The deferred surface is deliberate and named in the design: one session per
conversation, one child, one in-flight turn, whole-model replacement,
localhost only. Each is reachable later under the versioning rule above.
Partial model patches are the one that would be felt first, and they were
excluded so that validation and recovery both operate on a single atomic
replacement rather than on a history of diffs.

## What the schemas alone do not say

Two invariants of this contract are not expressible in JSON Schema, and a
consumer validating a document with the published schema and nothing else
is holding a looser check than the runtime's:

- **The 64 KiB chat bound is bytes, not characters.** `maxLength: 65536` on
  `chatMessagePayload.text` counts Unicode characters, so a multi-byte
  message can pass the schema at roughly three times the intended size. The
  schema bound is a backstop; `VISUAL_LIMITS.messageBytes` measured with
  `Buffer.byteLength` is the real limit, and the runtime enforces it on
  every browser input, event, and response it parses. The same holds for
  the 5 MiB model and transcript ceilings.
- **A handoff's transcript belongs to the handoff's own session.** Each
  entry validates independently as `visual-event/v1` or
  `visual-response/v1`; nothing in the document relates it to the
  `sessionId` that carries it. The runtime refuses a foreign entry, and
  that is the one cross-session check no schema in the set can make.

Both are enforced in `protocol.ts` beside the Ajv validators, so a document
that reaches the runtime is held to the tighter rule. Tightening either
schema would not be a clarification: byte length and cross-field ownership
are not schema keywords, and inventing an approximation would refuse valid
documents. A consumer that validates independently should measure bytes and
check transcript ownership itself.
