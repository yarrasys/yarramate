# The model is the handover: one architecture, two AI harnesses, zero handoff

*A case study from the YarraMate project, 2026-08-01. Every claim below
has a commit hash, PR, or release attached; artifacts in the product
repository (private) are cited by number.*

## The setup

YarraDev.ai is a real product under active development. Its
architecture — 246 concepts, 419 relationships at last count — lives as
versioned YAML in the repository, maintained through YarraMate's
seven-verb CLI: `init → design → apply → ask → check → reconcile →
export`.

The core design bet is that the interview loop is **stateless**: the
engine recomputes every open design question from the model on every
invocation. No session files, no memory, no "where were we" — the model
*is* the state ([ADR 0053](adr/0053-open-questions-are-recomputed-never-stored.md),
[ADR 0058](adr/0058-the-interview-is-one-stateless-step.md)).

Which makes a claim that ought to be testable: **any agent, in any
harness, should be able to resume the design conversation cold.**

On 2026-08-01 we tested it adversarially. A Claude Code session had
spent the day working the loop (an ownership interview: one policy
sentence from the maintainer became 87 atomic model operations, merged
as the product repo's PR #3). Then the maintainer opened a **Codex**
session — a different vendor's agent, no shared context, no
instructions about YarraMate — in the same repository. The only
breadcrumbs: a ten-line `AGENTS.md` pointer and the published
`yarramate` CLI on PATH. The prompt deliberately never named the tool:

> "This repository's architecture is maintained as a model — the
> repo's own instructions say how to work with it. Orient yourself on
> the current state of the architecture work and continue it…"

## What happened

The Codex session:

1. **Found the loop unaided.** Read the pointer, ran
   `yarramate ask` for orientation (check verdict, drift summary,
   119 open questions, dependency-ordered backlog — one call), and
   entered the `design` loop. The commands' own output taught it the
   answer path: apply a validated batch, re-run, next question.
2. **Worked the interview hard.** It answered 63 open questions —
   modeling the platform's two-tier hosting (a Cloudflare runtime
   node, a customer runner host), stakeholders, drivers, an outcome —
   leaving 673 lines of enrichment as an uncommitted, reviewable
   diff. Nothing became declared intent without the maintainer's
   review: Git remains the acceptance step.
3. **Filed two real defect reports.** Not usability grumbles —
   a structured investigation with reproduction conditions and
   expected behavior:
   - *Retired requirements kept their design questions open.* A human
     had explicitly descoped two requirements (`status: retired`);
     the interview kept asking who would realize them, and the write
     surface offered no honest way out.
   - *A YAML edge case in `apply`.* Updating a flow-style concept
     record with multiple fields corrupted the document (caught by
     the atomic compile gate — the batch was rejected, nothing was
     written).

## The same-day close

Both reports were fixed and released within the session
([yarramate#124](https://github.com/yarrasys/yarramate/issues/124),
[ADR 0064](adr/0064-retired-is-a-closed-question.md), released as
[v0.8.1](https://github.com/yarrasys/yarramate/releases/tag/v0.8.1)):

- **Retired is a closed question.** The evaluator now excludes
  retired subjects from the interview entirely: retirement *is* the
  recorded descoping decision. The catalogue's guidance now
  prescribes it: retire to descope — the decision stays on record —
  delete only when the history itself is noise.
- **Flow-style records survive enrichment.** The splice writer —
  itself two days old, built after an earlier dogfood showed
  AST re-serialization mangling 350 lines of untouched prose
  ([ADR 0062](adr/0062-an-apply-diff-is-exactly-the-answer-it-landed.md))
  — now rewrites flow items as block mappings. Tracing the report
  also exposed a worse latent path (a field removal that could
  silently delete a whole record) before any user hit it.

The fixes shipped with regression tests replaying the Codex session's
exact scenario, and the reporting session could retire its descoped
requirements through the supported path the same day.

A later session in the same series closed the loop from the other
side: reviewing a release candidate, the foreign agent reported that
the model "was not merely documentation" — it had caught an
approval-path regression before the release shipped.

## Why this matters

Three claims usually made on faith, here with receipts:

**The handover cost is zero because there is nothing to hand over.**
The Claude session and the Codex session never exchanged a word. The
second agent resumed mid-interview because "where we are" is a derived
fact — recomputed from the model — not session state. The same
property means a session crash, a context-window compaction, or a
vendor switch costs nothing.

**Determinism is what makes a foreign agent trustworthy.** The engine
never asked Codex to exercise judgment about validity: every write
went through an atomic batch that either compiles as a whole workspace
or is rejected outright. The one place the write path failed, it
failed *loudly* — the gate refused the batch. And the model's own
drift machinery had, a day earlier, caught the *Claude* session
overclaiming (two `status: current` assertions with no supporting
evidence, flagged the moment they became checkable, retracted).
The tooling grades every agent, including the ones that built it.

**Dogfooding across harnesses finds what demos can't.** A foreign
agent has no loyalty to the tool's happy path. Codex hit the
retired-requirements gap because it did what a real user does —
descoped scope — and the flow-item bug because it wrote YAML the way
*it* writes YAML. Both defects survived 300+ tests and three days of
single-harness use.

## The numbers

| | |
|---|---|
| Model at resume | 230 concepts, 344 relationships, 6 documents |
| Handover artifacts | one 10-line AGENTS.md + published CLI |
| Questions answered by the foreign agent | 63 (119 → 56 open) |
| Enrichment left for review | 673 lines, uncommitted |
| Defects found → fixed → released | 2, same session (v0.8.1) |
| Human decisions consumed | 1 sentence ("Yarra Systems is the vendor and maintainer") |

*The full public trail:
[yarramate#124](https://github.com/yarrasys/yarramate/issues/124),
[ADR 0053](adr/0053-open-questions-are-recomputed-never-stored.md) /
[0058](adr/0058-the-interview-is-one-stateless-step.md) /
[0062](adr/0062-an-apply-diff-is-exactly-the-answer-it-landed.md) /
[0064](adr/0064-retired-is-a-closed-question.md), releases
[v0.8.0](https://github.com/yarrasys/yarramate/releases/tag/v0.8.0)–
[v0.8.1](https://github.com/yarrasys/yarramate/releases/tag/v0.8.1).
Product-repo artifacts (PRs #3–#4) are private.*
