# A rename is an identity edit, not a succession

Status: accepted

A local id is part of a subject's address (`document#local`). Until now
`yarramate/operations/v1` had nine branches and none of them could move one:
`update-concept` writes scalar and list fields, and `id` is in neither
`SCALAR_CONCEPT_FIELDS` nor `LIST_CONCEPT_FIELDS`. Changing an id meant editing
YAML by hand and then hunting every other file that named the old address —
across documents, projections, evidence overlays and adapter mappings.

The obvious workaround is not one. `delete-concept` plus `add-concept` is
refused while anything still references the subject (`YM912`), cannot be done
in one batch when the references are the very thing being moved, and — where
it does go through — records a retirement and an arrival where the model
should say one subject kept its identity and changed its address.

## Renaming is not succession

Decided: **a rename is an identity edit. It moves an address and writes no
`supersedes` entry, retires nothing, and duplicates nothing.**

Succession (ADR 0080) exists for split, merge, and responsibility-moved: both
ids persist, the predecessor is retired or kept, and `supersedes` records the
lineage because two real subjects are involved. A mistyped id before
publication has none of that structure. It is a Git-reviewed diff — the old
address simply stops existing, and if the change is wrong the reviewer reverts
the commit.

The two are therefore not variants of one operation. A rename that recorded
succession would put a lie in the model's history; a succession expressed as a
rename would lose the lineage the model exists to carry.

## Total within the workspace, or refused

A rename is only honest if it is total: every declarative reference moves with
the declaration in the same atomic batch, so nothing is left addressing an id
that stopped existing. Partial re-pointing is not a cheaper rename — it is a
dangling reference, which is worse than the hand-editing it replaced.

Totality is checked, not trusted, and it is checked twice from different
directions:

| Check | Fails when | Answers |
|---|---|---|
| `SUBJECT_REFERENCE_POSITIONS` completeness test | a schema grows an address-typed field that is neither enumerated nor excluded with a reason | is the enumeration still the whole set? |
| residue walk (`YM913`) | a file this batch touched still names an address a rename moved off | did the rewrite actually land everywhere? |

The completeness test derives the position set from the four on-disk schemas
(`yarramate-document`, `yarramate-projection`, `yarramate-evidence`,
`yarramate-adapter-mapping`) rather than restating it, because the failure mode
being guarded is a *new* reference field nobody remembered to enumerate. The
residue walk cannot see a position the enumeration omits, which is exactly why
it is not the only check.

`YM913` is a backstop rather than a routine refusal: with the enumeration
complete and the compile and evidence gates in front of it, no batch reachable
through the public surface should trip it. It is kept because the alternative to
a cheap re-read is trusting a text splice.

## One enumeration, one walker, byte-preserving splices

Reference positions are declared once, as data: a group (`document`,
`projection`, `evidence`, `adapter-mapping`), a path pattern where `*` matches
every sequence index, and a form (`declaration`, bare-or-qualified `reference`,
or always-`qualified`). One generic walker descends a parsed YAML document by
that pattern and yields the scalar nodes it reaches with their source ranges.
`rewriteSubjectReferences` splices back-to-front, so earlier offsets stay valid
and nothing outside a matched scalar is re-rendered: a bare reference stays
bare, a qualified one stays qualified, an `~aspect` suffix is preserved, and the
original quote character survives (ADR 0062 byte identity).

Comparison is always on the **qualified** address, never on the local id, so a
same-local subject in another document is left alone.

## Refusals, and what they cost

| Refusal | Code | Why not re-point by guess |
|---|---|---|
| id is not declared in the named document | `YM912` | there is nothing to move |
| `to` equals the current id | `YM912` | no address moves; every reference would otherwise be reported as residue |
| the document declares an architecture state with the old or new local id | `YM912` | states share the `document#local` spelling but not the id space — one address would name two things |
| the new local id is already declared | `YM301` (compile gate) | id uniqueness is Core's rule, and it runs before a byte is written |
| a reference position holds a YAML alias | `YM912` | the walker cannot re-point an alias node, and silently leaving it behind is the failure this operation exists to prevent |

The state/subject collision is refused rather than resolved, and the compile
gate is not enough on its own. A document that declares a state and a concept
with the same local id is already a `YM301` duplicate — states are in the
duplicate-id declaration list (`src/compiler.ts:1063`) — but `apply` compiles
the batch's result, not its input. Renaming the concept *out of* an
already-ambiguous document leaves a result that compiles clean, so the compile
gate would have accepted a guess about which of the two things
`owner: platform` meant. The refusal is what stops the guess; on the `to` side
it also names the collision instead of reporting a duplicate id.

The cost is stated rather than hidden: a rename parses every document,
projection, evidence overlay and adapter mapping in the workspace once, and the
compile gate already recompiles the whole workspace on every apply, so the added
cost is a fraction of what the batch already pays. This repository's
`.yarramate` is 40-odd files; a 40,000-document workspace would pay 40,000
parses per rename. That is the price of totality, and the alternative — a
partial re-point — is a lost reference, not a saving.

## Not in scope

Renaming a **document** id, a state id, a profile, or a kind: each has a
different address space and a different blast radius. Cross-document moves
(changing which document declares a subject) are a separate, larger change:
the declaration would leave one file and arrive in another, which is a merge of
two motions rather than one. Prose is left exactly as written — a description
that names the old id is a human's sentence, not an address.
