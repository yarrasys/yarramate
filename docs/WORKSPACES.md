# Explicit workspace manifests

A workspace manifest is a closed, versioned index of repository inputs. Its
normative structure is `schema/yarramate-workspace.schema.json`.

```yaml
format: yarramate/workspace/v1
id: checkout
documents:
  - architecture/*.yaml
profiles:
  - profiles/*.yaml
projections:
  - projections/*.yaml
adapterMappings:
  - adapters/*.mapping.yaml
evidence:
  - evidence/*.yaml
contracts:
  - contracts/*.yaml
```

Patterns are relative to the directory containing the manifest and use
forward-slash paths. Resolution:

- rejects absolute paths, backslashes, and `..` traversal;
- rejects symlink targets outside the manifest directory;
- expands patterns to regular files only;
- reports every pattern that matches no files;
- sorts and deduplicates resolved paths;
- rejects a file declared in more than one category.

Empty categories are written as `[]`. A manifest never searches parent
directories, reads an environment override, contacts a registry, or infers a
source category from a filename.

## CLI use

The manifest is passed explicitly wherever a command otherwise accepts
workspace source files:

```sh
yarramate check .yarramate/workspace.yaml
yarramate compile .yarramate/workspace.yaml
yarramate context .yarramate/projections/current.yaml .yarramate/workspace.yaml
yarramate view .yarramate/projections/current.yaml .yarramate/workspace.yaml
```

`check` validates declared projection structures, adapter mappings, and Core
contract manifests in addition to compiling profiles and native documents. It
also evaluates declared evidence against the resulting graph. Contract checks
verify their schema files and package surface. `compile`, `context`, and
`view` compile only profiles and native documents because projections,
adapter mappings, evidence, and contracts do not become semantic claims.
Projection files remain explicit command arguments; the manifest catalogue
makes them discoverable without selecting a default.

Safe authoring commands may use the manifest as their explicit companion
source:

```sh
yarramate add .yarramate/architecture/engine.yaml \
  --id compiler --kind compiler-module --name "Compiler" \
  --source .yarramate/workspace.yaml
```

The edited target is replaced in memory, so its original manifest entry is not
compiled twice.

`yarramate init <directory>` creates both `.yarramate/architecture/main.yaml` and
`.yarramate/workspace.yaml`, and refuses to overwrite either. It also delivers
the agent-harness pointer to both `AGENTS.md` (the cross-harness convention)
and `CLAUDE.md` (which Claude Code auto-loads), creating or extending each
without duplicating the pointer; pass `--no-pointer` to skip both, e.g. when
analyzing a third-party clone.

## Boundary

The manifest is deterministic input configuration, not architecture or
governance. It does not contain claims, ownership, approvals, output paths,
layout, adapter-specific options, secrets, remote dependencies, or generated
graph artifacts.

Resolution diagnostics use:

- `YM701` for an unsafe pattern;
- `YM702` for an unmatched pattern;
- `YM703` for a file declared in multiple categories.

The typed package API exposes `loadWorkspaceManifest`. The schema is exported
as `yarramate/schema/workspace`.
