# YarraMate Core contract manifests

A Core contract manifest is a versioned, machine-readable declaration of one
YarraMate Core release boundary. Its normative schema is
`schema/yarramate-core-contract.schema.json`.

The repository's initial manifest is
`.yarramate/contracts/yarramate-core-0.1.yaml`. It declares:

- tool-neutral public format identities and their normative schemas;
- the exact package export for each schema;
- supported `yarramate` command families and their machine success formats;
- controlled deterministic guarantees;
- controlled exclusions that prevent the manifest being read as an
  architecture-quality or external-certification claim.

Example:

```yaml
format: yarramate/core-contract/v1
id: yarramate-core
version: "0.1"
packageManifest: package.json
formats:
  - id: yarramate/graph/v2
    schema: schema/yarramate-graph-v2.schema.json
    packageExport: ./schema/graph-v2
commands:
  - name: compile
    binary: yarramate
    machineFormat: yarramate/graph/v2
guarantees:
  - canonical-graph-serialization
exclusions:
  - architectural-quality
```

Schema and package paths resolve from the workspace root. A workspace opts in
explicitly:

```yaml
contracts:
  - contracts/*.yaml
```

`yarramate check` validates the closed manifest, uniqueness and format
references, schema-file presence, valid JSON Schema 2020-12 documents, each
schema's exact root `format.const`, exact package schema exports, readable
package JSON, and the declared binary. Diagnostics are source-located:

| Code | Meaning |
| --- | --- |
| `YMC101` | A format identity is declared more than once. |
| `YMC102` | A command family is declared more than once. |
| `YMC103` | A command names a machine format absent from the manifest. |
| `YMC201` | A declared schema file is absent. |
| `YMC202` | A package schema export is absent or points elsewhere. |
| `YMC203` | A declared command binary is absent from the package. |
| `YMC204` | The declared package manifest is absent. |
| `YMC205` | The declared package manifest is not a valid JSON object. |
| `YMC206` | A declared schema is not valid JSON. |
| `YMC207` | A declared schema does not identify the contracted format. |
| `YMC208` | A declared schema is not valid JSON Schema 2020-12. |

This is an implementation contract and release inventory. It is not a
certification, architectural score, completeness policy, compatibility claim,
or replacement for executable behavioral tests. LikeC4 formats are omitted
from the Core 0.1 manifest because they belong to the optional adapter.

The typed package exports `loadCoreContract` and `checkCoreContract`.
`checkCoreContract` accepts an implementation surface; callers may supply
parsed schema declarations through `surface.schemas` to receive the same
format-identity checks as the CLI. Omitting that optional field preserves the
presence and package-surface checks for existing callers. The manifest schema
is available as `yarramate/schema/core-contract`.
