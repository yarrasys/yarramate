# An authority is a subject, a recorder is not

Status: accepted

Attestations exist to close an `adequacy` question: a concept stays
open until "an authority records a judgment in the model" (ADR 0056).
`by` named that authority as free text next to the judgment. Free
text meant anyone holding the pen could mint one. In a live session
an agent wrote nine sign-offs with `by: Nabeel Shaikh (architect)`, a
name it inferred rather than one anyone typed, and nothing in the
engine objected — the document compiled clean and the adequacy
questions closed. The repository's own self-model had already done
the same thing at scale: seven `adequacy` attestations on its own
goals and requirements read `by: claude-fable-5`, an agent naming
itself as the human authority it was recording on behalf of.

The asymmetry is what makes this a defect rather than a design choice
already made deliberately. `owner` has always been a subject
reference: an unresolved one is `YM304`, a hard compiler error,
because "who is accountable" is worthless if the model cannot check
it against anything. `by` recorded the same kind of claim — who is
accountable for a judgment — and carried none of that discipline. The
two fields disagreed about what "authority" means, for no reason the
schema stated anywhere.

Decided: `attestations[].by` is a subject reference, resolved against
the model exactly as `owner` is, and it reuses `YM304` when it does
not resolve — "unresolved attestation authority reference" alongside
the existing "unresolved owner reference," the same code because it
is the same rule applied to a second field. A reference cannot
contain a space or an uppercase letter, so `by: Nabeel Shaikh
(architect)` is no longer a value the schema accepts; the authority
has to already be a subject the model knows, on the same
document-local-or-qualified terms as every other reference field.

A judgment and its transcription are not the same act, though, and
stopping there would just move the forgery one field over — an agent
could still write a real person's subject id on a judgment that
person never made. `recordedBy` names whoever is holding the pen when
that is not the authority itself. In an operations batch it is
required: a batch is by construction a machine's write, so the agent
applying it must name itself. In a hand-written document it stays
optional, because a sign-off typed directly into a document already
has a git committer recording who wrote it. The attestation claim's
value packs `by`, `on`, and the optional `recordedBy` into one string,
exactly as ADR 0075 packed provider, key, and expected value into
one — graph v2 gains no field. Constraining `by` to a reference is
what makes this safe to parse unambiguously: the first token can no
longer contain a space to swallow the date or the recorder that
follows it.

**Provenance, not signatures.** The alternative was some form of
cryptographic sign-off: a value only the named authority could have
produced. That defends against a stolen identity, not an invented
one, and it would mean carrying key material, a verification step,
and an out-of-band distribution problem into a text format whose
entire design is that a reviewer reading a diff can check everything
in it. What the model actually needed was the same thing every other
reference field already has — the authority must be a subject someone
else can look up — plus what git already provides for free: the
commit that adds the claim names its author, and review at the git
boundary is the existing revocation and audit path for every
attestation (ADR 0056). Provenance costs nothing new; signatures
would have bought a guarantee the incident did not need.

**Recorder disagreement is a finding, not an error.** `by` naming an
unresolvable subject is broken beyond repair by the record itself, so
it is `check`'s to reject. `recordedBy` naming someone other than the
authority is not broken — an agent legitimately transcribes a
judgment given verbally, in a review comment, or in another document
— it is a fact a reviewer should see, not a contradiction to gate on.
`reconcile` reports it as `unconfirmed-attestation`, provider
`model`, whenever the recorder does not name the attesting authority
itself (by qualified id or its document-local form), with a matching
`summary.unconfirmedAttestations` counter. This is the same shape as
`stale-attestation` (ADR 0074): derived from the model with no
provider having observed anything, advisory, and deliberately outside
`check --strict`, which still fails only when a provider looks at
reality and disagrees with the model. Gating CI on a recorder
mismatch would fail builds over an ordinary and often correct
pattern — an agent recording someone else's sign-off — and would
teach people to write a self-attestation to stay green, which is the
exact failure this decision closes off elsewhere.

**The migration is what the contract now forces everyone else to
do.** The seven `by: claude-fable-5` attestations in
`.yarramate/architecture/product.yaml` could not be requalified
silently: an agent name is not a subject, and the only honest
repairs were to delete them or to have a real authority answer them.
A maintainer answered them. They now read
`by: yarramate-maintainers` — the `businessActor` already in the
self-model — with `recordedBy: claude-fable-5` and today's date,
because the judgment was given in a session and transcribed by the
agent that held the pen. `reconcile` accordingly reports seven
`unconfirmed-attestation` findings against the repository's own
model, and that is the intended reading: the questions are closed,
by someone accountable, and the report still says out loud that a
machine wrote the record. The version that looked better — seven
adequacy questions closed by an agent naming itself the authority,
zero findings — was the forgery reported as compliance.
