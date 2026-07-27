# Optional adapter mappings

Adapter mappings connect canonical native YarraMate subjects to identities
owned by an external tool. Their normative structure is
`schema/yarramate-adapter-mapping.schema.json`.

```yaml
format: yarramate/adapter-mapping/v1
id: governed-change-likec4
version: "1.0"
adapter: likec4
mappings:
  - native: governed-change#control-plane
    external: controlPlane
    type: concept
```

`native` is always a globally qualified compiled subject identity:
`<document-id>#<local-id>`. File paths and local-only references are not
accepted. `external` is an opaque, non-empty identity interpreted by the named
adapter. `type` is `concept` or `relationship`.

The generic mapping validator checks deterministic tool-neutral integrity:

- the native subject exists in the compiled graph;
- its compiled subject type matches the declaration;
- a native subject occurs at most once in a mapping document;
- an external identity occurs at most once in a mapping document.

Across all mapping documents checked together, versioned mapping identities
are unique. Native and external identities remain one-to-one within the scope
of one named adapter; the same native subject may be mapped independently by
different adapters.

These are correctness checks, not completeness checks. Native subjects need
not all be mapped. The generic validator does not interpret or validate an
external identity; the named adapter owns that check against its external
model or catalogue.

Mappings are optional companion documents. They never become native semantic
claims, and `compileWorkspace` does not load or depend on them. The stable
`check` CLI orchestrates the optional layer:

```sh
yarramate check yarramate.workspace.yaml
```

The typed package API exposes `loadAdapterMapping`, `validateAdapterMapping`,
and workspace-level `validateAdapterMappings` for adapter implementations and
agent harnesses.
Successful loads normalize mapping entry order by native identity, external
identity, and type.

The governed-change example has a canonical native document plus a mapping to
the existing LikeC4 visualization prototype:

```sh
node dist/cli.js check \
  examples/governed-change/yarramate.workspace.yaml
```

Relationship mappings are supported, but the example deliberately maps only
concepts because its current LikeC4 relationship declarations do not carry
authored stable identities. YarraMate does not invent position-derived
external relationship identities.

## LikeC4 export

The optional adapter has its own binary and package subpath:

```sh
yarramate-likec4 export-project \
  examples/governed-change/all.projection.yaml \
  examples/governed-change/likec4.mapping.yaml \
  generated/governed-change \
  examples/governed-change/yarramate.workspace.yaml
```

The same typed seam is exported from `yarramate/adapter/likec4` as
`exportLikeC4`. Its inputs are a closed projection result and one mapping; its
output is deterministic LikeC4 source or sorted adapter diagnostics.
CLI failures use the closed
`yarramate/likec4-diagnostic-result/v1` envelope.

Every projected concept must have a valid LikeC4 identifier in the mapping.
Relationship declarations use mapped endpoint identities and the terminal
identifier of each globally qualified relationship kind. Relationships do not
need mappings because this export does not manufacture external relationship
identities.

Generated elements and relationships carry their globally qualified native
identity as `metadata.yarramateId`. When selected claims exist, the adapter
also emits flat `status`, `owner`, `constraints`, `mode`, and `content`
metadata. These values preserve traceability and filtering context; they do
not make LikeC4 canonical. Projection title and description hints become view
properties.

This first slice emits a flat logical model and one ordinary element view. It
does not emit specifications, deployments, dynamic views, styling, imports,
or layout state, and it does not import or round-trip LikeC4.

`export-project` writes `model.likec4`, `specification.likec4`, and
`likec4.config.json` into a project directory, plus a versioned
`yarramate.generated.json` marker. A matching marker permits deterministic
regeneration of only those three declared files and preserves unrelated
files. Unmarked, malformed, or differently owned directories are refused.
The marker's normative schema is
`schema/yarramate-likec4-generated-project.schema.json`.

One project per projection avoids LikeC4's multi-file merge turning separate
exports into duplicate elements and views. The lower-level `export` command
still writes model source to stdout for harnesses that manage their own
project and specification.
