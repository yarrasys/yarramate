# A failed recompile keeps the last good model and names what broke

Status: accepted

A visual session that could not recompile the workspace told the browser
nothing. Every view emptied, the rail kept the views it was drawn with, and
the page read as a working session over an architecture that had gone blank
rather than a session that had failed.

That is what made #343 take ten minutes to diagnose instead of ten seconds.
The compiler had a `YM419` naming the pattern the manifest declared and no
caller passed, and the browser was the one surface that could not see it.
Every other consumer of a failed compile already gets the diagnostic: `check`
prints it, `apply` refuses on it, the request builder returns it. The session
server alone dropped it.

Reading the path turned up three silent failures and a wrong default.

- **An unreadable source was served as an empty workspace.**
  `workspaceSources` caught any read error and returned `[]`, and compiling
  an empty list **succeeds**. `compileWorkspaceResolved` over no sources
  returns an empty graph, not a failure. So the recompile reported success,
  the session broadcast a model whose every view read `subjectCount: 0`, and
  nothing froze. The code asserted that a workspace it could not read was a
  workspace with nothing in it.
- **A startup failure was discarded**: the boolean was not read.
- **A refused apply whose refresh also failed emitted nothing at all**: no
  model, no diagnostic, no freeze.
- **The one handled path could not name the fault.** `YMVS310` said
  "Workspace failed to recompile after a landed changeset" and was built by
  `serverDiagnostic`, which hardcodes `path: "visual-session-server"` and
  `line: 1`. The compiler's diagnostics were thrown away one function
  earlier.

Underneath all four, `filterMatchedIds` answered `[]` whenever the compile
was gone, defended in comment as degrading "rather than failing the session".

## Decision

**A failed recompile keeps the last good model and says what broke, naming
the compiler's own diagnostics.**

- **The last good compile is retained rather than cleared.** An empty canvas
  is not a neutral failure state. It looks like an answer, "your model is
  empty", rather than like a failure, and it is the flattering reading of
  the two. Keeping the previous graph leaves the reviewer something true to
  look at while telling them it is stale. This also makes the browser's own
  `Faults` heading true; it has always read *"the diagram still shows the
  model that did"*, and the server was the reason it was not.
- **The compiler's diagnostics are what the browser is shown**, via the
  existing `published()` bridge. `Diagnostic` and `VisualDiagnostic` are
  structurally identical, so nothing is resynthesised. A banner that says
  "recompile failed" without a code and a path is the ten-minute diagnosis
  again, which is the whole reason this decision exists.
- **Only a failure we caused is fatal.** A post-commit failure stays
  terminal: a changeset the runtime landed that leaves the workspace
  uncompilable is a runtime bug, and `LIMIT_FREEZE` already treats it as one.
  The other three do not freeze. A source going uncompilable because the
  reviewer edited a file, or switched branches, is an ordinary mid-edit
  state; ending their session for it would punish them for the tool's blind
  spot and would throw away staged work in the changeset tray.
- **A failure with nobody to tell is held, not dropped.** The startup
  recompile runs before any socket exists, so its diagnostics are kept and
  delivered to the first browser that connects. A recompile that later
  succeeds clears them, so a fault that has been fixed is not handed to a
  browser arriving afterwards.
- **`YMVS319` for a failure that is not a landed changeset's fault**, beside
  the existing `YMVS310` for one that is. The distinction is the freeze: one
  ends the session, the other does not.
- **An empty source list is never compiled.** `workspaceSources` returns a
  discriminated result and an unreadable source is a failure naming its path.
  The old contract stays correct for the two callers that only decorate an
  existing refusal with subjects, which is what it was written for; it was
  wrong only for the compile that produces what the browser draws.

**The faults panel MOVES over the canvas rather than being added there.** It
lived in the conversation column, which a reviewer studying a diagram has no
reason to glance at to learn that what they are looking at is stale, and the
sentence it renders is about the diagram rather than about the conversation.
Rendering it in both places was tried first and is worse: the same block
appears twice on one screen, which reads as two faults.

The rule it lands in was already written, `.diagram-workspace > .faults`,
with the comment *"the renderer's own fault is laid over the drawing it
could not replace rather than clipped out of the page"*, and had nothing
rendering into it. This moves the server's frame refusals (`YMVS30x`) with
it, which is the same improvement for the same reason.

`local-host.ts` takes the same treatment. It was worse: a batch that landed
and left the workspace uncompilable reported `ok: true` and then silence. It
reports a diagnostic rather than a refusal, because the commit did land, and
refusing it would report the opposite of what happened. It has no freeze
machinery, so nothing there is terminal.

No new frame kind and no protocol bump: the `diagnostic` response already
reaches `Faults`, and a `model` frame already clears it, so recovery clears
the banner without anything clearing it explicitly. That matters because the
mount surface is a published contract others embed.

## Excluded options

- **A new frame kind for a compile failure.** The wire is a published
  contract and the browser's frame switch is exhaustive, so a new kind is a
  protocol change every embedder must absorb, to carry a payload the
  existing `diagnostic` response already carries to the surface that already
  renders it.
- **Refusing to start a session whose workspace does not compile.** Honest,
  and it removes the one case where a reviewer most wants to see the model:
  the manifest is resolved once at startup, so this fires on a workspace that
  was fine a moment ago. It also cannot help the mount path, which has no
  "refuse to start".
- **Freezing on every failed recompile.** One behaviour, simplest to reason
  about, and it kills a live session holding staged work because someone
  saved a file mid-edit. It also makes the banner nearly pointless, since the
  session dies immediately after showing it.
- **Never freezing.** Drops the property the terminal freeze exists for:
  after a commit the runtime wrote produced an uncompilable workspace,
  continuing to serve the pre-commit graph means the browser shows a model
  that no longer matches disk with no hard stop.
- **Clearing the compile and answering filters with `[]`.** The status quo.
  `local-host.ts` had already overturned it for its own filter path with
  `YMVS318`, *"the last good model stays as it is"*, and recorded the
  reasoning: an empty match set is a claim about the subjects, when the truth
  is that the question could not be asked.

## Consequences

`VisualFreezeReason` is unchanged. The condition vocabulary gains `YMVS319`.
No published format changes shape, so no consumer gains a required field and
nothing breaks at typecheck, unlike the two required fields 1.4.0 added.

A session over a workspace that stops compiling now behaves visibly
differently: it keeps drawing, says why, and recovers. Previously it emptied
and said nothing.
