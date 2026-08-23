# A refusal is visible, or it is counted

Status: accepted

The canvas reported a failed compile as a flat list of codes and byte offsets,
and marked nothing on the diagram. A reviewer read "the last change did not
compile", looked at the picture, and saw exactly what they saw before.

[ADR 0093](0093-a-commit-states-what-it-was-staged-against.md) made a refused
commit keep its rows and state what it was staged against, and the `subjects`
derivation added for a drawing consumer gave a diagnostic a subject to point
at. This ADR says what the canvas owes the reviewer once it has one.

## Why

**The derivation existed and this adapter never used it.** Core populates
`subjects` wherever a diagnostic's pointer identifies one, precisely so a
canvas can badge the element a rule refused. It is applied where a result is
published, which keeps compiler diagnostics a pure function of the model, and
`check` had always called it. The visual session server never did, so every
diagnostic it sent a browser arrived anchored to a byte offset a browser cannot
use. The consumer the derivation was written for was the one consumer that
never received it.

**Marking only what can be marked is worse than marking nothing.** Some
diagnostics belong to no drawn subject: a YAML parse failure, a manifest, a
projection's own definition, a subject the active view filters out. If the
canvas marks the ones it can and says nothing else, a reviewer sees a diagram
with two red boxes, believes those are the problems, and commits. The count on
screen has to be the whole count.

## Decided

**Every diagnostic is counted, and the summary never reads clean while one
is open.** It states the total, how many are marked on the diagram, and how
many are not:

```
3 problems: 1 marked on the diagram, 2 not on it.
```

**A diagnostic that cannot be marked gets a lane of its own**, named as such,
rather than being dropped or silently folded in with the rest. An empty lane is
not drawn: a view with nothing off-canvas should not imply there might be.

**"Not on the diagram" includes a subject this view does not draw.** It is
real, this view cannot show it, and calling it marked would promise a mark
that never appears. The reviewer is told the count, not sold a picture.

**A mark outlives the selection.** The faulted class is applied by its own
effect rather than with the selection highlight, so moving the selection cannot
clear it. A reviewer inspecting a refused element must not erase the evidence
by looking at it.

## Consequences

**`VisualDiagnostic` gains an optional `subjects`.** Additive: nothing is
required that was not, and a diagnostic without one is a diagnostic about
nothing drawn, which is a meaningful answer rather than missing data.

**A view that filters can now be honest about what it hides.** Before, a
diagnostic about a filtered-out subject was indistinguishable from one about
nothing. It is now counted in the lane that says so.

**This does not reconcile a diagnostic to a document lane.** The off-canvas
lane names the file and line, which is where the reviewer goes. Routing to a
document tree is a thing to build when there is a document tree.

## Rejected

**Marking only anchored diagnostics and leaving the rest to the console.** The
failure mode this ADR exists to prevent: validation reports a failure and
nothing on screen changes, so the reviewer learns the report is unreliable.

**Inferring a subject in the browser by walking the pointer.** The browser
would have to reimplement the compiler's addressing and would drift from it.
The engine already knows, and says.

**Blocking a commit while any diagnostic is open.** A refused batch is already
refused by `apply`; the canvas showing the reason is a different job from
gating, and conflating them would make a stale on-screen count able to block a
write that would succeed.
