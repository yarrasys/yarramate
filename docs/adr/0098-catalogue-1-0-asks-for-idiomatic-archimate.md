# Catalogue 1.0 asks for idiomatic ArchiMate

Status: accepted

[ADR 0097](0097-relationship-endpoints-are-validated-against-the-archimate-relationship-table.md)
made the ArchiMate 3.2 relationship table the rule for every relationship.
An interview whose resolutions steer an author toward shapes that rule
forbids is an interview that opens questions nothing can close. This ADR
records the catalogue changes that follow, and the one decision among them
that was a choice rather than a consequence.

## Why a major version

`docs/INTERROGATION.md` draws the line: minor versions add questions and
loosen triggers; a major version may change or remove triggers, because
that is the one change class that can silently alter what an existing
"complete" means. Seven questions change their triggers or their
resolutions here. `core-enrichment` goes from 0.9 to 1.0. A changed
question keeps its original `since`, because that field records the version
a question first appeared in ([ADR 0063](0063-a-reopened-interview-says-which-version-asked.md)),
and none is added.

## What changed because it had to

- `component-unhosted` and `node-serves-nothing` accepted and prescribed
  `assignment` from a node into a component. Technology realizes or serves
  a component; assignment runs from a node to the artifacts and behaviour it
  carries. Both triggers accept `realization`, the artifact joins the
  hosting counterparts, and the resolutions say where assignment goes.
- `behavior-unassigned` accepted a business actor or role as the performer
  of application behaviour, which the table forbids. The application
  interface replaces them, and the resolution says what an actor does
  instead: it is assigned to the business process that uses the behaviour.
- `hop-unrealised`'s closer set included assignment from a component to an
  interface, which the table forbids; a component composes its interface.
  The closers are now two: assignment to behaviour, or composition of an
  interface.
- `business-service-unrealized` accepted a capability as a realizer. A
  capability is realized by a service, not the other way round.
- `gap-unaddressed` accepted `realization` toward a gap. A gap is only ever
  associated.
- `principle-unapplied` and `artifact-unassigned` said "influence ... the
  decisions" and "assign the artifact to the node" in directions the table
  reads one way only. The resolutions now say which way.

## What changed because it was chosen

**The application service joins the interaction wave.** The wave was
designed around a "hop": a behaviour or interface subject assigned from a
component. A service is realized by a component, never assigned from one,
so the definition excluded it, and 955 lines of design never mentioned it.

Two consequences followed. A service serving a process or a component — the
most idiomatic way ArchiMate draws a consumed dependency — counted as no hop
at all, so a component whose only interaction was through a service was
never asked what the hop was. And no question ever asked a service what
data it touched, although `service -access-> dataObject` is canonical
ArchiMate and the consumer-facing data footprint is exactly what an
integration architect asks a service for.

Decided: the service is a counterpart in every hop question, so a service
serving a process is the hop it is; and the service is a subject of
`interaction-contract-unknown`. The objection was duplication: a service's
access usually repeats what its realizing process already declares. It does
not. A service may expose a subset of what its process touches, and the two
claims belong to different readers. The process's access is implementation;
the service's access is the promise. The cost was measured before deciding:
four edges on the shipped fixture, four on the repository's own model, all
of them true.

Realizing a service still does not close `hop-unrealised`. The service is
what the hop offers; the process or interface is the hop. The resolution
says so.

**`kind-untested` asks what ADR 0083 meant.** Its materiality said that
only four relationship kinds constrain an endpoint, so a subject none of
them touched carried a kind no check could contradict. Under the table every
kind constrains both endpoints, and that sentence is false. The condition
behind it, `unconstrained-kind`, is redefined to the claim the ADR actually
made: a subject's kind is untested when every relationship it has would
still be permitted with the subject reclassified to a kind of another
aspect. Same-aspect siblings are deliberately not compared — node and
device share most of a row, and a question that fires on that gap is the
hum ADR 0083 declined to ship. Composite kinds are not offered as
alternatives: a grouping, a location, or a junction carries a row broad
enough to stand in for almost anything, and none is a classification a
subject could honestly be moved to.

The resolution names the assignment each active kind makes, because
assignment from an active structure is the claim no behaviour, object, or
motivation element could make in its place.

## Consequences

- The repository's own model interrogates to zero open questions under 1.0.
  The contact-update fixture opens three, every one `authority: human`.
- The skill stops teaching workarounds. The four-rule table becomes the
  idioms the ArchiMate table recurs on; the invocation chain is reframed
  around what the interview needs rather than around a rejection; the
  degraded-edge pattern is retired with a note saying what to re-kind.
- A workspace that was "complete" under 0.9 may reopen. The `[since]`
  marker and the major version are the signal that the catalogue moved, not
  the model.
