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
