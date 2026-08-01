# The review overlay is derived too

Status: accepted

The third cross-harness report closed its session with the strongest
product validation to date — the model caught an approval-path
regression before release — and one remaining request: after a large
architecture batch, reviewers need to *see* what is new, what changed,
and what is merely context, and LikeC4 output had no way to say so.
The report itself ruled out persistent authored tags ("would pollute
the canonical model and require later cleanup") and asked for a
derived git-range overlay.

Granted, as the visual half of ADR 0065:

- `yarramate export likec4 <project> <out> <ws> --changed <git-range>`
  (the core verb forwards to `yarramate-likec4 export-project
  --changed`).
- The derivation now classifies: a subject wholly inside pure-insertion
  hunks is **new**; otherwise touched means **changed**. The
  classification rides `ask --changed` too (the `added` roster in the
  envelope).
- Every element and relationship in the generated model carries
  `metadata { yarramateGitChange 'new' | 'changed' }` — filterable in
  LikeC4 tooling, absent entirely when untouched.
- Every ordinary view styles its own changed members (green = new,
  amber = changed); dynamic and deployment views are left unstyled.
- A synthetic **`review-changes`** view collects every changed subject
  with the highlight, and its description is the legend — the one
  place a reviewer opens first.

No new LikeC4 constructs were invented: the overlay reuses the proven
metadata blocks and style-by-name rules of the state-comparison path,
so `likec4 validate` needed no new allowances. And nothing is
authored: an overlay for a merged range simply renders empty on the
next export, which is the disposal story the proposal wanted from
tags, delivered by construction.
