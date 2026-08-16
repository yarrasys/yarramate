# ArchiMate notation is a rendering mode, not a vocabulary

Status: accepted

A projection document declares `presentation.layout` and `presentation.direction`
to control automatic layout, and a reviewer can override them by hand through
a sidecar file ([ADR 0085](0085-a-dragged-position-is-presentation-the-repository-keeps.md)).
This ADR records that `presentation.notation: 'native' | 'archimate'` is a
third presentation field with the same scope and standing — no schema change,
no new vocabulary, pure rendering — and clarifies the licensing position on
the ArchiMate element glyphs and line conventions the notation mode expresses.

## Why not a profile extension or new kind vocabulary

The design's initial impulse was to add ArchiMate concepts and relationship
kinds to the `.yarramate/profiles/` and let the notation follow from the
profile's own structure: an `artifact` kind already carries `aspect:
'passive-structure'` from the inherited ArchiMate meta-model, so why not
make that aspect native to the graph, add ArchiMate kinds to the profile,
and let the rendering follow from declared vocabulary?

Two reasons against:

- **It would fork the graph into two vocabularies.** The native graph is
  17 core kinds plus 2 profile-extended kinds (`compiler-module`,
  `repository-file`), all with their own roles in automation, evidence
  evaluation, and reconciliation. Adding ArchiMate kinds (`application-component`
  vs. the native `applicationComponent`, etc.) would create a second,
  competing name for the same things — users would have to choose which one
  to use when authoring, the compiler would have to forbid both on the same
  concept to avoid duplication, and the whole semantic layer would become
  confused about which name a query should use.
- **It would close off other notations later.** A TOGAF notation or a
  Zachman-framework rendering would demand a whole new set of vocabulary
  again. Keeping the *vocabulary* native and *notation* presentation means
  a reviewer can flip between views of the same graph without changing
  the model, and a new notation is a stylesheet change, not a schema
  evolution.

## Rejected: ArchiMate as a profile dependency

A `yarramate-archimate@1.0` profile that specialized the core kinds to
their ArchiMate equivalents would embed the notation in the graph itself.
But that forces every workspace and projection to declare a profile choice:
`native` or `archimate`. There is no "both" — a projection picks one
vocabulary or the other at creation time, and switching an active session
to a different notation would mean re-authoring the whole workspace.

Keeping notation orthogonal to the vocabulary means the same concepts carry
whichever rendering the reviewer wants without requiring profile changes,
workspace re-authoring, or projection re-declaration.

## Decided

`presentation.notation: 'native' | 'archimate'` lives alongside `layout` and
`direction`, a presentation field [saved in a projection document](../VISUAL-ADAPTER.md#layout-is-presentation-the-repository-keeps)
via `view.save` and [persisted in the session sidecar](0085-a-dragged-position-is-presentation-the-repository-keeps.md)
like layout is.

### What changes with ArchiMate notation

**Node shapes by aspect** — the resolved `aspect` each concept kind declares
or inherits (`active-structure`, `behavior`, `passive-structure`, `motivation`,
`composite`) maps to a cytoscape shape: `rectangle`, `round-rectangle`,
`rectangle`+accent, `octagon`, `rectangle`+dashed. Unknown aspect falls back
to the native shape.

**Edge line notation by core kind** — each of the 11 core relationship kinds
(`composition`, `aggregation`, `assignment`, `realization`, `specialization`,
`serving`, `access`, `influence`, `triggering`, `flow`, `association`)
maps to a combination of `line-style` (solid/dotted/dashed) and arrow shape
(filled/hollow variants of `triangle`/`circle`/`diamond`/`vee`, or `none`).
A derived kind like `implements` (which inherits `realization`) resolves
through its lineage to the core kind, and the edge renders with the core
kind's notation. Unknown kind falls back to native notation.

**Direction pin under `layered`** — Under `archimate` notation, `buildLayoutConfig`
forces `elk.direction: 'DOWN'` for the `layered` backend regardless of the
stored `direction`, and the direction toggle is disabled with a reason shown
to the reviewer (`"ArchiMate notation fixes direction to Top-Down."`). This
is not a constraint on the projection — nothing is overwritten in state —
it is only applied at layout-config build time. Switching back to `native`
restores the projection's declared direction on the next layout, and a
reviewer can change direction under `native`, save the view, then flip back
to `archimate` and the new direction is still there, only pinned to `DOWN`
when rendering. This follows ADR 0023's principle: presentation is not a
semantic claim.

### Vocabulary is unchanged

No concept kind or relationship kind changes. The 19 distinct kinds in use
(17 core + 2 profile-extended) stay as they are. The 10 distinct relationship
kinds in use stay as they are. `presentation.notation` is a *pure rendering
choice* with zero effect on the semantic model, the graph compilation, the
projection semantics, or any operation through `apply`.

### Licensing position

The 19 element glyphs and 11 line notations are *descriptive notation* —
visual conventions that map the native graph to a readable diagram, the
same way a sequence-diagram rendering of interaction relationships is
descriptive notation, not a conformance profile.

- **Implementable.** The element shapes and line styles are standard SVG
  draw operations; no external library or toolkit is required.
- **No trademark claim.** The notation is never presented as "ArchiMate
  compliance" or "ArchiMate-certified export", and the word "ArchiMate" does
  not appear in command names, product branding, or external-facing
  documentation.
- **No conformance claim.** This is not an implementation of the ArchiMate
  specification, a conformance profile, or a tool certification — it is one
  notation among many the same graph can render under. The specification's
  own terms are respected: the glyphs and conventions are descriptive use of
  the element taxonomy, not a claim of structural conformance.
- **The ArchiMate mark is not used in naming.** The product remains "YarraMate",
  a native architecture tool; `yarramate-archimate` is not a binary, package,
  or configuration identifier.

This complements [ADR 0086](0086-radial-is-concentric-and-force-is-stress-then-spore.md)
— that ADR settled the layout backends and the role of seed in each; this one
settles what notation means — and supersedes nothing.
