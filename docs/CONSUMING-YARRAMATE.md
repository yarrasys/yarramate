# Consuming YarraMate

Native documents in the consuming repository remain canonical. Consumer
commands are documented as `yarramate ...` because the executable is the
stable product interface regardless of how it was installed.

## Published quick start

Once the package and public repository are published:

```sh
npm install --global yarramate
npx skills add yarrasys/yarramate --skill yarramate-architecture
yarramate init .
yarramate check .yarramate/workspace.yaml --json
```

The first command installs the engine executable. The second installs the
canonical guided methodology for supported agent harnesses. They are separate:
the skill orchestrates the CLI and does not contain its runtime.

Projects that prefer a version-pinned development dependency may instead use:

```sh
npm install --save-dev yarramate
npx yarramate init .
```

Inside package scripts and agent harness commands, the project-local
executable is resolved as `yarramate`:

```json
{
  "scripts": {
    "architecture:check": "yarramate check .yarramate/workspace.yaml --json",
    "architecture:reconcile": "yarramate reconcile .yarramate/workspace.yaml"
  }
}
```

The remainder of this guide uses the direct executable form.

## Install a local artifact

Before the first npm release, validate consumption through a local package
artifact. From the YarraMate repository:

```sh
pnpm pack --pack-destination /tmp/yarramate-package
```

In a consuming project:

```sh
npm install --save-dev /tmp/yarramate-package/yarramate-<version>.tgz
npx yarramate init .
npx yarramate check .yarramate/workspace.yaml --json
```

The package contains the CLI runtime, normative schemas, and the canonical
`yarramate-architecture` skill. It excludes the YarraMate repository
self-model, source, tests, and fixtures.

## Install the agent skill

For Claude Code, the repository is its own plugin marketplace:

```sh
/plugin marketplace add yarrasys/yarramate
/plugin install yarramate-architecture@yarramate
```

The marketplace entry points at `skills/yarramate-architecture` in this
repository, so the installed plugin is the canonical skill rather than a
copy. It declares no version, taking its version from the commit it was
installed from.

For other harnesses, use the agent-skills installer:

```sh
npx skills add yarrasys/yarramate --skill yarramate-architecture
```

The installed directory is a deployment of the canonical repository skill,
not a harness-specific fork. Before publication, packed-artifact testing may
instead expose the packaged copy through thin local links:

```sh
mkdir -p .agents/skills .claude/skills
ln -s ../../node_modules/yarramate/skills/yarramate-architecture \
  .agents/skills/yarramate-architecture
ln -s ../../node_modules/yarramate/skills/yarramate-architecture \
  .claude/skills/yarramate-architecture
```

Do not independently edit installed or linked copies. Changes to the
methodology belong in the canonical repository skill.

## Existing-project discovery

Ask the harness to use `$yarramate-architecture` to discover the project.
The skill will inspect repository evidence, propose native documents, and run:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate reconcile .yarramate/workspace.yaml
yarramate ask .yarramate/workspace.yaml \
  .yarramate/projections/<projection>.yaml
```

Evidence overlays declared in the manifest are evaluated by `reconcile`
(and gated by `check --strict`) rather than through a separate command.
Evidence remains distinct from declared intent. A generated proposal becomes
canonical only through the consuming repository's normal Git review.

## Architecture-first design

Ask the harness to use `$yarramate-architecture` to design the solution before
implementation. The skill records alternatives, target intent, and bounded
implementation context, then runs:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate ask .yarramate/workspace.yaml \
  .yarramate/projections/<alternatives>.yaml
yarramate ask .yarramate/workspace.yaml \
  .yarramate/projections/<target>.yaml
yarramate ask .yarramate/workspace.yaml \
  --compare <baseline-state> <target-state>
```

The CLI verifies deterministic correctness. It does not approve the design or
require a complete model.

## Optional Graphify evidence

When Graphify has generated `graphify-out/graph.json`, an explicit subject
mapping can produce a standard evidence overlay:

```sh
yarramate-graphify observe \
  graphify-out/graph.json \
  .yarramate/integrations/graphify/subject-mapping.yaml \
  .yarramate/workspace.yaml \
  --id repository-graphify \
  --version 1.0 \
  > .yarramate/evidence/graphify.yaml
```

Graphify extraction remains a separate installation and operation. The
adapter observes only explicitly mapped nodes and never promotes them into
canonical architecture.

## Visual architecture conversations

Ask the harness to use `$yarramate-architecture` to visually explain the
architecture, show how a question relates to the model, or compare design
choices. There is no command to learn: the skill orchestrates the
`yarramate-visual` runtime that ships in this package, exactly as it
orchestrates `yarramate` and `yarramate-likec4`.

Installation and runtime stay separate here too. `npm install` provides the
`yarramate-visual` binary and the prebuilt browser application; the skill
provides the journey. Neither contains the other.

What the journey guarantees:

- **Authority is canonical, and labelled.** A session renders one workspace
  that passed `yarramate check`, through
  `yarramate ask <workspace> "<topic>" --json`. There is no non-canonical
  rendering mode: the browser names the model it is showing, and every edit is
  judged against that workspace.
- **The server is local only.** It binds `127.0.0.1` on a random port, issues
  separate browser and agent credentials, ships no external assets, and stores
  no provider credentials. Session state lives under the ignored
  `.yarramate-out/visual/` directory and is never canonical.
- **The renderer is native and dependency-free.** cytoscape.js draws the
  compiled graph v2 model directly in the prebuilt browser application. There
  is no DSL round-trip, no external renderer to resolve, and no consent
  prompt; the visual binary keeps the package's existing Node contract.
- **Editing is mechanical, and it lands through `apply`.** Inspector fields are
  constrained to what the model allows, edits accumulate in a changeset, and
  **Commit changes** submits them as one `yarramate/operations/v1` batch
  through the same validated `yarramate apply` write the CLI performs. A
  refused batch writes nothing and returns the diagnostics that refused it. A
  landed batch is an ordinary working-tree change — the runtime never runs
  `git commit`, so Git review still decides what becomes declared
  architecture, and revert is `git revert`.
- **Chat explains, filters, and focuses; it cannot mutate.** Where the harness
  can delegate a child agent, deliver its completion back, and stay
  interruptible, the browser carries a chat widget answered by a bounded visual
  agent. That agent cannot author a model, edit repository files,
  `.yarramate/`, credentials, or harness configuration; a filter it applies is
  evaluated server-side, badged on the canvas, and dismissible in one click.
- **Otherwise you get diagram-only mode.** The same renderer, view navigation,
  filtering, and editing, with the conversation continuing in the main harness.
- **Recovery is the main agent's.** On End, cancellation, or any failure the
  main agent recovers a structured handoff — confirmed decisions, requested
  changes, unresolved questions, final views, termination reason — before
  anything is torn down. The raw transcript is returned only on request.
- **Cleanup is automatic.** Stopping shuts the server process tree down and
  deletes the temporary session; a later start prunes any orphan older than
  24 hours.

Consumers validating the protocol can import the versioned documents directly,
for example `yarramate/schema/visual-handoff` or
`yarramate/schema/visual-session-request`.

## Hosted or browser rendering of the visual graph

Consumers that compile a workspace themselves (or receive a compiled
`SemanticGraph` and profile context) and render with their own cytoscape (or
other) host can import the pure projection and notation surfaces — without
starting `yarramate-visual`:

```ts
import { projectGraphForCanvas } from 'yarramate/adapter/visual-graph'
import {
  conceptNotationOf,
  relationshipNotationOf,
  kindGlyphDataUriOf,
  LAYER_COLORS,
} from 'yarramate/notation/archimate'
```

These subpaths are Workers/browser-safe: no Node built-ins, no `ws`, and no
visual session server. The local `yarramate-visual` runtime remains the
optional loopback conversation product and is not required for projection.
`presentation.notation: 'archimate'` is still a rendering mode only
([ADR 0087](adr/0087-archimate-notation-is-a-rendering-mode-not-a-vocabulary.md));
the notation module is the rendering vocabulary for that mode; the element
vocabulary and relationship table themselves are implemented in the core
profile (ADR 0097).

## Evaluating question catalogues off Node

The interrogation engine is public API. A consumer that compiles a workspace
itself can load a catalogue and evaluate it without the CLI:

```ts
import {
  evaluateCatalogue,
  loadQuestionCatalogue,
  INTERROGATION_SEMANTICS_VERSION,
} from 'yarramate/interrogation'
```

**Import the subpath, not the package entry, wherever the runtime is not
Node.** The `.` barrel reaches `node:fs`, `node:path` and `node:child_process`
through workspace loading, the filesystem source store and git-derived
attestation staleness, so taking the engine from there drags Node in behind it.
`yarramate/interrogation` carries the engine alone and is pinned free of Node
built-ins by the same test that guards `yarramate/adapter/visual-graph`. The
same names are also exported from `.` for Node consumers.

`evaluateCatalogue` returns the report without its `workspace`, which the
caller supplies:

```ts
const report = { workspace: id, ...evaluateCatalogue(catalogue, graph, profileContext) }
```

The report carries `semantics`, the version of condition evaluation, which
changes only when an existing question's answer can change for an unchanged
model ([ADR 0106](adr/0106-a-report-says-which-engine-answered.md)). A consumer
that **persists** answers should store it beside them: equal means a flipped
answer is about the model and belongs in front of a user, different means the
engine moved and the right response is to re-baseline silently rather than
reopen someone's queue.

Every question also carries `trigger`, the catalogue conditions that opened
it, verbatim ([ADR 0110](adr/0110-an-open-question-carries-its-answer-shape.md)).
That is the question's machine-readable answer shape: a host building an
answering affordance — a concept form with the kind preselected from
`no-subject-of-kind`, a relationship editor with one endpoint fixed by
`missing-relationship`'s `direction`, an attestation form on
`missing-attestation`'s `topic` — maps the conditions directly instead of
re-deriving the shape from its own catalogue copy. The field is required and
the published report schema uses `additionalProperties: false`, so upgrade a
separately pinned schema together with the package.

### Mount the visual editor

Mount the packaged editor when the consuming product owns the sources and
already has a resolved workspace:

```ts
import { mountEditor } from 'yarramate/visual-app'
import 'yarramate/visual-app/styles.css'

const editor = mountEditor(document.querySelector('#editor')!, {
  store,
  workspace,
  sections: ['properties', 'changes'],
})

// Later, when the owning screen is removed:
editor.unmount()
```

### The questions are yours

The questions section evaluates the shipped `core-enrichment` catalogue by
default. A host with its own interrogation supplies its own instead (#328):

```ts
const editor = mountEditor(element, {
  store,
  workspace,
  sections: ['palette', 'properties', 'questions', 'changes'],
  catalogue: { path: 'catalogues/consulting.yaml', source: catalogueText },
  dismissed: [
    { questionId: 'register-fidelity', subject: 'crm-integration' },
    { questionId: 'engagement-framing' },
  ],
})
```

The division this draws is deliberate. **The engine is yarramate's and so is
the UI; the questions belong to whoever adopted it.** `core-enrichment` is a
general modelling interview — right for yarramate's own CLI, and right for a
host with no domain of its own — and wrong for a product whose interview is
about its own subject matter. Inheriting it would mean asking a consultant
about modelling hygiene in the pane where they are asking a client about
sign-off.

`catalogue` takes bytes, and a catalogue that does not load leaves the overlay
absent rather than failing the mount: the overlay is a garnish on the model,
and a model frame must not be blocked by it.

`catalogue` also takes the composed SET a workspace carries (#369) — an array
of `{ path, source }` — evaluated together under the ADR 0129 composition
rules, each question qualified by its own catalogue. A host attaching
per-project catalogue packs beside its base interview hands the mount the
same set its other question surfaces derive from, so the pane and the host's
own Open-items view ask the same interview over the same files:

```ts
catalogue: [
  { path: 'catalogues/consulting.yaml', source: baseText },
  { path: 'questions/mulesoft-pack.yaml', source: packText },
],
```

`dismissed` is what the host has already dealt with. A supplied catalogue
alone does not cover this — the editor evaluates the catalogue itself and
cannot know that a reviewer set a question aside, with a reason, recorded
somewhere the editor cannot see, so the pane would go on asking a question the
host's own product had answered. Naming a `subject` dismisses the question for
that subject alone; omitting it dismisses the question wherever it appears.

Dismissal decides what the **pane draws** and nothing else. The model is
untouched and `ask --open` still reports the question, because the interview is
not the editor's to settle.

Pass `readOnly: true` to mount a viewer over the same surface — for a frozen
published snapshot, say ([ADR 0117](adr/0117-a-mounted-editor-can-refuse-the-pen.md)).
The reviewer still selects, filters, navigates views and reads questions and
properties (as values, not forms), but every affordance that stages or commits
is absent rather than disabled: no Add subject, no palette or changes
sections, no Connect/Delete, no view create/rename/delete, and drags move
nodes without writing layouts. With no `sections` named, a read-only mount
defaults to `['properties', 'questions']`. This is a UI posture only — pair it
with a store that refuses writes; the two defenses are independent.
`mountEditorWith` takes the same flag as its trailing parameter.

The returned handle can also point at the canvas
([ADR 0118](adr/0118-the-host-can-point-at-the-canvas.md)):
`select(subjectId)` selects a concept or relationship exactly as a canvas tap
would, which also scopes the Open questions section to it;
`openDraft({ kind })` opens the Add-subject dialog with the kind preselected
the way a palette pick seeds it (omit `kind` for the plain no-default form);
and `startConnection(fromSubjectId)` arms the Connect flow from that subject —
the relationship-with-one-endpoint-fixed affordance an interrogation trigger
describes. Each returns `false`, rather than throwing, when it moved nothing:
an id the current model does not name, a model that has not arrived yet, or —
for `openDraft` and `startConnection` — a read-only mount. These are the
programmatic twins of tap, palette and Connect, never a second write path:
anything they lead to still stages through the changeset and commits through
the same validated batch.

The viewer also accepts per-subject marks
([ADR 0119](adr/0119-the-viewer-accepts-the-hosts-marks.md)): pass
`decorations: { [subjectId]: 'added' | 'removed' | 'changed' }` — concepts and
relationships alike — and the canvas renders them as visual treatments (added
an eucalyptus border, removed a quiet dashed one, changed ochre; a fault still
outranks any mark). Comparison semantics stay on your side of the seam: the
viewer never diffs, it draws the map it is handed, so what a mark means — and
any legend saying so — is yours. The option is the initial map; the handle's
`setDecorations(decorations)` replaces it wholesale (never a merge, `{}`
clears) for a live comparison, works under `readOnly` and before the first
model frame, and ids the model does not name are silently inert. It shares the
pointer methods' one false window: before the shell's first render, or after
unmount.

`store` is the caller's synchronous `SourceStore`; `workspace` is the caller's
pre-resolved `ResolvedWorkspace`. The local host compiles, projects, filters,
commits and saves layouts over that store. A changeset's model and view writes
land together in one compare-and-swap batch; the caller therefore owns
persistence. An asynchronous product fetches into a synchronous in-memory
store before mounting and flushes writes itself, per
[ADR 0100](adr/0100-sources-come-from-a-store-and-a-batch-lands-by-compare-and-swap.md).

The stylesheet ships beside the bundle and is not imported by it, so a host
attaches it one of two ways. A bundler takes the `import` above; because that
import is a `.css` file rather than a module, TypeScript needs the ambient
declaration a bundler project already carries (`vite/client` for Vite,
`next-env.d.ts` for Next, or `declare module '*.css'`), and reports TS2882
without one. A plain page has no bundler to answer an `import`, and links it
instead:

```html
<link rel="stylesheet" href="/path/to/yarramate/dist/visual-app-lib/styles.css">
```

The browser bundle is self-contained: the host supplies no React. The declared
sections omit `chat` because a local host has no agent, choices, handoff,
journal or session end. A product with its own protocol-compatible server or
transport instead imports `mountEditorWith` from `yarramate/visual-app` and
mounts it with its `EditorHost`; `yarramate-visual` remains the supplied
socket/session host.

[...]

## The model as an Excel workbook

`yarramate export xlsx <projection.yaml> <workspace.yaml> --out <file>` writes
a workbook an architect or FDE can work in, and `yarramate/workbook` publishes
the writer for a host that has no Node:

```ts
import { workbookFrom } from 'yarramate/workbook'

const bytes = workbookFrom(projectionResult, {
  workspace: 'acme',
  yarramateVersion: '1.5.0',
  sourceDigests,
  conceptKinds,
  relationshipKinds,
  statuses: ['planned', 'current', 'retired'],
})
```

Synchronous, dependency-free and deterministic: the same input always produces
the same bytes. The import graph is held free of Node builtins and of the
compiler at runtime, so it fits a Cloudflare Worker or a Durable Object. A
caller hands over an already-evaluated `ProjectionResult`, which is what keeps
schema validation out of that graph.

**It takes a projection**, so it inherits every facet a projection query has.
That is how a caller chooses which *version* to export: a query naming
`states` produces a workbook of that architecture state, with no separate
flag.

```yaml
query:
  states:
    - target-state
```

**Which makes a workbook a SLICE, and it is worth being plain about that.** An
omitted facet imposes no constraint, so `query: {}` exports the whole model,
and every facet you name narrows it. For a subject the query selected, nothing
is dropped: the projection filters claims by subject membership rather than by
predicate, so every fact about an included subject arrives, and `07 Other
Facts` catches whatever the named columns do not model. For a subject it did
not select, there is simply no row, and a missing row is never a deletion, so
**a narrow workbook cannot damage a wide model on the way back in**. The
`00 Read Me` sheet says all of this and reports the counts the slice actually
has, because an FDE handed a filtered workbook with no note will read it as
the model.

**Reading the sheets.** Column A is always the id and is what the model is
keyed on. A column headed `↳ … (auto)` is derived for readability and is
ignored on the way back. Kind and status columns are drawn from the compiled
profile, so they carry the vocabulary that workspace actually has.

Sheets beginning `~` are machinery. `~Meta` records the format, the versions
and the source digests. `~Baseline` is a hidden copy of the working rows
exactly as exported, and exists so a later import can tell an author's edit
from a change the repository made underneath. Neither is edited.

Anything the mapping does not recognise is carried verbatim on `07 Other
Facts` rather than dropped, so a workbook stays lossless across a compiler
that grows new predicates.

**Marking up the sheets.** `WorkbookSheet` takes optional `headerStyle`,
`columnStyles` and `columnWidths`. The styles are a closed set of **roles**
rather than appearances — `header`, `muted`, `emphasis` — so the test for
admitting a fourth is whether it can be named without reference to how it
looks. A request for a colour is the one a closed set exists to refuse,
because that is what turns a style vocabulary into a styling engine.

The use worth having is not decoration. Where a workbook's columns differ in
what they reach — some binding to the model, some carried alongside it, some
computed and ignored on the way back — an editor cannot see which is which,
and finds out only when an import reports that a cell could not be written
back. A role in the file says it while they are typing.

Formatting is not content in either direction. A styled workbook reads back
exactly as an unstyled one, and an editor's own formatting is ignored on
import — and then lost on the next export, because the workbook is
regenerated from the model. That last part is why producer-applied styling is
the only kind that survives.

**An optional feature's absence is silent, and that is your test to write.**
Passing none of these fields produces byte-identical output to a release
before they existed. That property is what makes the feature safe to adopt,
and it is exactly what makes its absence undetectable: if a rename, a bad
merge or a refactor stops the fields reaching the writer, every test that
asserts on *behaviour* stays green while the workbook ships with no roles at
all, because a workbook with no styling is completely valid.

The general form, which reaches past this feature to any optional thing you
take from a library: **assert the feature arrived, not only that the result
is well-formed.** One positive test at the consumer that fails when the
feature stops arriving — the styles part is in the bytes, the header is
present, the width was applied. Behavioural assertions cannot catch an
absence-shaped regression, because the behaviour is well-defined in both
cases. This is the same reason a `?? ''` default hides a missing column: what
degrades gracefully degrades quietly.

**Reading one back.** `yarramate import xlsx <workbook.xlsx> <workspace.yaml>`
merges an edited workbook into the model. An unedited round trip changes
nothing, byte for byte.

Edits land as `yarramate/operations/v1` through `apply`, so untouched YAML
keeps its comments, key order and formatting, and the import passes the same
atomic gate every other write does.

It is a three-way merge. `~Baseline` is the ancestor, so an edit the workspace
did not touch merges even if the repository moved on; only a field changed on
**both** sides is refused, and a refusal writes nothing anywhere. A missing row
is reported and never treated as a deletion, and a new row needs its `Document`
column filled in.

**On a host with no Node**, `yarramate/workbook/import` publishes the same
three steps the CLI runs, so ingesting a workbook is not CLI-only:

```ts
import {
  readWorkbook,
  baselineSheets,
  mergeWorkbook,
  operationsFrom,
  operationsDocument,
} from 'yarramate/workbook/import'

const read = await readWorkbook(bytes)
if (!read.ok) return refuse(read.reason)

const ancestor = read.sheets.get('~Baseline')
if (ancestor === undefined) return refuse('not produced by yarramate export xlsx')

const report = mergeWorkbook(
  read.sheets,
  baselineSheets(ancestor),
  buildWorkbookSheets(currentResult, provenance),
)
if (report.conflicts.length > 0) return refuse(report.conflicts)

const { operations, refusals } = operationsFrom(report, read.sheets)
await apply(operationsDocument(operations))
```

`readWorkbook` is **async** while the writer is synchronous, and deliberately
so: a workbook this package wrote has stored entries and inline strings, but
one a person saved from Excel comes back deflated and shared-stringed, and
inflation is only offered as a stream (`DecompressionStream('deflate-raw')`,
present on Workers, in browsers and in Node 18+). Keeping the writer
synchronous is what stops it infecting a synchronous store on the host side.

It is a **separate subpath** from `yarramate/workbook` on purpose. The package
declares no `sideEffects` field, so a bundler must assume every module might
have one and cannot shake an unused re-export away; a host that only generates
workbooks would otherwise carry the reader, the merge and the operations
emitter it never calls. `test/export-purity.test.ts` holds the two entries
disjoint as well as pure.

The host keeps three jobs: reading the bytes, evaluating the projection that
says what the model holds **now** (the third argument to `mergeWorkbook`, which
is what measures repo drift in the same terms the author edited in), and
applying the operations. Refusal wording is the host's too. The `Conflict`
values name the sheet, row, column, what the author wrote, what the workspace
now holds and their common ancestor, which reads like a merge tool rather than
like something you hand a consultant.

## MCP server for agent harnesses

Harnesses that load MCP servers can connect the bundled read-only adapter:

```json
{
  "mcpServers": {
    "yarramate": {
      "command": "yarramate-mcp"
    }
  }
}
```

It exposes `yarramate_ask` (orientation, free text, subject ids, or a
projection path, with an optional token budget), `yarramate_design`,
`yarramate_check`, and `yarramate_reconcile`. Every tool call executes the
same stable CLI in the server's working directory; nothing mutates native
documents, and authoring stays with the CLI and Git review.

## Continuous drift signal in CI

The repository root ships a composite GitHub Action that checks the
workspace and reports intent-vs-evidence drift on every pull request:

```yaml
name: architecture
on: pull_request
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: yarrasys/yarramate@main
        with:
          workspace: .yarramate/workspace.yaml
```

The job fails on deterministic correctness errors and, by default, when
reconciliation reports contradicted claims; unknown and not-observed
findings are reported in the job summary without failing. Set
`fail-on-contradiction: 'false'` to make the whole signal advisory. The
action never mutates sources — it runs only the read-only `check` and
`reconcile` commands, so it is safe as a required check.
