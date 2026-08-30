# A wave opens when its subject matter exists

Status: accepted

From #405. #404 corrected the documentation to say what was true; this makes
the original claim true. `core-enrichment` 1.3 → **2.0**.

## The defect

Six of seven waves gated on the same `has-any-subject`, so all six opened the
instant the first concept landed. Four stated a precondition in their own
description and enforced none of it.

## Decision

Two waves are re-gated. `has-subject-of-kind` (#398, 1.12.0) expresses both.

| Wave | Gate | Why it is safe |
|---|---|---|
| `application` | `applicationService` | elicited by `no-service-declared` in the ungated `business` wave |
| `technology` | `applicationComponent` | elicited in `interaction`, `business` and `application`, all earlier |

The two remaining waves named in #405 do **not** change, and both reasons were
found by measurement rather than argument.

## `implementation` has no honest gate

Three routes, all closed.

1. **Gating on what it elicits is trap 1.** `implementation-path-missing` asks
   the author to declare work packages. Gate on `workPackage` and the question
   fires only once the author has done the thing it asks for.
2. **Gating on a declared state is a third trap.**
   `.yarramate/architecture/evolution.yaml` declares `concepts: []` and four
   `states:`, and the compiled graph nonetheless carries `adapter-foundation`
   as a concept of kind `plateau`. **A state entry compiles to a plateau**, and
   `implementation-path-missing` triggers on
   `no-subject-of-kind: [workPackage, deliverable, plateau]`. So declaring a
   state *closes* the wave's headline question, and the gate would open the
   wave exactly when its lead question no longer needs asking.
3. **The positional remedy has nowhere to go.** No earlier wave in a
   layer-ordered catalogue would naturally ask "what work packages does this
   need?".

So the wave keeps `has-any-subject` and its description now says it is not
phase-gated, which is the honest form. `has-state-defined` is not built: it
was proposed only for this wave, and finding 2 disqualifies it.

## `interaction`'s "Hygiene waits" is already true

#405 assumed this sentence overpromised and should be reworded, because wave
completion cannot be a gate (ADR 0120). Measured, the sentence is not about
gates: `design` serves **"the first open question in wave order, then
catalogue order within the wave"**, and `hygiene` is the last wave. So hygiene
questions are served after interaction questions, which is what the sentence
says. Nothing to fix, and the prose fix #405 scoped is not part of this change.

## Why 2.0 and not 1.4

`docs/INTERROGATION.md` states the rule: minor versions are **additive**, new
questions and *loosened* triggers only; major versions "may change or remove
triggers — the only change class that can silently alter what an existing
'complete' means".

Tightening a gate is that class. It cannot turn a complete interview
incomplete, but it can make an incomplete one *look* complete: a model with
components, data objects and no application service currently gets asked "what
does this component contribute?" and after this change does not, until a
service exists. Fewer open questions for an unchanged model is exactly the
silent alteration the major signal exists for.

## The interaction with #272, which is the part to review

Two workspace-anchored layer-presence questions now sit behind a gate:
`no-event-declared` (`application`) and `no-artifact-declared`
(`technology`). Those questions exist because of #272 and ADR 0120, where a
discovery closed its interview with whole layers silently absent: every
subject-scoped question matched no subject, so nothing fired and nothing said
so.

This does not bring that failure back, and the distinction is **silence versus
sequence**:

- **then**: the question never fired, and the report showed nothing;
- **now**: the wave reports as unopened, and the question that opens it is
  itself open and waiting in an earlier ungated wave.

The event layer is still asked about, after the layer it belongs to has a
subject. `test/absent-layer-catalogue.test.ts` pins both halves rather than
dropping the old assertion: deferred while the wave is shut, reached as soon
as a service exists.

It is a real change to what #272 delivered, from "every absent front at once"
to "every absent front, in layer order", and it is the reason this is a major
catalogue version.

## Not in scope

A detector for identically-gated waves. The engine cannot know whether an
order was intended, identical gates can be deliberate grouping, and a refusal
would be wrong (#404).
