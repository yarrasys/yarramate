# Changelog

## 1.10.0

- **Added.** A question the model never asked says so (#375, ADR 0132).
  A subject-scoped question whose selector matches no subject now reports
  `asked: false` beside `open: false`, and renders as `unasked`, never as
  `closed` — previously never-asked and answered were byte-identical, and
  a host summing closed questions read an empty model as a satisfied
  interview (field evidence: a fresh ApertureX project ticked three waves
  complete with nothing authored). `asked` is absent everywhere else and
  absent means true, the same additive discipline as `catalogues`: no
  constructor breaks, existing readers keep their meaning. The
  interrogation semantics version does not bump — no question's answer
  changes for an unchanged model; a new distinction is reported where it
  exists.

## 1.9.0

- **Added.** The gitlab benchmark suite (#288, #372):
  `docs/research/context-benchmark/tasks/gitlab.yaml`, 8 tasks frozen at
  authoring, every ground-truth fact verified in a fresh clone at the
  gallery showcase's pinned commit. Authored under the recorded small-N
  pooling decision (kafka + gitlab published as N=2).

- **Changed.** The canvas strip's Add-subject button stands down when the
  kind palette is offered. The palette is the authoring entry (pick or drag
  a kind, the same dialog opens with the kind chosen); the button was its
  predecessor, and the two side by side were a duplicate. It remains as the
  fallback on a mount whose `sections` omit the palette, so a section-less
  embed keeps an authoring entry.
- **Changed.** The kind palette's layer bands are collapsible. Each band
  header is a real button with `aria-expanded`, every band starts open, and
  collapsed state is per mount — 62 kinds is a lot of scroll for a reviewer
  working in one band.

- **Added.** The connect banner takes a typed target (#309). While a
  connection's target is unchosen, the panel carries a labelled search
  field: type a name or id, pick a match, and the draft advances exactly as
  a canvas tap would — same reducer action, same kind list. This restores a
  keyboard and assistive-technology authoring path for the one mandatory
  interaction that was canvas-only, and it is also the fast path on a large
  diagram where finding the target box is pixel hunting. Every form field
  in the visual app now carries a `name` (Chrome's audit reports zero
  unnamed fields, from seven).

- **Added.** `MountOptions.catalogue` (and `LocalHostOptions.catalogue`)
  accepts the composed catalogue SET the overlay beneath has taken since
  ADR 0129 (#369, filed from ApertureX adoption): one `{ path, source }` or
  an array, evaluated together under the composition rules with each
  question qualified by its own catalogue. This was the last single-width
  seam between a host's composed interview and the embedded pane — a pane
  evaluating fewer catalogues than the host's own question surfaces is a
  disagreement with no symptom. A single source stays source-compatible;
  `dismissed` needed nothing, since qualified ids already match across the
  set.

## 1.8.0

- **Added.** A catalogue can ask about pattern membership (#346, ADR 0131).
  The new `fills-pattern-slot` trigger condition holds where a subject is
  bound into a slot of a pattern instance, narrowed by optional
  `patternKinds` (the pattern's kind identity, never a document path) and
  `slots` (part names). It is a guard in the #334 sense: it says a question
  applies, and an ordinary condition beside it says what would answer it.
  Instance-level pattern questions need no condition at all — a pattern is
  a kind, and kind-scoped questions already see every instance.

  Membership survives the compile as CONTEXT, not graph content: a
  successful compilation now carries `patternMemberships` (one entry per
  bound slot: member, slot, instance, pattern kind), and the serialized
  graph is unchanged by a byte — expansion stays indistinguishable from a
  hand-authored graph (#268). `evaluateCatalogue` takes the memberships as
  a sixth optional parameter; every CLI verb, the design interview, and
  the embedded pane thread it. A direct consumer of the pure engine that
  passes none gets a condition that never holds — participation unknown,
  not absent, the same rule `unchallenged-evidence` applies to a missing
  overlay. A mistyped `patternKinds` entry is refused with the existing
  `YM914`.

- **Added.** Reconcile reports the artifacts no observation claims (#175,
  ADR 0130). A workspace manifest may declare an optional `coverage` list of
  glob patterns; `reconcile` resolves them against the root of the git
  repository the manifest lives in — tracked files plus untracked files git
  does not ignore — and reports every selected file no observation's
  `repo:<path>` locator claims (fragments stripped, a directory claiming
  everything beneath it). `summary.artifactsInScope` and
  `summary.unclaimedArtifacts` appear exactly when coverage was assessed, a
  positive count lists paths in a top-level `unclaimedArtifacts` array beside
  a `coverageScope` echo, and a report that never looked says why in `notes`
  instead of staying silent. Never a finding, never `check --strict`: the
  same line ADR 0049 drew for unobserved subjects. This closes the
  recurrence the issue measured three times — a day of shipped features and
  a model that acquired nothing, with every gate green, because nothing
  asked.

  The typed API gains `deriveArtifactCoverage` and the `ArtifactCoverage`
  input `reconcileEvidenceReports` now optionally takes, so a host that
  enumerates its own tree can assess coverage without a filesystem.

  Dogfooded in the same release: the self-model's first honest report said
  72 of 149 in-scope files were unclaimed, and the backlog was worked to
  zero (#366) — every file bound in by a repository-file concept, a
  realization to what its code serves, and a confirmed observation.



- **Added.** A workspace can carry its own questions (#345, ADR 0129). A
  `questions:` manifest category resolves like `patterns` and `evidence`, and
  is **additive** to the shipped catalogue, so a consultant can author a
  question mid-engagement with no product release. `--catalogue` and
  `MountOptions.catalogue` are unchanged: they replace the base.

  **A wave is declared exactly once across the resolved set**, and any
  catalogue may contribute questions to a wave it did not declare. That one
  rule settles wave identity and ordering, and removes the `opensWhen`
  precedence question ADR 0125 raised rather than answering it: there is only
  ever one declarer. A second declaration is refused with **YM915**.

  `waves` may now be **empty**. A catalogue that only contributes questions to
  waves another declared is the ordinary shape of a project catalogue, and
  `minItems: 1` forced it to declare a wave it did not want, which a second
  such catalogue would then collide with.

  **Question ids are now qualified as `catalogue#question`.** Authors keep
  writing local ids; the engine qualifies when it composes, and every CLI verb
  composes even when only the shipped catalogue is in play. Two catalogues may
  carry the same local id and remain two distinct questions.

  **No version in the identity.** `core-enrichment` went 1.0 to 1.3 in a single
  day renaming nothing, and a versioned identity would have stranded every
  stored dismissal in every adopter's database three times that day. Versioned
  identity is safe for things that are authored and unsafe for things that are
  stored. Versions live in the report instead: `catalogue` keeps naming the
  base with its existing value shape, and a new **optional** `catalogues` array
  lists every contributor.

- **Added.** `composeCatalogues` and `qualifiedQuestionId` are published, from
  both the barrel and `yarramate/interrogation`. **Compose even when there is
  only one catalogue**, which every CLI verb now does: qualification happens
  when catalogues compose, not when they evaluate, so composing unconditionally
  means question ids are qualified from the start and do not change the day a
  workspace first carries a question of its own.

- **Changed.** A consumer matching on question ids in an interrogation report,
  a design step, or a host-supplied dismissal migrates once: `outcome-missing`
  becomes `core-enrichment#outcome-missing`. A value change rather than a new
  required field, so nothing that constructs these documents breaks.

- **Fixed.** `check` now validates the question catalogues a workspace
  declares, composed, so a broken one is refused and the cross-catalogue rules
  are enforced where CI sees them.

- **Added.** `check` resolves the references in a projection query (ADR 0128,
  YM921). A query naming a state, subject, document, kind, owner or constraint
  the workspace does not have is refused, and the diagnostic suggests the near
  miss: `Projection query \`states\` names "target-stat" ... Did you mean
  "target-state"?`

  **Referential, not emptiness.** A query whose every name resolves and which
  selects nothing is NOT refused. An architecture state nobody has populated
  yet is empty, correctly, and asking about it is a real question. The
  mechanism is a dangling reference, so the check is for a dangling reference;
  the symptom was an empty file, and a detector shaped like the symptom would
  have refused honest queries too.

  Previously a mistyped selector produced a clean empty artifact and exit 0
  from every export kind, because `check` validated a projection against its
  schema and never against the model. `owners` and `constraints` are included:
  they look like free text and are refs to concepts, which the compiler proves
  by refusing an unresolved owner with YM304.

- **Added.** `yarramate/workbook/import`, a published subpath carrying the half
  that READS a workbook back: `readWorkbook`, `baselineSheets`, `mergeWorkbook`,
  `operationsFrom` and `operationsDocument`. 1.6.0 published the writer only, so
  a host without Node could generate a workbook and had no route back from an
  edited one. The feature was scoped as fully reversible and only half of that
  was reachable.

  **A separate subpath, not more exports on `yarramate/workbook`.** The package
  declares no `sideEffects` field, so a bundler must assume every module might
  have one and cannot shake an unused re-export away. Adding the reader to the
  writer entry would have grown every generate-only Worker by the whole import
  half. `test/export-purity.test.ts` now holds the two entries **disjoint** as
  well as pure, and asserts on the files the walk reaches rather than only on
  what it fails to find, so a purity check cannot pass by visiting nothing.

- **Changed.** The workbook's `00 Read Me` says what the file is: a projection
  is a query, so the workbook is the slice it names, and the sheet now reports
  the concept and relationship counts of **that slice**. It also states the two
  things that make a narrow workbook safe to work in: every fact about a
  subject that IS present is present, and a subject outside the slice has no
  row and cannot be changed by importing the file.

## 1.6.0

- **Added.** `yarramate import xlsx <workbook.xlsx> <workspace.yaml>` reads an
  edited workbook back into the model (#355, ADR 0127). **An unedited round
  trip changes nothing**, byte for byte, which is the bar "no information lost"
  has to clear.

  Edits land as `yarramate/operations/v1` through `apply`, so untouched YAML
  keeps its comments, key order and formatting, and the whole import passes the
  atomic compile gate. A workbook that would produce an uncompilable model is
  refused whole rather than half written.

  **A three-way merge, not an overwrite.** The workbook carries `~Baseline`, a
  copy of its own rows as exported, and that ancestor is what distinguishes
  *the author changed this* from *the repository moved underneath since the
  workbook was made*. An edit the workspace did not touch merges even after
  drift; only a field that moved on **both** sides is refused, naming both
  values. A workbook with no `~Baseline` is refused rather than guessed at.

  **A missing row is never a deletion.** It is reported. A row deleted by
  accident in a spreadsheet has no symptom, and a new row needs a `Document`
  saying which file it belongs to.

- **Added.** The workbook carries a `Document` column, so a row says which file
  its subject lives in. An `apply` operation targets a document path, so
  without it a workbook could say what a subject is and not where to write it
  back.

- **Added.** `yarramate export xlsx <projection.yaml> <workspace.yaml> --out
  <file>` writes the model as an Excel workbook an architect can work in
  (#355, ADR 0127), and `yarramate/workbook` publishes the writer for a host
  with no Node. **No new dependency**: an `.xlsx` is a zip of XML, and the
  writer that produces one is smaller than any library that would.

  It is a working document rather than a report. Column A is always the id,
  foreign keys sit inline, and each is followed by a `↳ … (auto)` column
  carrying the referenced subject's name, so a sheet can be understood without
  jumping between tabs. Kinds and statuses come from the compiled profile.

  **Version selection needs no flag.** The workbook takes a projection, so it
  inherits the `states` facet a projection query already has, along with
  kinds, layers, owners, statuses and exclusions.

  **Unrecognised claims land in an overflow sheet rather than being dropped**,
  so a predicate added to the compiler after this was written still survives.
  That is what losslessness rests on: a mapping that enumerates predicates
  loses the one it forgot, and the loss has no symptom.

  The workbook also carries `~Baseline`, a hidden copy of its own rows as
  exported. It is the ancestor a later import needs to tell an author's edit
  from a change the repository made underneath. Reading a workbook back is a
  separate change.

- **Added.** A test refuses a raw NUL byte in any source file, reading every
  byte of every tracked **and uncommitted** file under `src`, `test`, `schema`,
  `catalogues`, `docs` and `scripts`. This fault has bitten the repository
  three times and is invisible in every ordinary reading of a file. The two
  obvious detectors are each blind to a case the other catches: `git diff`
  renders an early NUL as `Bin … bytes` and a late one as ordinary text, and
  `git grep -lI` shares the same head sniff. Listing uncommitted files matters
  because `git ls-files` cannot see the file being written right now, which is
  the one most likely to have a NUL typed into it.

## 1.5.0

- **Fixed.** The cytoscape container declares `position: relative`, so
  cytoscape stops warning that it "can not use UI extensions properly"
  (#325). Harmless while this app draws its own React context menu positioned
  against the window, and a trap for whoever first reaches for a cytoscape UI
  extension and finds it mispositioned with the reason already printed and
  ignored on every session.

  **The blocked inline style in the same console is now identified**, which
  was the open half of that issue. It is cytoscape's own: it inserts a
  `<style>` element whose entire content is
  `.__________cytoscape_container { position: relative; }`, the session CSP
  refuses it, and the refusal is why the position stayed static and the
  warning fired. Confirmed rather than inferred: the hash the CSP names,
  `sha256-pgvDUBa4IjFA2yuSJ2cqcyxmNYJMborsd0ORcRv9vw8=`, is the SHA-256 of
  exactly that rule. It is deliberately **not** allowlisted. The rule it
  carries is the one now set directly, so permitting it would admit an inline
  style the application provably does not need.

- **Fixed.** A catalogue naming a kind its profile does not have is refused,
  rather than loading clean and asking a question that can never fire (#351).
  `loadQuestionCatalogue` validated the schema and the undeclared-wave check
  and nothing else, and it did not receive a profile at all, so a mistyped
  kind produced a question that read perfectly in the source and was dead on
  arrival. This is the first of the empty-set family found in three days
  where nothing visible was wrong anywhere: the others all produced a zero
  someone could look at, and this one produces a well-formed report with
  consistent counts and a question that is simply never asked.

  All three kind-bearing fields are checked, and two of them are easy to
  forget. A **trigger** kind that does not resolve never matches. A **subject
  selector** kind scopes the question to an empty set. A **wave gate** kind
  never holds, and since a closed wave carries no questions at all, one typo
  silently retires an entire wave and reads exactly like a wave legitimately
  waiting on the model.

  **The check is deliberately narrow, and the narrowness is the point.** A
  kind is refused only when its profile is loaded and the kind is absent from
  it, which is unambiguously a typo. A kind whose profile is not loaded at
  all is left alone: `core-enrichment` names four `yarramate/policy@0.1`
  constraint kinds, and that profile loads only when a document selects it,
  so those questions are dormant by design rather than broken. Reporting them
  would put four false positives on the catalogue this repository ships, and
  a check that cries wolf on its own catalogue gets turned off. Resolution is
  tested against the kind maps rather than a declared-kinds list, so a kind
  inherited through `extends` counts.

- **Fixed.** A visual session that cannot recompile the workspace says so,
  and keeps drawing the model that did compile (#349, ADR 0126). It used to
  say nothing at all: every view emptied while the rail kept its views, so
  the page read as a session over an architecture that had gone blank rather
  than one that had failed. That is what made the 1.4.1 patterns bug take ten
  minutes to diagnose instead of ten seconds - the compiler had a `YM419`
  naming the missing pattern, and the browser was the one surface that could
  not see it. Three paths were silent (a startup failure, a refused apply
  whose refresh also failed, and an unreadable source) and the fourth could
  not name the fault: `YMVS310` is built with a hardcoded path of
  `visual-session-server`, and the compiler's own diagnostics were discarded
  one function earlier. The browser now gets those diagnostics, with code and
  path and line, in the faults panel. That panel also moves out of the
  conversation column and over the canvas, into a rule that was written for
  it and had nothing rendering into it: a reviewer studying a diagram has no
  reason to look at the conversation to learn that what they are looking at
  is stale.

  **An unreadable source is no longer served as an empty workspace.**
  Compiling an empty source list *succeeds*, returning an empty graph rather
  than a failure, so swallowing a read error made a workspace the session
  could not read indistinguishable from one with nothing in it - reported as
  a healthy compile, with every view at zero subjects and nothing frozen.

  **Only a failure the runtime caused is fatal.** A post-commit failure still
  freezes the session; the others do not. A source going uncompilable because
  the reviewer edited a file or switched branches is an ordinary mid-edit
  state, not grounds to end a session holding staged work. The mounted editor
  gets the same treatment, where a batch that landed and left the workspace
  uncompilable previously reported `ok: true` and then silence.

- **Fixed.** The consumer docs published the wrong wire version. `docs/VISUAL-ADAPTER.md`
  and `docs/ROADMAP.md` both named `yarramate/visual-protocol/v4`; the
  constant and all three schemas have been at `v5`. A host embedding the
  editor and pinning what the doc said would pin a version the runtime does
  not speak.

## 1.4.1

- **Fixed.** A pattern document declared in a workspace manifest is
  actually loaded (#268). 1.4.0 added the `patterns` manifest category and
  the workspace loader resolved it — and **not one caller passed it to the
  compiler**. Ten source lists across the CLI, the visual session server,
  the browser host, the apply gate and the request builder each said
  `[...profiles, ...documents]`. So a workspace that declared a pattern
  compiled without it: every instance binding `parts` failed `YM419` for a
  pattern sitting in its own manifest, **every commit against such a
  workspace was refused** by the atomic gate, and a visual session
  recompiled to nothing and drew every view empty while the rail still
  showed the model. The feature was unreachable except by handing the
  compiler an explicit source list — which is exactly what every test did,
  which is why 1800 of them passed. `check`'s summary counts patterns
  rather than reporting them as profiles, and the contact-update fixture
  now declares its pattern and is compiled through its own manifest by a
  test.

- **Fixed.** `design`'s wave summary says which waves have not opened.
  It read `implementation 0 open` for a gated wave — the same empty-set
  flattery as the completion sentence directly below it, which 1.4.0
  fixed while leaving this line alone. It now reads `implementation not
  yet`. The sixth instance of the shape found in two days, and the second
  in this command. `progress.waves` in the JSON keeps its shape: a
  consumer wanting wave state reads an interrogation report, where
  `opened` is already required, and a third required field on a published
  format for a convenience summary is not worth the constructor break.

## 1.4.0

- **Fixed.** "No open questions" no longer reads as a finished interview
  when nothing was asked (#334). A catalogue whose waves are all gated shut
  reaches zero open questions without a single question having been put, and
  `design` then said *"Interview complete: no open questions. The model
  answers everything the catalogue asks"* — flatly false about a catalogue
  that asked nothing, in the sentence an agent reads to decide it is done.
  Both `design` and `ask` now check whether any opened wave carries a
  question before claiming completion, and say the interview has not started
  otherwise. This is the fourth instance of completion inferred from an
  empty set found in one day, across two codebases: a consuming product's
  wave rail, this repository's report renderer, that product's project
  dashboard, and this.

- **Fixed.** A wave that has not opened no longer reads as a finished one
  (#334). `ask` printed a bare `== Implementation ==` heading with nothing
  under it, which is visually identical to a wave whose questions are all
  closed — and the empty reading is the flattering one: "nothing
  outstanding here" rather than "nobody has been asked anything here". It
  now prints `not yet — this wave has not opened`. `docs/INTERROGATION.md`
  states the hazard for consumers, because the state is one this release
  created: a rail computing `done` as `answered === questions` ticks at
  zero, and both this renderer and a consuming product's wave rail had that
  fault on the day the gate shipped.

- **Fixed.** A blank project is no longer greeted with six questions about
  what it does not have (#334, ADR 0125). Measured against 1.3.0: a fresh
  `yarramate init` opened **nine** questions, six of them of the form "you
  have nothing of kind X" — including how the planned architecture becomes
  real, asked before anyone had named a subject. It now opens **three**, all
  motivation: why the system exists, who its stakeholders are, what
  constrains it.

  A wave may declare `opensWhen`, conditions that must all hold before it
  opens, written in the same vocabulary a question's trigger uses so a
  reviewer reads a gate the way they already read a trigger. The one new
  condition is `has-any-subject`. The gate belongs to the **wave** rather
  than to each question because "the implementation wave is premature" is
  one fact, not one per question in it — a per-question guard is only as
  good as an author's memory, and this fix exists because six questions
  shipped here unguarded while a consuming product cut two rather than
  guard them.

  A closed wave asks nothing: its questions are not evaluated at all, rather
  than evaluated and reported closed, so they reach neither the report nor
  the summary, and the wave reports `opened: false` — the third state a
  progress rail needs. `summary.questions` counts questions in opened waves
  only, so a blank model reports 3 of 11 rather than 3 of 51, forty-eight of
  which were never put.

  ADR 0120 survives intact: the gate is about the **model** having
  substance, never about a previous wave being answered, so a model that has
  started and declares no work keeps the question open and goes on saying
  nothing is changing. Wave order becomes load-bearing, which is what a wave
  was always claiming to be.

  Catalogue `core-enrichment` goes 1.2 to **1.3**, gating every wave after
  motivation. `INTERROGATION_SEMANTICS_VERSION` stays at **1**: the engine
  gained an optional field and a condition, and a catalogue using neither
  evaluates exactly as before. `yarramate/interrogation-report/v1` gains a
  **required** `opened` on a wave, so a consumer *constructing* one gains it
  at typecheck; reading is unaffected.

- **Added.** A mounted editor takes the host's questions, and what the host
  has already dealt with (#328). `LocalHostOptions` and `MountOptions` gain
  `catalogue` and `dismissed`. Until now a host could have the questions UI
  only by also running yarramate's `core-enrichment`, so a product with its
  own interview had to omit the section entirely and show its questions on a
  separate surface, away from the model they were about. The division this
  draws: **the engine is yarramate's and so is the UI; the questions belong
  to whoever adopted it.** A general modelling interview is right for this
  repository's own CLI and wrong for a product whose interview is about its
  own subject matter. A catalogue that does not load leaves the overlay
  absent rather than failing the mount, as before. `dismissed` covers what a
  supplied catalogue cannot: the editor evaluates the catalogue itself and
  cannot know a reviewer set a question aside with a reason recorded
  somewhere the editor cannot see, so without it the pane would go on asking
  a question the host had answered. Naming a `subject` dismisses the
  question for that subject alone; omitting it dismisses it wherever it
  appears. Dismissal decides what the pane draws and nothing else: the model
  is untouched and `ask --open` still reports the question, because the
  interview is not the editor's to settle. Neither field changes any
  published format, and a host that passes neither behaves exactly as
  before.

- **Added.** The connect palette narrows to a pattern's ports (#268 phase
  3, ADR 0124). Between two pattern instances an editor now offers only
  the relationship kinds *both* patterns port, rather than the ten of
  eleven the ArchiMate table permits between two groupings. That restores
  the guidance the table gives everywhere else, and it matches what phase
  2 actually expands: an offer wider than the intersection proposes edges
  that expand into nothing. Where either end has no ports there is no
  macro grain to speak of and the table's answer stands, and a narrowing
  that comes out empty falls back to the table rather than leaving the
  edge undrawable. A `CanvasNode` carries `portKinds`, the resolved
  profile context carries `patternPortKinds`, and
  `yarramate/visual-graph/v1` gains the field — a wire change. Reading a
  graph is unaffected, but **constructing** one is not: `portKinds` is
  required, so a consumer with `CanvasNode` object literals (test
  fixtures, most likely) breaks at typecheck until each gains the field.
  A named consumer reports three such files. A consumer validating
  against a pinned copy of that schema needs it upgraded alongside the
  package.

  **Folding needed no canvas mode.** Because a macro edge survives its
  expansion and stays an ordinary subject, a projection over the pattern
  kind with `relationships: between` already draws one box per instance
  with the macro edges between them. The fixture's `contact-update-apis`
  view is that fold, unchanged; what moved is that the servings it draws
  are now checked against the member wiring by the port rather than
  asserted in a description. A canvas *toggle* — collapsing clusters on
  whatever view is on screen — remains open as a convenience rather than
  a missing capability.

- **Fixed.** An expansion the relationship table forbids is refused
  (#268, ADR 0124). A port's landing pair was minted without being judged
  against the table, so a pattern could emit a relationship `check` would
  refuse if anyone had written it by hand — the one thing `check` exists
  to make impossible. Wiring never had this hole: its legality is settled
  when the pattern resolves, because the slot kinds fix both endpoint
  kinds. A port's cannot be, because the two ends belong to different
  patterns and neither knows the other's slots, so the pair is judged at
  expansion instead and a forbidden one is `YM404` against the macro
  edge. The macro edge itself is often perfectly legal while its landing
  pair is not — two groupings permit nearly everything — which is why
  nothing earlier caught it.

- **Added.** A port says where a macro edge lands (#268 phase 2, ADR
  0124). A pattern may declare `ports`, and a relationship authored
  between two pattern instances whose kind both patterns port is expanded
  to the canonical pair the ports name: out of the source instance's
  `out` slot, into the target instance's `in` slot. "System API serves
  Process API" is one authored line at the grain an architect thinks in;
  `sys-service serving prc-component` is what ArchiMate wants, and the
  compiler writes it. **The macro edge survives the expansion**, because
  it is an authored fact and it is what a collapsed view has to draw -
  the property every upward-abstraction attempt lost, where a view that
  collapsed to groupings drew no edges at all because the real ones ran
  between members. Expansion is idempotent as wiring is, so where the
  canonical pair is already authored nothing is minted: that is what
  turns the contact-update fixture's three prose assertions ("Met by
  salesforce-write-service serving contact-prc-api") into guarantees
  without changing a line of it, and divergence would now show up as a
  second edge rather than as a description nobody checks. Both ends must
  port the kind, so an unported kind between two instances stays an
  ordinary relationship. New diagnostic `YM421` for a macro edge whose
  landing slot is unbound. A pattern with no ports behaves exactly as it
  did after phase 1.

- **Added.** A pattern binds the parts it wires (#268 phase 1, ADR 0123).
  `yarramate/pattern/v1` is a new published format declaring the shape a
  concept kind promises: the slots an instance binds and the wiring the
  compiler mints between them. An architect authors an API once; canonical
  ArchiMate spells it as four elements and five relationships, and every
  earlier attempt to get the simple picture back derived it **upward**,
  which is lossy and has to guess. A pattern inverts it and expands
  **downward**, which is a compiler: same input, same output, no guessing.
  A concept gains an optional `parts` map and the workspace manifest a
  `patterns` category. Binding, not generation: a bound part keeps its own
  name, owner, evidence and every outside edge it already carries, and
  what the pattern removes is the wiring, which was ceremony. On the
  contact-update journey that is twelve hand-authored aggregations
  replaced by four `parts` blocks. Expansion is compile-time and lands in
  the graph; nothing is written back, so a pattern edited today re-wires
  every instance on the next compile. A minted claim is `declared` and
  sourced to the binding line that produced it, so `yarramate/graph/v2`
  does not move and the expanded graph stays indistinguishable from a
  hand-authored one, which is what lets the Archi and LikeC4 exports see
  pure ArchiMate without learning what a pattern is. Expansion is
  idempotent against authored wiring, so a model adopts a pattern without
  touching a line; the pattern then owns the pairs it wires, and a
  reversed or disagreeing relationship between such a pair is a compile
  error while edges to anything else stay free. A pattern whose wiring the
  relationship table forbids fails once, against the pattern, because the
  slot kinds fix both endpoint kinds. New diagnostics `YM315`, `YM416`,
  `YM417`, `YM418`, `YM419` and `YM420`; new guide `docs/PATTERNS.md`.
  Ports and macro edges (phase 2) and the canvas fold (phase 3) are
  unaffected and still to come.

## 1.3.0

- **Added.** A rule can name its exception (#267, ADR 0122).
  `yarramate/projection/v1` gains `query.exclude`, a list of subjects the
  query would otherwise select and the author has taken out. A facet view
  states a rule, and every interesting rule has an exception someone
  would rather state than abandon the rule for; until now the only ways
  out were to enumerate every subject by hand or to leave the unwanted
  one on the canvas. The exclusion is final: it is a concept facet and an
  endpoint veto, so `relationships: connected` cannot walk an excluded
  subject back in by the far end of a relationship, and relationships
  touching one are dropped with it. A relationship can be excluded by
  name too. It is also the first reason `explainProjection` reaches, so a
  subject taken out reads as taken out rather than as dropped by whatever
  rule would also have dropped it, and the query panel labels it "Taken
  out of this view". Naming a subject no facet selects is allowed and
  inert until the model grows into the rule. The LikeC4 export inherits
  all of this without change, since it evaluates the query rather than
  translating it.
- **Changed.** `Remove from view` and `Add to this view` are offered on a
  view that describes its subjects with facets (#267, ADR 0122), where
  the whole View group used to vanish. It was absent on half the authored
  views of the contact-update journey. On a faceted view, removing names
  the subject in `exclude` and adding lifts an exception the view already
  holds; adding a subject the facets never selected is still not offered,
  because that would need an `include` tier and writing it into
  `subjects` would quietly convert the rule into a list. The changeset
  tray reports what happened to the VIEW rather than to the list, so a
  name arriving in `exclude` reads as the subject leaving.
  `activeViewMembership` changes shape accordingly, from a list or `null`
  to a union naming which kind of view it describes; `null` now means
  only that no view is active.

- **Changed.** A view says which way it runs, and the canvas listens
  (#274, ADR 0121). `presentation.direction` has been in
  `yarramate/projection/v1` all along and the LikeC4 export has always
  honoured it; the canvas pinned `elk.direction: DOWN` and took no
  argument that could say otherwise, so the format declared something one
  of its two renderers silently discarded, and `docs/VISUAL-ADAPTER.md`
  said both things in two different sections. The pin's reasoning was
  right for a layer-band view and wrong for a deployment realization
  chain or a fan-out, so it keeps the default rather than being the only
  answer: `top-down` maps to `DOWN`, `left-right` to `RIGHT`, and a view
  that declares nothing still runs top-down. Direction is derived from
  the active view the same way `nesting` is, restored to the default on a
  view that omits it rather than carried across from the view before, and
  a direction edit re-arms the relayout so the canvas cannot keep the
  geometry of a direction the view no longer declares. There is still no
  direction control on screen: the view declares it, and a save carries a
  declared direction through untouched.
- **Changed.** Node placement is now `NETWORK_SIMPLEX` rather than ELK's
  `BRANDES_KOEPF` default, on every view (#274, ADR 0121). Adopted on a
  sweep of every authored view in the repository, the six contact-update
  journey views and the self-model's twenty-two, rather than on the
  single 8-subject view the proposal opened with. Holding direction
  `DOWN`: total edge length across the 28 views falls from 1.46M px to
  987k, summed layout width narrows 15%, and crossings move from 1888 to
  1821, fewer on ten views, more on three, unchanged on fifteen. The
  three that pay crossings are the three largest and each buys 12 to 40%
  less edge with them. Every view's drawing changes; no saved layout
  does, since a saved layout is applied over the result.

- **Added.** The interview asks about what is not there (#272, ADR 0120).
  Every question that fired before anchored on a declared subject, so a
  kind with zero subjects could not be asked about and a whole absent
  layer read exactly like a covered one: the GitLab FOSS run closed at 3
  open items with the strategy layer empty, 559 feature-flag definitions
  unasked, 62 domain events unmodelled and a live migration unrecorded.
  Catalogue `core-enrichment` goes 1.1 to 1.2 (additive, every question
  `since: "1.2"`) with five workspace-scoped presence questions:
  `no-capability-declared`, `no-event-declared`, `no-artifact-declared`,
  `implementation-path-missing`, and `no-contract-declared`, the last
  gated on `exists-linkage` so a model where nothing interacts is not
  asked what governs the exchange. An unanswered presence question is
  information rather than noise: an architecture genuinely at rest keeps
  `implementation-path-missing` open, and that is the model saying
  nothing is changing. Also `capability-uncited` (a capability is the
  layer with no code to point at, so its citation is the only thing an
  audit can grade it against), and `states-undefined` now carries an
  `askPlain` phrasing and points at the migration plan or target design
  a repository already holds in-tree. `subjects-near-duplicate` names
  succession as its third honest answer; a separate succession question
  was assessed and not built, with the reasoning in the ADR.
- **Added.** `unchallenged-evidence`, the one interrogation condition
  that reads the workspace's evidence overlay rather than the compiled
  graph (#272, ADR 0120). It holds where the overlay records
  observations and every one is a frictionless confirmation, meaning no
  contradicted, unknown or not-observed result and no recorded search,
  because 39 confirmations in a row are not evidence of agreement but
  evidence that nothing was put at risk. A recorded search closes it
  even on a `confirmed` result: a confirmation resting on the empty
  search ADR 0107 made auditable has tested a claim it might fail. An
  absent or empty overlay stays quiet. `ask` and `design` now load the
  workspace's declared evidence and pass it to `evaluateCatalogue`,
  whose new trailing parameter is optional, so a consumer of the pure
  engine that passes nothing gets exactly the report it got before. The
  visual hosts read no evidence today and so omit this one question from
  the canvas nudge overlay, recorded in the ADR as follow-up. The
  trigger union in the three published schemas gains a branch, so a
  consumer validating a 1.2 report against a pinned pre-1.2 schema copy
  will reject a trigger it has never seen.
- **Fixed.** Recorded probes survive the evidence loader (#272).
  `loadEvidence` rebuilds each observation field by field and the
  rebuild dropped `searched` and `measured`, so through the real load
  path `reconcile` counted every `not-observed` as an unsupported
  absence however carefully its author recorded the search that came
  back empty, and the searches ADR 0107 exists to make auditable reached
  nothing that reads them.

- **Added.** The mounted viewer accepts the host's per-subject marks
  (#314, ADR 0119). `mountEditor` gains
  `decorations: Record<subjectId, 'added' | 'removed' | 'changed'>`
  (concepts and relationships alike) and the returned handle gains
  `setDecorations(decorations)` on the #297 pointer bridge, so a live
  comparison replaces the map wholesale — never a merge, `{}` clears.
  Comparison SEMANTICS stay host-side by design: the viewer renders
  marks and never diffs, which is what lets a host with its own
  comparison model (ApertureX's published-snapshot diffs) delete its
  parallel renderer and use the one viewer for authoring, read-only
  viewing (#298) and decorated comparison. Rendering is the faults
  mechanism — `deco-*` classes, stylesheet rules — with added in the
  eucalyptus token, removed in the quiet ink-grey with a dash, changed
  in the ochre, and never the failure red, which faults own. Unknown
  ids are silently inert; decorating is reading, so `setDecorations`
  works under `readOnly` and before the first model frame. Precedence
  is declared once: a fault outranks a decoration outranks selection —
  and ordering the fault rule last makes the failure red real on
  faulted edges, whose line colour the base edge rule had silently won
  back (cytoscape resolves style by declaration order alone). The
  vocabulary is closed at three and the viewer draws no legend — the
  host owns what a mark means — both recorded as excluded options in
  the ADR, alongside a session-server equivalent as follow-up.

- **Fixed.** The rail's filter judges a subject the way the canvas
  quick filter does, and its counts say what survives (#317,
  completing the two asks #307 deferred out of #316). Parity: the
  tree's own matching restated the predicate with `id` missing, so
  id-shaped input — `cep` for `cep-salesforce` — emptied the tree
  while the canvas kept drawing; the predicate #316 extracted
  (`subjectMatchesQuickFilter`) now lives in a small pure module,
  `subject-filter.ts`, imported by the canvas and the tree model
  alike, because `view-tree-model.ts` keeps its no-React/no-cytoscape
  discipline and merely loading `graph-canvas.tsx` registers
  cytoscape-elk. The rail keeps its one extra: a folder or layer
  label that matches still shows everything it holds, which the
  canvas has no counterpart for. Counts: while the tree filter
  narrows, the active view's row counts the drawn subjects that
  survive the text (an honest zero included), the "All subjects" row
  counts the survivors across the model, and a landed view whose
  subjects live only in the server's semantic graph shows no number
  at all rather than a full count the narrowing has made wrong — the
  same honesty as a staged new row's missing count. Group rows
  already list only survivors, so their counts follow. With no filter
  text every count is exactly what it was.

- **Fixed.** A second staged subject survives beside the first when
  their names slug to the same id (#315). `proposeConceptId` built its
  taken set from the landed graph alone, so with the first draft still
  staged the second proposed the identical id and the editor's
  replace-by-target staging swallowed it: no row, no error, no toast.
  The same blind spot #313 closed for `proposeRelationshipId`, noted
  there as out of scope; this completes that fix for the concept path
  with the same shape. `proposeConceptId` and `draftConcept` now take
  the ids a pending changeset already claims (`stagedSubjectIds`
  collects them), the Add-subject form threads them through a required
  `reservedIds` prop the way the connection panel does, and the second
  subject stages as `…-2`, which lands and compiles cleanly.

- **Fixed.** Disconnected subjects pack into a readable grid, and the
  canvas grows zoom and fit controls (#308). Layout: with 54 subjects
  and no relationships — the natural order when transcribing a client
  register — every subject is its own ELK component, and the packing
  was driven by `aspectRatio: cy.width() / cy.height()`, a default
  cytoscape-elk injects into the option bag it forwards to ELK
  verbatim: the viewport's momentary shape, NaN on a headless
  instance, and small enough at mount to break one component per
  packing row — a single 172x6942 column auto-fitted to zoom ~0.10,
  every node an unreadable sliver. `buildLayoutConfig` now pins the
  bare `aspectRatio` key (the same spelling, so the injection is
  replaced at cytoscape-elk's own merge rather than raced as a second
  key) at 2.5, measured to land drawn ratios of 1.6–2.2 across
  9/20/54/120 disconnected subjects — nine make a 3x3 grid — while a
  connected graph's layout is untouched, since component packing never
  reaches a single-component graph. Direction stays DOWN; #274 is
  deliberately held. Controls: the canvas's only zoom affordance was
  wheel zoom at a tenth sensitivity, undiscoverable and near-immobile
  without a wheel, so it now carries a zoom in / zoom out / fit
  cluster bottom-right — the free corner. A press steps the viewport a
  quarter about its own centre, clamped against runaway presses and
  left standing as the reviewer's own framing; Fit is #307's
  `fitVisible` by hand — frame the visible set without moving a node —
  and records as automatic framing, so a later panel resize may
  re-frame it the way a layout's own fit is re-framed.

- **Fixed.** A filter that matches nothing no longer blanks the canvas
  silently, and the survivors of one that matches come into view
  (#307). Three mechanisms, one field report. Refit: a quick-filter
  keystroke changed visibility without re-framing, so a surviving node
  kept its register-scale coordinate and drew a few pixels tall,
  indistinguishable from an empty canvas; the canvas now fits the
  viewport to the visible set on every quick-filter change (a fit,
  never a re-layout: nodes keep their positions, dragged ones
  included). Honesty: an empty result now says so where the subjects
  would be, as a centred status pill naming the narrowing that caused
  it, with the way out beside it: Show all for a standing query whose
  match set draws no subject (a view-sourced one included, which the
  top-left pill deliberately stays silent about), Clear filter for
  quick-filter text that zeroed an otherwise drawn set. Fallback: the
  local host answered `filter.query` with `matchedIds: []` whenever
  the workspace did not compile, a claim that every subject failed the
  query; it now refuses with `YMVS318` and leaves the last good model
  standing, the same posture its own `recompile` takes.

- **Fixed.** A second relationship between the same pair stays visible
  (#306). Two defects, one report. Drafting: `proposeRelationshipId`
  built its `taken` set from the landed graph alone, so with the first
  draft still staged the second proposed the identical id and the
  editor's replace-by-target staging swallowed it — no row, no error,
  no toast. `proposeRelationshipId` and `draftRelationship` now take
  the ids a pending changeset already claims (`stagedSubjectIds`
  collects them), so the second parallel edge stages as `…-2`, which
  the schema — no uniqueness on the (from, kind, to) triple — lands and
  compiles cleanly. Rendering: taxi routing is deterministic from the
  endpoints alone, so parallel edges, once landed, drew exactly on top
  of each other and read as one line. Members of a parallel pair (in
  either direction) now carry a `parallel` class whose `bezier` curve
  style cytoscape separates automatically; single edges keep
  `round-taxi` untouched, and an edge consumed into nesting never
  counts toward a pair.

- **Added.** The host can point at the canvas (#297). The handle
  `mountEditor` and `mountEditorWith` return grows three methods beside
  `unmount` — `select(subjectId)`, `openDraft({ kind? })` and
  `startConnection(fromSubjectId)` — each the programmatic twin of a
  gesture the surface already has: a canvas tap (the same action and
  normalization, which also scopes Open questions to the subject), a
  palette pick (the kind seeds the same Add-subject dialog, #295), and
  the inspector's Connect (the relationship-with-one-endpoint-fixed
  affordance a question card's trigger describes, ADR 0110). Every
  method returns whether it acted: false, never a throw, for an id the
  model does not name, a model that has not arrived — the handle before
  the shell's first render or after disposal included — and, for the
  two that reach for the pen, a read-only mount (#298); selecting stays
  allowed in a viewer, because selecting is reading. Never a second
  write path: anything the opened affordances stage still lands through
  the changeset, and the `EditorHost` seam is untouched — selection is
  client state, so the bridge is an `onReady` prop on `App`, not a
  protocol input. The released `{ unmount }` shape is extended
  additively, so existing embedders stand unchanged.
  [ADR 0118](docs/adr/0118-the-host-can-point-at-the-canvas.md).

- **Added.** A mounted editor can refuse the pen (#298). `mountEditor`
  gains `readOnly?: boolean` (default `false`) and `mountEditorWith` a
  trailing `readOnly` parameter, so a host can render a frozen snapshot
  with the authoring surface's own visual language. Read-only keeps
  everything that reads — the canvas, selection, the quick filter, view
  navigation, live query narrowing, open questions, the properties
  facts (rendered as values where the editable forms stood), Export PNG
  and the session-local layout Discard — and every affordance that
  stages or commits is absent, not disabled: no Add subject, no
  palette or changes sections (stripped from whatever `sections` names;
  the read-only `mountEditor` default is `['properties', 'questions']`),
  no Connect/Delete, no Stage view change, no new/rename/duplicate/
  delete menu items, and a drag still moves a node but writes no
  layout. A UI posture only: the host's store refuses writes on its own
  authority, and the two defenses are independent. The session shell
  and the `EditorHost` seam are unchanged.
  [ADR 0117](docs/adr/0117-a-mounted-editor-can-refuse-the-pen.md).

- **Added.** A kind palette the canvas accepts by drag (#295). A `palette`
  section leads the right column, listing the profile's concept kinds —
  the same `vocabulary.conceptKinds` the Add-subject dialog compiles its
  Kind select from — grouped into layer bands by core lineage, each row
  carrying the glyph the canvas draws for that kind. Dragging a row onto
  the canvas (a custom `application/x-yarramate-kind` payload, so stray
  text drops stay inert) opens the existing Add-subject dialog with the
  kind preselected; clicking a row does the same without the drag. The
  palette holds no armed mode and the plain openers still start with no
  kind chosen; the drop position is converted to model coordinates and
  handed up but deliberately not carried into the staged result —
  placement belongs to the layout system. Hosts opt in or out through
  the `sections` vocabulary, like every other section.
  [ADR 0116](docs/adr/0116-a-kind-is-picked-up-not-remembered.md).

- **Added.** The right column can leave (#294). A hide control on a slim
  rim above the section stack collapses the entire column — sections,
  splitters and separator — and gives the canvas the full width; the
  canvas refits through the `ResizeObserver` it already reframes with. A
  thin reopen strip stands where the column stood, and it carries the
  attention a hidden column would have shown: the chat unread count
  (`attention.received` now counts arrivals while the column is hidden,
  not only while the chat section is shut) and a marker while the agent
  is waiting on a choice, both also spoken in the strip's accessible
  name. Reopening restores the previous width, sections and splitter
  heights intact — `hidden` lives in
  `VisualWorkspaceState.conversation` beside the width, moved by
  `conversation.toggled` beside `conversation.resized`, and a resize
  arriving while hidden is ignored. Host-supplied `sections` behaviour
  is unchanged; a keyboard shortcut is deferred.
  [ADR 0115](docs/adr/0115-the-right-column-can-leave.md).

- **Fixed.** A staged view is visible in the rail, marked (#299). The view
  tree now merges the pending changeset's view operations over the landed
  views: a staged new view — and the folder it declares, which is how "New
  folder…" becomes visible at all — renders at once with a quiet `staged`
  chip; a staged overwrite marks the existing row and shows what will land;
  a staged delete marks its row rather than hiding it. Nothing is stored:
  the tree derives from `pendingChangeset`, so discarding the operation is
  the revert and committing converts staged rows to ordinary ones. In the
  same flow, a save dialog opened with a folder preset ("New folder…", "New
  view in this folder…") disables plain Save — the overwrite carries the
  active view's own folder by design, so it was the one button that could
  silently drop the folder just named; Save As New, which adopts it, is the
  action left standing.
  [ADR 0114](docs/adr/0114-the-rail-shows-staged-intent-beside-landed-truth.md).

- **Changed.** A saved layout is visible, view-scoped, and discardable
  (#273). A per-view layout sidecar silently re-pinned every relayout — an
  experimental relayout moved 0 of 16 nodes with no hint why — and a stale
  sidecar could scatter a 20-subject view across coordinates saved for all
  37. Now a sidecar entry for a subject the active view does not draw is
  inert (`applySavedPositions` pins only drawn nodes), and whenever a saved
  layout is actually in force the canvas shows a standing "Saved layout in
  force" pill with a **Discard** affordance. Discard is session-local: the
  canvas stops honouring that view's sidecar and runs a fresh layout; the
  sidecar stays on disk (deleting it is a staged write), and the reviewer's
  next drag-save re-arms the pin with their own fresh layout. Pruning stale
  sidecar entries on view save is deferred.
  [ADR 0113](docs/adr/0113-a-saved-layout-is-visible-and-view-scoped.md).

- **Added.** `yarramate init` names the workspace after its directory
  (#275). The seed document and workspace manifest ids derive from the
  target directory's basename, slugified to the id grammar both schemas
  share (lowercased, non-alphanumeric runs collapsed to single hyphens,
  trimmed) and validated against it, with `main` kept as the fallback
  when the basename yields nothing usable (`.`, an all-symbol name, a
  digit-led slug). `init .` resolves the cwd first, so the first
  `reconcile` report says the project's own name instead of
  `workspace: main`. The seed file path and the AGENTS.md/CLAUDE.md
  pointer are unchanged.
  [ADR 0112](docs/adr/0112-init-names-the-workspace-after-its-directory.md).

- **Fixed.** `yarramate reconcile` accepts `--json` (#275). Bare
  reconcile already emits JSON, but the flag was rejected with the usage
  screen and exit 2 while `design`, `check`, and `ask` all accept it —
  the worst of both for a harness scripting "add `--json` to every
  verb". It is now accepted as a no-op with byte-identical output, and
  the usage string says so.

- **Added.** The canvas carries the interview's nudges (#292). Every visual
  host now evaluates the shipped question catalogue per successful recompile
  and ships the result beside the graph; the editor draws a quiet count chip
  on each subject with open questions, and an **Open questions** section
  that scopes to the selected subject — with the workspace-scoped questions
  (`outcome-missing` and kin, which name no subject) shown when nothing is
  selected. A fourth presentation toggle, "Open-question badges", sits
  beside lifecycle/evidence/ownership; zero draws nothing, and the chip
  never borrows the failure palette — an open question is the catalogue
  deepening honestly (ADR 0063), not a defect.
  [ADR 0111](docs/adr/0111-the-canvas-carries-the-interviews-nudges.md).

  The overlay rides the internal rendered-model wire contract, never
  `CanvasNode`, so the published canvas-graph schema and every direct
  consumer of `projectGraphForCanvas` are untouched, and a host that ships
  no overlay (an older or embedded `mountEditorWith` host) produces a
  canvas identical to before. Derived per landed commit and never stored;
  the overlay carries the catalogue `id@version` and the engine `semantics`
  stamp (ADR 0106).

- **Fixed.** The Add-subject popover clears the canvas toolbar, and its
  labels reach their controls (#296). The popover opened at the toolbar's own
  corner one stacking layer below it, so the filter bar painted over the Name
  field's label; it now opens below the toolbar's row and stacks above it.
  And the dialog's Name/Kind/Document labels carry explicit `for`/`id`
  associations, so `getByLabel`-style queries and screen readers resolve
  them; the other dialogs (save-view, prompt, confirm) already had theirs.

## 1.2.0

- **Added.** An open question carries its machine-readable answer shape
  (#289). Every interrogation-report question and design step now carries
  `trigger`, the catalogue conditions that opened it, verbatim — so a
  consumer builds its answering affordance (a prefilled form, an
  operations stub) from the report instead of re-deriving the shape from
  its own catalogue copy and drifting from engine semantics. The human
  `yarramate design` output prints a prefilled `yarramate/operations/v1`
  skeleton when the trigger maps unambiguously onto one operation
  (`no-subject-of-kind` → `add-concept`; `missing-relationship` →
  `add-relationship` with the direction-fixed endpoint prefilled).
  [ADR 0110](docs/adr/0110-an-open-question-carries-its-answer-shape.md).

  Compatibility: `trigger` is required and the report and design-step
  schemas use `additionalProperties: false`, so output from this version
  fails validation against pinned pre-change schemas. Consumers that
  upgrade the package and its published schemas together are unaffected.
  No semantics bump: no answer changes (ADR 0106's rule).

## 1.1.0

- **Added.** A succession can be partial. `supersedes` accepts
  `{ subject, inRespectOf }` beside the bare id, and the interview asks for the
  respect when a subject supersedes a predecessor that is still current
  (`unscoped-succession`, catalogue 1.1).
  [ADR 0109](docs/adr/0109-a-succession-can-be-partial.md).

  Every succession the field could express was total. A shipped model claimed
  Zoekt superseded the Elasticsearch indexer while the source it was built from
  says Zoekt "does not replace" it for any scope but code search. The prose
  carried the qualifier and the field could not, and `ask --compare` reads the
  field, so the declared target architecture became the deletion of a component
  nobody is deleting.

  A selector may now omit `kinds`, which selects every concept: succession can
  be declared on any subject, and enumerating the kinds that may carry it would
  be a list nobody can keep right. Additive; the bare succession form and every
  existing selector are unchanged.

- **Added.** A declared constraint can be checked. A subject may carry
  `forbids`, naming relationship shapes it rules out, and a violation is a
  `check` error (YM415).
  [ADR 0108](docs/adr/0108-a-constraint-nothing-tests-is-a-comment.md).

  ADR 0083 found that a kind nothing constrains is a label; the same held one
  level up. A shipped model declared "no component reads repository storage
  directly", recorded three edges doing exactly that, and passed
  `check --strict`. Its only wiring in the graph was two `association` edges.

  Deliberately narrow: forbid a relationship kind between named endpoints, with
  exceptions. That covers "everything goes through X" and needs no traversal,
  so it stays inside the no-derivation boundary. Additive, and a new field, so
  no existing model can violate a rule it never declared.

- **Added.** An absence can now be audited. A `not-observed` observation may
  record `searched`, the globs and greps that found nothing, and any
  observation may record `measured`, a figure with the method that produced it.
  `reconcile` counts the `not-observed` observations naming no search as
  `summary.unsupportedAbsences` and names each in `notes`.
  [ADR 0107](docs/adr/0107-a-recorded-search-makes-an-absence-auditable.md).

  Every evidence result except one is checkable by something. `not-observed`
  asserts a negative about a tree nobody read exhaustively, and its message was
  free prose nothing could test, which is how a shipped model asserted that a
  component had no client in a tree containing a class named after it. Its
  locator resolved; the locator and the assertion were about different things.

  **yarramate does not run the recorded probe.** It has never resolved an
  evidence locator, and gaining the ability to read a foreign tree and execute
  patterns from a committed file is a separate decision. Recording comes first,
  because the data has to exist before running it means anything.


- **Added.** An interrogation report says which engine answered, not only which
  catalogue asked. `semantics` carries the version of condition evaluation
  itself, exported as `INTERROGATION_SEMANTICS_VERSION`, and it changes only
  when an existing question's answer can change for an unchanged model. It is
  not the package version: every patch bumps that and almost none change what a
  condition means, and a signal that fires on noise gets discounted.
  [ADR 0106](docs/adr/0106-a-report-says-which-engine-answered.md) records the
  reasoning and what was deliberately left out.

  A consumer holding stored answers can now tell an engine change from a model
  change. Before this, it could attribute a flipped answer to the model, or to
  the catalogue via `since`, but not to the engine, which is what ADR 0097 did
  when it replaced four aspect rules with the ArchiMate 3.2 table and began
  answering `missing-relationship` differently for unchanged models.

  **Compatibility.** `semantics` is required, and the report schema and its
  copy inside `ask-result` are both `additionalProperties: false`, so **output
  from 1.1.0 fails validation against a pinned pre-1.1.0 schema**. The schemas
  ship with the package and move with it, so only a consumer pinning a schema
  copy independently of the runtime is affected. `design-step`, `reconcile`,
  `check`, `rtm` and `apply` are unchanged.

  The promise is enforced rather than remembered:
  `test/interrogation-semantics.test.ts` exercises every condition against a
  fixture and fingerprints the answers, so changing what a condition means
  fails the suite and names the version to bump.


- **Added.** The interrogation engine is public API. `evaluateCatalogue`,
  `loadQuestionCatalogue`, `renderQuestion` and `renderInterrogationReport`
  are exported from the package entry, with the catalogue and report types
  named alongside them (`QuestionCatalogue`, `CatalogueQuestion`,
  `CatalogueSelector`, `CatalogueCondition`, `CatalogueLoadResult`,
  `InterrogationReport`, `InterrogationSummary`, `ReportWave`,
  `ReportQuestion`, `OpenSubject`). The question-catalogue and
  interrogation-report schemas were already published, so the contract was
  legible to consumers who had no way to run the engine behind it.

- **Added.** `yarramate/interrogation`, a subpath carrying that engine on its
  own. The `.` barrel reaches `node:fs`, `node:path` and `node:child_process`
  through workspace loading, the filesystem source store and git-derived
  attestation staleness, so a consumer evaluating catalogues inside a Worker
  or a Durable Object could not take the engine from it without dragging Node
  in behind. The subpath is pinned free of Node builtins by the same purity
  test that guards `yarramate/adapter/visual-graph`, and reaches the compiler
  for types only. Prefer it wherever the runtime is not Node.

  No CLI porcelain joins either surface: a command runner takes a working
  directory and returns an exit code, which is not a contract this package
  offers. A test pins that too.

## 1.0.0

- **Added.** The mountable visual editor (#252):
  `yarramate/visual-app` exports `mountEditor`, `mountEditorWith`, and
  `createLocalHost`, with styles at `yarramate/visual-app/styles.css`. Its
  self-contained browser engine mounts over a caller-owned synchronous
  `SourceStore` and resolved workspace; the caller declares the right-column
  sections and normally omits `chat` when no agent exists. The supplied
  `yarramate-visual` socket/session path is unchanged.

- **Changed.** The right column is a stack of collapsible sections — element
  properties, changes, chat — split by handles a pointer or the arrow keys can
  drag, with chat pinned at the foot (#249). There is no open/closed mode for
  the column any more: a shut section header still says what is behind it (the
  selected subject, the staged count, whose turn it is) where a shut column
  said nothing, which is also why an unread count now appears only while
  **Chat** is shut.

- **Breaking.** The command strip carries identity and nothing else. Its
  controls went to the things they act on: the **quick filter** to the canvas
  it narrows, **Save view** to the form the rail and the menus already open,
  **End** to the chat section that owns the conversation. The **Details**
  disclosure is gone — it only ever revealed one sentence, and a sentence about
  what the session *is* now sits beside the name. **Conversation** is gone with
  the mode it toggled.

- **Changed.** `End` is **Return to agent**, which is what it always did — its
  own notice has always read "Returning control to the main agent". One button:
  the design draws `End session` beside it for a handback that leaves the
  session live, nothing can do that yet, and a button that claimed to would be
  lying about the lifecycle.

- **Changed.** **New view…** seeds from the query on screen instead of clearing
  it first. Saving a view is keeping what you are looking at, and the strip
  button that used to do that is gone; this reverses the call #245 made when
  the menu item was the only way to reach the form.

- **Changed.** A folder is something the author declares, not where the file
  sits (#261, ADR 0104). `presentation.folder` on a projection and `folder` on
  a concept, both labels nested with `/`, both optional, neither resolved
  against anything. View folders used to be derived from the directories their
  projections happened to occupy, which made the filesystem the author of the
  organisation: a workspace could not name a folder without moving files, could
  not name one at all if its manifest patterns reached no subdirectory, and
  "New folder" meant either refusing the ordinary case or editing the author's
  manifest (ADR 0043). A label answers all three, and it is the word
  `yarramate/likec4-project/v1` already uses for the same thing (ADR 0067).
  **Path derivation is gone**: a workspace that sorts projections into
  directories keeps loading, and its folders flatten until it declares them.

- **Added.** The Model tree groups by a declared folder. Layer stays the
  default — derived from the kind, always correct, so a model nobody has
  organised is grouped exactly as it was — and a declared folder **overrides**
  it rather than sitting beside it, because a subject in two groups is one the
  reviewer finds twice and edits once. A folder compiles to a
  `yarramate/organisation/folder` claim carrying a **value**, not a reference:
  a folder is an organising word, not a subject that can be related, owned or
  reported on.

- **Added.** **New folder…** in the rail and canvas menus. It names the folder
  and opens the save form with it filled in — a folder no document declares is
  not a folder, so naming one and putting the first view in it are one motion.

- **Fixed.** A committed query edit re-asked the query the browser was holding,
  which is that query as it was — the same defect the `view` source had, and
  the query tab's `editor` source needed the same answer.

- **Added.** A collapsible tabbed panel along the foot of the canvas column,
  with the view's query as its first tab (#248). The facets that used to sit in
  a dropdown *over* the diagram they were narrowing now sit under it, beside a
  live match count, the subjects the query drops with the facet that dropped
  each one, and the projection document the query resolves to — serialised by
  the same `yaml` the runtime writes it with, so what the reviewer reads is
  what a commit would put on disk. Collapsed at rest, and the tab strip still
  carries the match count, so a shut panel is not a silent one. **A query edit
  stages a `write-view`** rather than saving, so it lands in the same batch as
  every other change; the edit is filtered under a new `editor` source, which
  leaves the view's name standing in the tree while its query is being changed.
  The count is of SUBJECTS, not of the match set: `matchedIds` names concepts
  and relationships together, and counting it whole reports five for three
  components with two relationships between them.

- **Added.** `explainProjection`, beside `evaluateProjection`: every concept a
  query leaves out, and the facet that left it out. The concept filter is now
  one ordered list of named facet checks hoisted into a `conceptSelector` that
  both functions read, so the reason the editor shows and the set the canvas
  draws can never come from two readings of one query. A subject is reported
  against the FIRST facet that rejects it, in the order the query applies them:
  a list of every reason is a list nobody reads. `filter-result` frames carry
  the exclusions as `excluded`; the published `yarramate/projection-result/v1`
  is unchanged, because this is a question about a query rather than part of
  what a projection is.

- **Fixed.** A commit from the visual editor died on any workspace that
  declares a profile. `planOperations` gathered documents, projections,
  evidence and adapter mappings and left the PROFILES out, and
  `applyOperations` reads nothing it is not handed (ADR 0100) — so the compile
  inside it was shown an empty string where a profile should be, which parses
  to `null`, and the compiler asked that `null` for its `profile`. The browser
  reported `YMVS307 Cannot read properties of null` and nothing landed. Every
  fixture in `apply-operations.test.ts` declared `profiles: []`, which is
  exactly why a green suite never saw it; this repository's own workspace
  declares one, so the visual editor could not commit anything to it at all.

- **Added.** Creating a subject puts it in the view that created it (#255). A
  view that enumerates `subjects:` cannot match a subject that did not exist
  when the list was written, so creating one now stages two rows — the model's
  `add-concept` and the view's membership — and the tray tells them apart:
  `write-view · Payment flow · +fraud-screening`, badged `view`. **Remove from
  view** and **Add to this view** stage the same amendment from the subject and
  Model-tree menus, in the view group, above the model's and well away from
  **Delete from model…**. Neither appears for a view that describes its
  subjects with facets, because there is no list to edit.

- **Fixed.** A commit that landed a change to the active view's own query
  re-asked the query the browser was holding, which is that query as it was.
  The commit reported success, the projection on disk named the new subject,
  and the canvas did not change. The view's query is now re-read off the model
  frame that replaced it.

- **Fixed.** A commit that wrote both model documents and projections reported
  only the model's half: "Committed · 1 file" where two landed. Core names the
  documents it rewrote, and the projections went out in the same `writeAll`.

- **Added.** View CRUD from the rail's context menu (#246): **Rename**,
  **Duplicate**, **New view in this folder**, **Copy projection path**, and
  **Export PNG** on the canvas. Rename and duplicate stage a row like every
  other change, so both are visible before they land and undoable after.
  **A rename changes what a view is called and moves nothing**: a projection's
  id decides its filename *and* keys its layout sidecar
  (`.yarramate/visual-layout/<id>.yaml`), so a rename that carried the id along
  would silently orphan the positions the reviewer dragged. Duplicating keeps
  the source's folder and takes a free id; it does not inherit the layout,
  because that is keyed by id and a copy is a different view.
  A view saved *in this folder* names its folder by pointing at a view already
  in it, which is also what makes the folder one the manifest demonstrably
  reaches.

- **Breaking.** Saving a view is a staged change, not a write. `view.save` is
  gone, and a commit carries `viewOperations` beside its model operations
  (`yarramate/visual-protocol/v5`, ADR 0103). Saving used to compose a
  projection and `writeFileSync` it the moment the reviewer pressed Save:
  outside the changeset, so it could not be undone; outside ADR 0093's
  staleness pin, so it overwrote a projection someone else had edited without
  noticing; and outside the batch, so a view and the subjects it shows could
  not land together. All three are closed by one mechanism, and the
  confirm-before-overwrite dialog goes with them — a staged overwrite is a row
  the reviewer can read and discard before it lands, which is a better answer
  than a dialog. **Delete a view** from the rail's context menu, behind the
  same rule every model-destructive item sits behind.

- **Breaking.** A `PendingWrite` with a `null` source removes the document
  (ADR 0103). `SourceStore` could create and replace but not remove, so nothing
  in the engine could take a document away and a view rename — a write plus a
  removal — could not be expressed at all. A removal lands in the same
  all-or-none batch under the same compare-and-swap, and must name the revision
  it was staged against: `expected: null` on a removal asks to remove a
  document on condition it is not there, and is refused rather than treated as
  a success.

- **Added.** A commit lands the model and the views as **one** `store.writeAll`.
  `landOperations` splits into `planOperations`, which returns the writes a
  batch would make, and the visual runtime merges its projection writes into
  that batch — so a view and the subjects it shows arrive together or not at
  all, without making a presentation artifact into a semantic operation.
  `yarramate/operations/v1` is unchanged, and Core keeps its invariant that a
  projection is never an operation's own target.

- **Added.** A view saved where the manifest's patterns cover no projection is
  refused rather than written. This repository's own manifest uses
  `projections/*.yaml`, which reaches no subdirectory, so the first view saved
  into a folder would otherwise be a file the workspace silently never loads
  (ADR 0043 names the same trap for `new projection`).

- **Fix.** Pressing Commit on a changeset holding only a staged view did
  nothing, and said nothing about why: the button's guard asked whether the
  model's operation list was empty rather than whether the changeset was. Found
  by staging a view in a browser and pressing the button, not by any test.

- **Added.** Right-click menus on a subject, a relationship, the empty canvas
  and a row in the rail. Every one of them obeys one rule: **operations that
  edit the view are separated from operations that edit the model**, under
  named headings, with anything model-destructive last, behind a firm rule, in
  `--failure`. Removing a subject from a view rewrites one projection and
  leaves every other view alone; deleting it from the model takes every
  relationship naming it and changes every view that drew it, and rendered as
  neighbours in a flat list the second is one slip away from someone who meant
  the first. Deleting still goes through the confirmation the side panel
  already used, so the menu adds a way to ask and no way to skip being asked.
  What a menu offers is a pure function of the model (`contextMenuFor`)
  returning intents rather than callbacks, so what a right-click puts on screen
  is something a test can read.

- **Fix.** Re-typing a relationship offers only the kinds the endpoint pairing
  permits. The properties form offered the profile's whole relationship
  vocabulary, so turning `applicationComponent --serving--> businessActor`
  into a `composition` was one click away and the `YM404` only arrived at
  commit - while the connection tool two files over had always narrowed to
  `connectableKinds`. The same narrowing now covers the form and the new menu,
  and the kind an edge already carries is always offered, because a model
  authored outside this editor is not the editor's to silently rewrite.

- **Added.** `VisualKindOption` carries `coreLabel`, the core-profile kind an
  option descends from, resolved through the profile's declared lineage exactly
  as a canvas subject gets its own `coreKindLabel`. Without it a browser could
  read a palette but not judge it: the ArchiMate table is keyed on core kinds,
  so an extension kind had to be offered unchecked, and this repo's own
  `implements` was offered on every edge including the pairings where the
  `realization` it descends from is refused. It is now offered exactly where
  that ancestor is permitted.

- **Added.** The saved views and the whole model are a tree in a left rail,
  replacing the flat `<select>` that sat in the command strip. That control
  held every view at one level and could do nothing to a view but open it; a
  workspace with twenty projections was a twenty-item dropdown. The rail has
  two roots, the way Archi does: **Views**, foldered and collapsible, each row
  stating how many subjects its query matches, and **Model**, every subject the
  workspace declares grouped by layer with its layer swatch. A subject the
  active view leaves out is still listed, quietened and marked `not in view`,
  because the model is what there is to draw rather than what is drawn, and
  selecting one opens its properties whether or not the canvas holds it. A
  filter box narrows both roots at once and is separate from the quick filter,
  which goes on narrowing the canvas. **View folders are derived from
  projection paths, and the projection format gains nothing**: a workspace
  whose projections all sit in one directory shows no folders, and one that
  sorts them into `current/` and `target/` gets those two, which needs only a
  manifest pattern that reaches into subdirectories. `VisualViewSummary` now
  carries the `path` those folders come from and a `subjectCount`, and every
  `model` frame carries the view list again, recounted: a count is not a
  property of a projection document but of what its query matches here, so
  landing a changeset moves it.

- **Fix.** A view's subject count states its concepts, not its concepts and
  relationships together. A `SemanticGraph`'s subjects are both, so the number
  taken from a query's match set read five for a view over three application
  components with two relationships between them, and a reviewer counting
  boxes on the canvas found three. This was caught by looking at the rail in a
  browser, not by any test.

- **Breaking.** A subject id is the authored id, unique across the workspace,
  with no `<document-id>#` prefix and no local-versus-qualified distinction
  (ADR 0099, superseding ADR 0005). The prefix namespaced ids nobody had
  collided on - zero collisions across the nineteen workspaces reachable here,
  including all six gallery showcases - while binding identity to file layout,
  so moving a subject between documents was a rename to be chased through every
  projection, mapping, evidence pointer and brief. New `YM314` refuses a
  workspace where two documents declare one id, and that refusal is what makes
  the shorter form safe rather than a merge of two subjects; a repeat inside one
  document stays `YM301`. Migrate with
  `node scripts/flatten-subject-ids.mjs <workspace.yaml> [extra-file ...]`,
  which strips only a prefix naming a document of that workspace, leaves kind
  identities like `yarramate/core@0.1#goal` alone, and refuses to write anything
  at all if it finds a collision. Name any file that references subjects without
  being listed in the manifest, such as an adapter's project definition.

- **Fix.** A subject you create appears on the canvas that created it. A filter
  is resolved against the model the server held when it was asked, and a landed
  commit replaces that model. Nothing re-asked, so the matched set went on
  describing the graph as it was: the subject the reviewer had just made was
  not in it, and the canvas hides every element the matched set does not name.
  The commit reported `Committed - 1 file`, the bytes landed, and the diagram
  did not change. It needed no unusual view and no stale projection, only a
  filter resolved once, which is every view a session opens on; the one case it
  never reached was an unfiltered canvas. Confirmed against a view whose query
  genuinely matches the new subject, where navigating away and back revealed
  it: same view, same query, same model, only the re-asking differed.
  The browser now re-asks its standing filter off the `model` frame that
  invalidated it. That is a consequence of a frame arriving rather than of a
  render, so it lives beside the rest of the frame handling as a pure function
  (`filterToReresolve`) instead of in an effect: the same frame that
  invalidates a matched set is the thing that asks for a new one. Only a
  `model` frame qualifies, since a `filter-result` is the answer and re-asking
  off it would never stop. Whichever query is standing is the one re-asked,
  under the source that asked for it, so a reviewer holding their own filter
  does not have the view's query put back underneath them and a chat-issued
  narrowing does not start reporting itself as the reviewer's own (#251).
  The test that missed this asserted on `state.model.graph`, which was correct
  the whole time. What was wrong is what the canvas *draws*, which is that
  graph narrowed by the matched set, so the canvas is what the new tests
  assert on.

- **Breaking.** One notation. The canvas draws ArchiMate, and `native` is
  removed rather than demoted: `presentation.notation` admits `archimate`
  alone, and a projection asking for `native` is refused rather than quietly
  drawn as something else. The field stays an enum for the same reason
  `layout` did when `radial` and `force` went, so a second notation has
  somewhere to land (ADR 0087 is unchanged: notation is a rendering field with
  no effect on the semantic model). Every node now carries its kind glyph and
  takes its shape from its aspect, and every edge its line and arrows from its
  core relationship kind, because none of that is a mode any more.
  The notation picker and the direction toggle both leave the command strip.
  The direction toggle goes because it had nothing left to do: ArchiMate's
  layer bands only read top-down, so the canvas already pinned `elk.direction`
  to `DOWN` and the control was inert whenever ArchiMate was on.
  `presentation.direction` itself stays in the format, because the LikeC4
  export reads it for its own `autoLayout` and draws no bands. A save now
  carries a view's declared direction through untouched instead of writing the
  canvas's own, which is what stops removing the control from silently
  discarding a value the reviewer never saw; and a save writes no `notation` at
  all rather than stamping the only one onto every projection it touches
  (#250).

- **Breaking.** One layout backend: `presentation.layout` admits only
  `layered`, and `presentation.seed` is gone (ADR 0086 carries a supersession
  note). `radial` (cytoscape `concentric`) and `force` (elk `stress` then
  `sporeOverlap`) were measured against `layered` on every view of the
  contact-update journey and lost on all three counts that decide whether a
  diagram can be read: edge crossings, total edge length, and how large the
  graph draws once fitted to the canvas. `seed` goes because only `force` ever
  read it, yet the projection schema required a seed of every view declaring a
  layout at all, so declaring a layout no longer obliges a view to invent a
  value it has no use for. `force` was the only asynchronous backend, so its
  apparatus retires with it: the busy notice, the two-pass chain, the
  paint-first frame yield, and the in-flight guard that let a newer request
  supersede a running one, none of which a single synchronous pass can need.
  The Layout picker goes too, having nothing left to pick. `layout` stays an
  enum so a replacement mechanism has somewhere to land. First paint also now
  uses the layout the view settles into: mount laid out every element before
  the structural filter result landed, then hid the ones the view excludes,
  leaving the survivors spread across a layout built for a graph no longer on
  screen. Measured on the solution view, first paint spanned 1910x2958 with
  25,235px of edge at fit zoom 0.34, against 922x2584 and 21,335px at 0.39
  once any control was touched: more than twice as wide for the same twenty
  nodes. Relaying out when the matched set changes closes it (#219).

- **Breaking.** `applyOperations` is a pure function from sources to sources
  (ADR 0100). It takes an `ApplyInput` - the resolved workspace, every source
  that workspace resolves to, the operations document, and where the manifest
  sits - and returns the documents it changed rather than writing them. It
  reads no file and writes none. `landOperations(store, input)` is the
  composition both callers use: read the workspace through a `SourceStore`,
  apply, and write back only what still holds what was read. Both are exported,
  with `ApplyInput` and `ApplyOutcome`, so an engine embedded over D1 or an
  object store can be handed its own sources.
  This closes a gap ADR 0093 left open. The visual runtime pinned a digest per
  document and refused a batch whose pin no longer matched, but the check sat
  in the adapter and the write sat in Core with a whole workspace compile
  between them, so a write landing in that window was overwritten by a batch
  that had already proved it was current. The pin stays, unchanged, along with
  `YMVS312` and `YMVS313`; the store's comparison now runs immediately before
  the bytes land, so nothing can move in between. New `YM704` refuses a batch
  whose document changed or was removed after it was staged, and `YM705` one
  that expected to create a document already there. `apply` from a terminal,
  which had no precondition at all, now has this one (#231).

- **Breaking.** Relationship endpoints are validated against the ArchiMate
  3.2 relationship table (ADR 0097), vendored from Archi's `relationships.xml`
  (MIT) and regenerated into a zero-import module a test keeps honest. The
  four aspect rules from ADR 0004 accepted 64% of the kind-pair combinations
  the table rejects and refused 1,803 it permits, `triggering` between
  active-structure elements among them; a workspace carrying a forbidden
  edge now fails `check` with `YM404`, which names the pair and the kinds
  the table does permit. The repository's own model carried 13 such edges
  and the shipped fixtures 12, every one a folded field or a direction
  error. Migrate with `access` where behaviour produces passive structure,
  `artifact -realization-> dataObject` where a file gives a data object its
  form, `node -realization-> applicationComponent` for "deployed on", a
  swapped direction where a capability was realized by what it realizes,
  and `association` where nothing stronger carries the meaning. New `YM414`:
  every relationship on one junction must be the same kind. Product,
  plateau, and gap are composite, and only grouping draws dashed.
  `ask --kinds` reports the aspect shadow for all eleven kinds and the packed
  table as `relationshipMatrix`. `inspiredBy` values read `archimate:`.
  Catalogue `core-enrichment` goes to 1.0 (ADR 0098): seven questions that
  prescribed forbidden shapes are retargeted, the application service joins
  the interaction wave and is asked what data it accesses, and
  `kind-untested` asks whether a subject's relationships would survive
  reclassification to another aspect. The skill retires the degraded-edge
  pattern. Positioning: the core profile implements the ArchiMate vocabulary
  and relationship table; the custody layer is additive; not affiliated with
  or certified by The Open Group.
- **Breaking.** Visual session paths are published as canonical local `file:`
  URIs rather than bare path strings (ADR 0096). `sessionRoot`,
  `descriptorPath`, `journalPath`, and `transcriptPath` are encoded with
  `pathToFileURL` and decoded with `fileURLToPath`, refusing anything
  malformed, nonlocal, or noncanonical as `YMVS414` before a descriptor's
  bearer capabilities are read. This closes two defects the old
  backslash-to-slash transform could not: two distinct native paths could
  produce one indistinguishable wire string, and a UNC path passed as an
  ordinary local one. `yarramate/visual-protocol/v3` becomes `v4`;
  `visual-session-started`, `visual-session-descriptor`, and `visual-handoff`
  become `v2`; the eight documents that carry no path stay at `v1`. A v3
  document is refused, never translated. `yarramate-visual
  wait|respond|status|recover|stop` now take the exact `descriptorPath` URI
  `start` published, copied back verbatim: a native path is refused, and the
  argument is no longer resolved against the working directory (#208).

- A `SourceStore` names where a workspace's sources come from and where they go
  back to, exported as `createFileSystemStore` with `SourceStore`,
  `StoredSource`, `PendingWrite`, `WriteConflict` and `WriteOutcome`
  (ADR 0100). It is `list`, `read` and `writeAll`, and a revision is opaque
  outside the store that minted it: a content hash here, an ETag or a
  rowversion elsewhere, compared only for equality and only by its issuer.
  There is no unconditional write, because a caller with nothing to state is
  the caller that cannot detect a conflict; `expected: null` requires that the
  document not exist yet. `writeAll` checks every expectation before moving a
  byte, so a batch whose last document is stale does not leave its first one
  rewritten, and each file lands whole through a staged write and a rename.
  The batch as a whole is not atomic on a filesystem, which is stated rather
  than implied. Nothing in the engine uses it yet: this is the seam, ahead of
  the callers moving onto it (#230).

- A LikeC4 project generated before 1.0 is regenerated rather than refused.
  Its marker records a comparison's endpoints in the qualified
  `<document>#<local>` form, which `subjectIdentity` no longer admits in either
  marker version, so `export-project` and `export-project --check` rejected it
  as "not a YarraMate-generated project" - a message about the wrong thing,
  since the directory is one we wrote and the ids in it are recorded metadata
  rather than addresses anything resolves. Continuous integration never saw
  this, checking out clean with no prior output directory, so it fired only for
  people who already used the tool, on their first command after upgrading.
  Such a marker is now accepted where an existing project is read, exactly as a
  marker written before output digests existed is, and the next write upgrades
  it with nothing for the reader to do. `--check` reports the project stale and
  safe to regenerate, which is the truth it always had (#225).

- A view says what nesting means in it. `presentation.nesting` names the
  relationship kinds that draw as containment, in precedence order (ADR 0101),
  defaulting to `[composition]` - the behaviour that shipped, now stated rather
  than assumed - with `[]` drawing everything as a line. `assignment` may now
  nest, so a component's functions and processes draw inside it the way
  ArchiMate renders them, instead of scattering as lines the reader
  reconstructs edge by edge.
  Nesting was widened this way rather than outright because a nested box
  carries no label saying how it got there: with two kinds nesting, an inner
  box means either "is a part of" or "is behaviour performed by" and nothing on
  screen separates them. Declaring the vocabulary makes that a choice rather
  than an accident, and a view naming one kind has no ambiguity to resolve. A
  child claimed by two kinds nests under the earlier-listed one; two claims at
  the same precedence naming different parents stay undecidable and draw
  unnested with every claim still a line, as does a nesting cycle, which a
  mixed vocabulary can form where composition alone could not. Assignment never
  nests a service whatever the view says, because a service is the promise the
  layer above consumes and burying it inside its provider inverts what it is
  for; that declines to draw a containment rather than to accept the model,
  since the ArchiMate 3.2 table permits the relationship. Unlike the
  presentation toggles, a view that declares no nesting is restored to the
  default rather than inheriting the previous view's (#233).

- A canvas node carries `coreKindLabel`, the core-vocabulary kind it resolves
  to, the way an edge already carried its own. The ArchiMate relationship
  table is keyed on core kinds, so anything deciding what may connect two
  nodes needs the core ancestor rather than the profile kind the concept was
  authored as. `yarramate/visual-graph/v1` gains the field on `canvasNode`;
  nothing is removed or renamed.
  This is what a connection tool rests on, and the property it rests on is
  held here rather than in the tool, because it is about the table and the
  compiler agreeing and neither knows a tool exists: across a spread of kind
  pairs, every relationship kind `permittedRelationshipKinds` offers compiles
  without `YM404`, and every kind it withholds is one the compiler actually
  refuses. An editor offering exactly that set cannot draw an edge the
  compiler would reject, and cannot hide a legal one either. `association` is
  always among the offered kinds, so no pair is a dead end (#234).

- `YM302` says what became of a reference written the way ids read before 1.0.
  Flattening subject ids is the change most likely to produce an unresolved
  reference, and `<document>#<local>` is too far from `<local>` for an
  edit-distance suggestion to reach, so the one migration everybody performs
  got the one message that said nothing beyond the address it could not
  resolve. It now names the cause and the id that exists. A reference whose
  local part is also unknown gets no such hint, because a false one is worse
  than none. The diagnostic also suggests a near miss now, which it never did
  before: a plain typo was as silent as a migration (#235).

- Drafting a relationship between two subjects on a canvas, as pure functions:
  `connectableKinds`, `proposeRelationshipId` and `draftRelationship`. The
  first returns what the ArchiMate table permits between two rendered nodes,
  read through each one's core kind so a model using a profile gets a palette
  rather than nothing. The second proposes `<from>-<kind>-<to>`, which reads as
  the sentence the relationship makes and is already a valid id, stepping to a
  numeric suffix on collision because the id is authored text a human reads in
  a diff. The third returns the `add-relationship` operation, into the source
  subject's document, and returns `null` for a kind the table does not permit
  rather than trusting the caller to have filtered first - the guarantee has to
  hold for any caller, not only a careful one.
  These hold no React, so what an editor would produce is compiled rather than
  asserted about: every kind the palette offers is drafted, applied through
  `applyOperations` and compiled clean, with no filesystem involved anywhere
  now that Core is pure (#236).

- A connection tool. Selecting a subject offers **Connect**; the next subject
  named on the diagram becomes the target; the panel offers the relationship
  kinds the ArchiMate 3.2 table permits between the two, and choosing one
  stages an `add-relationship` into the source subject's document. Until now
  the browser could only update a subject that already existed.
  The reviewer cannot draw an edge `check` would refuse with `YM404`: the
  palette is `permittedRelationshipKinds`, the same lookup the compiler
  performs, and `draftRelationship` refuses a kind outside it even if a caller
  offered one. Naming the source again backs out, because a subject related to
  itself is a mis-click far more often than an intention. An empty palette can
  only mean an endpoint outside the ArchiMate vocabulary, since a pair the
  table knows always permits `association`, so the panel says that rather than
  showing an empty list. Selection rather than dragging, so every step is a
  state transition a test can make and a keyboard can reach (#237).

- Adding a subject. **Add subject** opens a form over the canvas taking a name,
  a kind and a document, and stages an `add-concept`. The kinds are the
  workspace's own vocabulary, already sent with every model frame, so nothing
  in the browser decides what a workspace may contain; the document defaults to
  the selected subject's and any declared document may be chosen. Until now the
  canvas could connect two subjects but not bring one into existence.
  The id is derived from the name rather than asked for, and shown before the
  subject lands: an id is a stable address a human reads in a diff, a reviewer
  thinking about a name writes worse ids than a transliteration does, and a
  derived address the author never saw is one nobody agreed to. `Order Intake
  (v2)` becomes `order-intake-v2`. Two kinds of name are refused rather than
  mangled: one no id can be made of, and one that would start with a digit,
  since `2FA Gateway` would otherwise become `fa-gateway` and stop naming the
  thing. Adding and connecting are alternatives rather than layers, so a click
  on the diagram always belongs to exactly one of them (#238).

- Deleting from the canvas, which completes the four motions the write surface
  has had since ADR 0069 and the canvas had none of. **Delete** on a selected
  subject or relationship asks first, because this is the one motion that
  removes authored text.
  Deleting a subject stages every relationship naming it in the same batch.
  `apply` will not remove a subject something still references and evaluates
  that against the post-batch state, so the two go together or neither does;
  composing that batch is the point, since a reviewer would otherwise have to
  find every relationship touching the subject by hand and the canvas already
  knows them. The confirmation names what else still holds the subject, an
  `owner` or a `supersedes` or a constraint, and warns rather than refuses: the
  list is derived from what a canvas holds, a canvas does not hold everything
  that can reference a subject, and treating it as authoritative would block
  deletions that would land (#239).

- **Fix.** The visual app did not load at all. `DEFAULT_NESTING` was defined in
  `projection.ts`, which loads Ajv through `createRequire`, and importing that
  one constant for its value put `(0, cre.createRequire)(import.meta.url)` in
  the browser bundle, where it is not a function: the app failed to mount and
  the page was blank. It had been broken since the constant was introduced,
  through four subsequent merges, because every test runs in Node and a bundler
  has no opinion about it. `NestingKind` and `DEFAULT_NESTING` now live in
  `nesting.ts`, which imports nothing, and `projection.ts` re-exports them.
  A test now walks every value import out of `src/visual-app` and fails on one
  that reaches `node:`, naming the chain that got there.

- **Fix.** Adding a subject could never have worked. The form offered each
  kind's wire identity, `yarramate/core@0.1#applicationComponent`, where a
  document names a kind the short way, so `apply` refused every commit with
  `YM401 Unknown concept kind`. The editable inspector had always used the
  short label; this form did not. The form also defaulted to the first kind
  alphabetically, `andJunction`, so a reviewer who typed a name and pressed Add
  made a junction by accident; it now asks for a kind and stays disabled until
  it has one (#240).

- A refusal is visible on the canvas, or it is counted (ADR 0102). Core
  populates a diagnostic's `subjects` wherever its pointer identifies one,
  precisely so a drawing consumer can mark the element a rule refused, and it
  is derived where a result is published so compiler diagnostics stay a pure
  function of the model. `check` had always called it. **The visual session
  server never did**, so every diagnostic it sent a browser arrived anchored to
  a byte offset a browser cannot use, and the one consumer the derivation was
  written for was the one that never received it. It does now, and
  `VisualDiagnostic` carries the field.
  A refused commit now marks every subject it named on the diagram, and the
  changeset tray states how many of its problems could be marked and how many
  could not: `2 problems: 1 marked on the diagram, 1 not on it.` Marking the
  ones that can be marked and staying silent about the rest is how a reviewer
  learns the report is unreliable, so the count on screen is always the whole
  count. A subject the active view does not draw counts as not on the diagram,
  because calling it marked would promise a mark that never appears. The mark
  is applied by its own effect rather than with the selection highlight, so
  inspecting a refused element cannot erase the evidence (#241).

- **Fix.** A refused commit marks the subject it is actually about. `subjects`
  was derived by the visual session server from the documents on disk, but a
  refused batch never wrote to those, so the bytes the derivation read were not
  the bytes the diagnostics were located against. A subject the batch added sat
  past the end of the authored array and resolved to nothing, so the canvas
  marked nothing and the tray counted the refusal as not on the diagram: the
  whole of what #241 fixed, undone one layer down, for the commonest refusal a
  reviewer meets. Worse, a batch that also deleted a subject shifted every index
  below it, so the refusal named a subject the reviewer never touched while the
  one at fault showed clean. The derivation moves into `applyOperations`,
  against the candidate sources its compile gate was actually shown, which is
  the only place those indices agree. It stays where a result is published
  rather than inside `compileWorkspace`, so compiler diagnostics remain a pure
  function of the model, and `check` is unaffected because
  `withDiagnosticSubjects` leaves a diagnostic that already names its subjects
  alone (#242).
  Both faults were found by the test that closes #242, and neither could have
  been found without it. The commit path is now walked end to end by the
  browser's own code: the palette is the one the session sent, the operations
  are the ones the drafting modules build from it, the staged set and its pins
  are the ones the real reducer holds, the frame is the one
  `visualBrowserInputFor` mints, and the refusal is read back through the same
  reducer the canvas marks from. Nothing in it is shaped by hand, which is the
  point: the three defects of #240 and #241 all had the shape of a test
  supplying the right-shaped input rather than the one the application produces.
  A commit of one subject per concept kind the palette publishes, all 62 in one
  batch, also proves the vocabulary a canvas offers is one a document can
  actually name.

- `apply` accepts an operation's `document:` as the manifest names it. The
  address was resolved only against the working directory, so the
  manifest-relative form an author naturally writes was refused whenever the
  manifest did not sit in the working directory, which is the standard
  `.yarramate/` layout that `init` produces and every gallery showcase uses. It
  also made an operations document non-portable, applying from one directory
  and failing from another. Both readings are now tried, manifest-relative
  first, and only a path that actually names a document of this workspace is
  accepted, so admitting the second form cannot make an address ambiguous. The
  working-directory form keeps working deliberately, because the visual session
  server addresses documents that way while running with the workspace root as
  cwd. A refusal now also names the documents the workspace declares, up to
  five, instead of only saying the address was wrong (#216, #221).

- A published diagnostic names the subject it is about. Results carry
  `subjects`, most relevant first, wherever a diagnostic's pointer identifies
  one, so a consumer that draws the model can badge the element a rule refused
  instead of resolving a byte offset. It is derived in one place from the
  pointer the diagnostic already carried, so no rule has to remember to name
  what it refused and none of the forty-odd construction sites change. The
  derivation runs where the result document is published rather than inside
  `compileWorkspace`, which keeps the compiler's diagnostics a pure function of
  the model, and is not only a layering preference: enriching the compile path
  broke 23 existing tests that legitimately assert exact compiler output and
  had nothing to say about subjects. Absence is meaningful rather than "not yet
  populated" - a diagnostic that carries no subject is one that belongs to no
  subject, such as a YAML parse failure, a whole-document schema violation, a
  projection's own definition, or a manifest - which gives a UI a complete
  rule: subjects present, badge those elements; subjects absent, route to the
  document lane, the view's properties, or a workspace banner. Only documents
  something was actually said about are parsed, so a clean workspace pays
  nothing (#220).

- `apply` no longer refuses a document whose target field is a block scalar.
  Every `>-` or `|-` field failed with `YM101 Nested mappings are not allowed
  in compact mappings` and wrote nothing, on documents `check` accepts, and
  that style is the idiomatic one in every shipped model, so in practice
  `apply` could not update the description of most real subjects. A block
  scalar's YAML range ends after its terminating newline where a plain
  scalar's ends at its last character, so splicing the range wholesale
  swallowed the line break and glued the following field onto the value's
  line, which then failed to reparse. The splice now puts back whatever
  trailing newlines the replaced range occupied, so both scalar styles behave
  identically, and the value-replacing splice behind `appendListField` uses it
  too so the same class of bug cannot recur there (#215, #217).

- A compound container keeps its own presentation. `archimateNodeShapes` built
  one `node[aspect = "..."]` rule per aspect and appended them after
  `node:parent` in the same array, so for any container whose own kind shares
  that aspect the later rule's plain `rectangle` won the cascade and silently
  undid `node:parent`'s `roundrectangle` and dashed border: a compound box
  rendered as whatever aspect its own kind happened to be rather than as a
  container. Scoping each aspect selector to `:childless` confines it to leaf
  nodes. A container does draw its own kind glyph, which an earlier suspicion
  of a cytoscape limitation on `background-image` for compound nodes had put in
  doubt; the `background-image-opacity: 1` pin added for that goes as a no-op
  resting on a mechanism that does not exist, since image alpha comes from that
  property alone, it already defaults to `1`, and neither `drawImages` nor
  `drawInscribedImage` carries an `isParent` guard. The glyph is 14px in the
  corner of a large dashed box, which is the likeliest reason it read as
  absent. Ships with the `contact-update` journey fixture the bug was found on
  (#212).

- Every core concept kind draws a glyph. Only 17 of 62 had one in
  `BASE_KIND_SVG`, and the rest fell back to `glyph: null`; since shape and
  colour are driven by aspect and layer rather than by kind, that left
  same-aspect siblings visually identical, an `applicationInterface` next to
  its owning `applicationComponent` reading as the same blank rectangle in the
  same colour. The remaining 45 are added, and silhouettes are reused
  deliberately across layers - two overlapping circles for every
  `*Collaboration`, a lollipop for every `*Interface`, a forward arrow for
  every `*Process`, opposing arrows for every `*Interaction`, a pointed
  pentagon for every `*Event`, the existing pill for every `*Service` - so a
  kind reads the same regardless of which layer colours it, matching
  ArchiMate's own convention. The notation coverage test now asserts a glyph
  for every core concept kind rather than for the original 17 (#210, #211).

## 0.23.0

- Interrogation: `has-linkage`, `exists-linkage` (`direction` includes
  `either`), `missing-constraint`, and `missing-flow-content` conditions.
  Questions that name kinds from a profile no document has selected are
  omitted from the report rather than reported closed or stuck open.
  `no-subject-of-kind` honours `kindMatching` (default `descendants`), a
  loosening of `outcome-missing`, `stakeholders-missing`,
  `constraints-missing`, and `no-service-declared` for profile-derived
  kinds.
- Ship `yarramate/policy@0.1` as a built-in optional profile (ADR 0095):
  `authentication-constraint`, `rate-limit-constraint`,
  `reliability-constraint`, `mechanism-constraint`. Select it on a
  document; do not copy a file. Catalogue `core-enrichment` 0.9 adds an
  `interaction` wave before business so hop questions rank ahead of
  `owner-missing`.

## 0.22.0

- Export a Workers-safe visual-graph projector as
  `yarramate/adapter/visual-graph` (`projectGraphForCanvas`) and a
  renderer-neutral ArchiMate notation vocabulary as
  `yarramate/notation/archimate` (layer colours, aspect shapes, kind glyphs,
  relationship line styles). The local visual app consumes the same
  vocabulary. `canvasNode.layer` / `aspect` in
  `yarramate/visual-graph/v1` are closed on the profile enums (plus null).
  No session-protocol or apply changes (#201).

- Correct the conservative-extension property in `docs/PROFILES.md` and ADR
  0079. It was published as one statement — loading a profile extension adds
  subjects and never changes verdicts — quantified over the profile together
  with any documents that select it, and quantified that way it is false: an
  extension document declaring `orders` with a realization to a pre-existing
  goal resolves that goal's `goal-unrealized` question, and so does the same
  document written in plain core. It is now two properties: a vocabulary
  nobody selects changes nothing, and an extension document is never a worse
  neighbour than its core twin — the same subjects declared under the nearest
  core ancestor of each kind it uses. The first keeps its degenerate-case
  identity test; the second is measured by control, running one arrival
  through an extension kind and through its core twin and comparing the
  verdict changes about pre-existing subjects, with a witness that the
  inclusion is strict: exact-kind bucketing leaves a near-duplicate question
  closed where the core twin opens it. No engine change — the properties hold,
  the single sentence overclaimed (#172).

## 0.21.0

- Move a subject's local id through `apply`. Two operations,
  `rename-concept` and `rename-relationship`, re-point the declaration and
  every declarative reference to it — across documents, projections, evidence
  overlays and adapter mappings — in one atomic batch. A rename is an identity
  edit, not a succession: it writes no `supersedes` entry and retires nothing,
  because one subject kept its identity and changed its address (ADR 0094).
  Only matched scalars' own bytes change, so a bare reference stays bare, a
  qualified one stays qualified, an `~aspect` suffix is preserved, and the
  original quoting is kept; comparison is on the qualified address, so a
  same-local id in another document is untouched. Refused when the id is not
  declared, when `to` equals the current id, when the document declares an
  architecture state with the old or new local id, when a reference position
  holds a YAML alias, and — by the compile gate, before a byte is written —
  when the new local id is already taken. New diagnostic `YM913`: `apply`
  re-reads every file it touched and refuses if any of them still names an
  address a rename moved off. The apply result gains `renamedConcepts` and
  `renamedRelationships` counters.
- Walk the staged visual changeset back and forward. The tray gains Undo and
  Redo beside Discard all, over an ordered history of whole staged-operation
  snapshots: staging replaces on a repeated `(target, field)`, so an inverse
  operation would have nothing left to restore a value a re-edit had already
  overwritten, and re-editing one field twice then undoing once now returns
  the earlier edit rather than skipping to the model's own value (ADR 0092).
  Staging, discarding one row, and discarding all are undoable by the same
  mechanism; a refused commit keeps the rows and both stacks; a landed batch
  empties them, because what has landed is reverted with `git revert`, never
  from the browser. Index-attributed commit diagnostics are dropped whenever
  the staged rows move, so row 1's error is never redrawn against whatever now
  occupies row 1. Local state only: the stacks never reach the wire.
- Refuse a visual commit staged against bytes another writer has replaced. Each
  staged row pins the sha256 the browser rendered for the document it targets,
  taken from the model frame the row was staged against and never refreshed
  from a later one, and the commit carries those pins as
  `sourceDigests`. The server checks every document the batch targets — not
  just every pin sent, so a batch that vouches for nothing is refused rather
  than trusted — and answers a mismatch with preserve-and-refresh: the rows
  stay staged, the freshly compiled model is broadcast, and the affected rows
  are marked with the value that is there now. Two reviewers editing the same
  field previously produced one silent overwrite reported as landed (ADR 0093).
  New diagnostics `YMVS312` (a pinned document changed or is gone) and
  `YMVS313` (an existing targeted document was left unpinned).
- **Breaking:** the wire is `yarramate/visual-protocol/v3`.
  `VisualChangesetCommitPayload.sourceDigests` is required, so a v2 browser's
  commit is refused rather than written unconditionally, and
  `VisualRenderedModel` now forwards the per-document `sourceDigests` the
  session request already minted.

## 0.20.0

- Add `compileWorkspaceIncremental`, a delta entry point for consumers that
  compile a whole workspace on every commit. It takes the opaque
  `CompilationCache` the previous call returned and re-parses only the
  documents whose source text changed. Reuse is decided by exact source-text
  equality, never by a caller-declared change set, so a stale cache can only
  fail to save work — it can never alter compiled output (ADR 0091). A
  40-document commit against a 40,000-document workspace costs 698ms instead
  of 5.4s, and `compileWorkspace` and `compileWorkspaceWithProfileContext`
  keep producing byte-identical graphs, profile contexts, and diagnostics.
- Parse each workspace source once. `compileWorkspaceResolved` parsed every
  source twice — once to read its `format` key for profile-versus-document
  classification, then again in its own loop — and re-parsed a document to
  resolve each claim's line and column. Classification now reads the composed
  value the first parse produced, and positions are memoised per document:
  a full compile of 1,000 documents falls 233ms → 193ms and 40,000 falls
  7.9s → 5.3s, with output unchanged byte for byte.
- Refuse a LikeC4 export whose selected concepts never reach the emitted
  model. `likec4 validate` reads an empty model as valid, so the emitter was
  the only place that could notice a projected concept silently missing from
  the generated text; it now compares the assembled definition lines against
  the projection and reports `YMLC112`, located at the concept that went
  missing. `YMLC111` joins the published diagnostic envelope, which never
  admitted the code its own relationship-gap report emits, and `pnpm validate`
  runs `export-project --check` before handing the directory to
  `likec4 validate`, which passes vacuously on absent output. `likec4` is
  pinned to the exact `1.59.2` the docs already name, so the grammar oracle
  cannot drift away from the emitter under a caret range.
- Delete a visual session's entries in a decided order. Recursive removal
  rejects on the first entry that refuses deletion while the sibling
  deletions it already started are still in flight, so a failed cleanup could
  still take `journal.jsonl` with it and leave the retry the failure invites
  nothing to recover from — 40 of 40 runs lost the journal on Linux Node 22,
  8 of 40 on macOS, which is why the suite was green here and red there.
  Removal now walks one awaited entry at a time and keeps back the journal a
  retry reads and the marker that authorises deleting the directory at all.

## 0.19.0

- Render and edit the native model in the browser. `yarramate-visual` now
  draws the compiled graph v2 model directly with cytoscape.js — no LikeC4
  DSL, no compiler round-trip, no external renderer to resolve or consent to.
  Inspector fields are constrained to what the model allows, edits stage as a
  changeset, and **Commit changes** lands them as one `yarramate/operations/v1`
  batch through the same validated `yarramate apply` write the CLI performs;
  a refused batch writes nothing and shows the diagnostics on the row that
  caused them. The runtime never runs `git commit`, so Git review still
  decides what becomes declared architecture. Dragged positions persist per
  projection in `.yarramate/visual-layout/` sidecars. The wire is
  `yarramate/visual-protocol/v2`: the agent's `model.replace` mutation path is
  gone, so a v1 child is refused rather than misread (ADRs 0084 to 0088).
- Resolve a chat-issued filter server-side against the compiled graph. A
  delegated agent sets `appliedQuery: { query }` and the runtime evaluates the
  `ProjectionQuery`, so the panel and the chat agent can no longer produce two
  different match sets for one query; an agent-supplied `matchedIds` is
  refused with `YMVS311`. A chat-issued narrowing is badged with the query
  that produced it and dismissible in one click (ADR 0090).
- Land evidence observations through `yarramate apply`. An observation is a
  write addressed by its `(target, key)` pair, batched and validated with
  every other operation rather than written by a separate path (ADR 0089).
- Rename the question catalogue's `authority: evidence` to `agent`, matching
  the runtime, `yarramate-interrogation-report/v1`, and `docs/INTERROGATION.md`.
  A catalogue that declared `evidence` passed catalogue validation and then
  produced a report that failed its own schema; the shipped catalogue never
  used the value, so no interview changes.
- Add the `unconstrained-kind` trigger condition and a `kind-untested` hygiene
  question (core-enrichment 0.7 → 0.8): a subject whose kind is pinned by no
  relationship claim could be reclassified freely and still compile, so the
  interview asks rather than the engine inferring (ADR 0083). 153 of the
  repository's own 238 concepts carry such a kind; the shipped question is
  scoped to active-structure, where it opens 4.
- Publish `relationshipKindEndpointAspects` on `ResolvedProfileContext`, the
  lineage-resolved table of which endpoints each relationship kind constrains.

## 0.18.0

- Resolve `attestations[].by` as a subject reference, reusing `YM304` when it
  does not resolve, instead of accepting free text: an authority has to be
  someone the model already knows (ADR 0082). Documents whose `by` is a name
  rather than a reference no longer compile.
- Add optional `attestations[].recordedBy` naming whoever held the pen.
  `apply` requires it on every attestation an operations batch writes, since a
  batch is by construction a machine's transcription of someone's judgment.
- Report `unconfirmed-attestation` from `reconcile`, with a matching
  `summary.unconfirmedAttestations` counter, when a record names a recorder
  other than its attesting authority. Advisory like `stale-attestation`:
  `check --strict` is unaffected.
- Render the recorder beside the authority in `export rtm` attestation cells.

## 0.17.0

- Add the `yarramate-visual` adapter (beta): a sibling runtime that renders
  LikeC4 diagrams of a bounded slice in a local, authenticated browser
  session and delegates a chat conversation about what is on screen to a
  visual agent, over a published, closed `yarramate/visual-*/v1` contract.
  Git review remains responsible for accepting any resulting architecture
  proposal; the runtime never becomes canonical architecture by itself.

## 0.16.0

- Add optional profile concept-kind layers and layer-aware projections.
- Add bounded, directional connected expansion and deterministic presentation metadata.
