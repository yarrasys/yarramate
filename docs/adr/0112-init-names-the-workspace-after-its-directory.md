# Init names the workspace after its directory

Status: accepted

`yarramate init` seeded every workspace with the same identity:
`id: main` in the manifest and `id: main` in the seed document, whatever
directory it initialized. The id is not cosmetic — it is the name every
downstream surface repeats: the reconciliation report opens with
`"workspace": "main"`, `ask` orients around it, and the graph attributes
every claim to a document called `main`. The GitLab discovery run
(#275) shipped its showcase with `workspace: main` in the reconciliation
report until someone hand-edited it — an edge an agent trips on
precisely because everything around it is uniform: the tool is standing
in the project whose name it needs, and says `main` anyway.

## Decision

The default id is the target directory's basename, slugified to the id
grammar the document and workspace schemas already share
(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`): lowercased, every run of
characters outside `[a-z0-9]` collapsed to a single hyphen, hyphens
trimmed from the ends. `yarramate init my-product` seeds
`id: my-product` in both files; `init .` resolves the target first, so
the cwd's basename is what gets named. The derived slug is validated
against the shared pattern, and `main` remains the fallback whenever
the basename yields nothing the schemas accept — `.`, `..`, an
all-symbol name, a digit-led one. The seed document id and the
workspace id derive the same way, so the first `check` and `reconcile`
outputs say the project's own name.

Everything else is unchanged. The seed document still lands at
`.yarramate/architecture/main.yaml`, and the AGENTS.md/CLAUDE.md
pointer block is byte-identical, because both are paths, and the paths
were never the problem.

## Excluded options

- **Asking for the name**: init is the one command an agent runs
  unattended before any conversation exists
  ([ADR 0040](0040-init-declares-the-model-to-agent-harnesses.md)
  delivers its pointer for exactly that reader). A prompt would break
  every scripted first run to improve a default the user can already
  override by editing one line.
- **A `--id` flag**: a second way to say what the filesystem already
  says. The basename is right nearly always, the fallback covers the
  rest, and the manifest is the override — one editable line, validated
  by the next `check`.
- **Repairing unusable slugs** (`2048` → `x2048`, or stripping to the
  first letter): every repair invents a name nobody chose. A wrong
  guess written into two files is worse than the honest fallback the
  previous behaviour already was, so an unusable basename falls back
  whole rather than being mended.
- **Renaming the seed file to `<slug>.yaml`**: the manifest selects
  documents by glob (`architecture/*.yaml`), so the filename carries no
  semantics — and a variable path in init's output would break the one
  thing worth keeping stable, where the seed landed.

## Consequences

A fresh workspace introduces itself by name: the first reconciliation
report a harness reads says `"workspace": "my-product"` without a
hand edit. Existing workspaces are untouched — init refuses to write
over either file — and no schema moves: the derived id satisfies the
pattern both schemas have required all along, which is what makes the
validation-then-fallback shape safe rather than clever.
