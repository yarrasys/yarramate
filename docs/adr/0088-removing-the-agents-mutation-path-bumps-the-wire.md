# Removing the agent's mutation path bumps the wire

Status: accepted

[ADR 0084](0084-a-mechanical-edit-lands-through-apply-not-through-the-agent.md)
removed the delegated agent's ability to author a model: `model.replace` and
its `modelReplacePayload` are gone from the published response contract, and a
mechanical edit now lands through `changeset.commit` -> `yarramate apply`
instead. This ADR records the consequence for the version string that names
the wire: `yarramate/visual-protocol/v1` becomes
`yarramate/visual-protocol/v2`.

## Why a removal is not an addition

The browser's own surface only grew. Its four v1 events — `chat.message`,
`choice.selected`, `view.navigate`, `session.end` — are all still accepted with
their original shapes, and four more joined them (`filter.query`, `view.save`,
`layout.save`, `changeset.commit`). A v1 browser bundle talking to a v2 runtime
would work unchanged. Read only from the browser's seat, this looks like an
additive change that keeps the version.

The browser is not the only party. [ADR 0081](0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md)
is explicit about who agrees on this wire:

> Four parties have to agree on this wire — the canonical skill, the host
> harness, the browser bundle, and the delegated child — and no two of them
> ship together. That is what makes it a contract rather than an
> implementation.

The delegated child is the party that lost something. A child built against v1
answers a turn by emitting `model.replace`; against v2 that response fails
schema validation and the turn is refused. Nothing about the version string
would have told it why. Keeping `v1` on a contract that no longer honours a v1
response is the one outcome the version exists to prevent — it converts a
detectable incompatibility into a runtime fault that reads like a bug in the
child.

## Decided

`VISUAL_PROTOCOL_VERSION` is `yarramate/visual-protocol/v2`. The started
result, the session descriptor, and the status document carry it, and their
schemas pin it as a `const`, so a v1 consumer reading any of the three sees the
mismatch before it sends anything.

Each of the eleven `yarramate/visual-*/v1` documents keeps its own `format`
string at `v1`. Those name document shapes, not the conversation, and the
shapes that survived did not change. Only the response document dropped a
member, and a document that gains and loses members under a stable `$id` is
what the protocol version is for.

## Not a compatibility shim

The runtime does not accept `model.replace` from a v1 child and translate it
into a commit. That would restore exactly the authority ADR 0084 removed — a
model the agent authored, landing without passing through `apply` — under a
name that hides it. A v1 child is refused, and the operator upgrades it.
