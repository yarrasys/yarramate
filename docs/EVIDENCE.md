# Evidence overlays

Evidence overlays evaluate existing native architecture subjects and claims
without changing canonical documents or graph v2. Their normative structure is
`schema/yarramate-evidence.schema.json`.

```yaml
format: yarramate/evidence/v1
id: repository-observation
version: "1.0"
provider: repository-audit
observations:
  - subject: yarramate-engine#compiler
    result: confirmed
    evidence:
      uri: repo:src/compiler.ts
  - claim: yarramate-repository#compiler-source-realizes-compiler
    result: contradicted
    evidence:
      uri: repo:src/compiler.ts
      message: Expected implementation marker was not found
```

Each observation targets exactly one globally qualified graph subject or
stable claim ID. It has one controlled result:

- `confirmed` — the provider observed evidence supporting the target;
- `contradicted` — the provider observed evidence conflicting with the target;
- `unknown` — the provider cannot determine a result;
- `not-observed` — the provider looked but found no relevant observation.

These results are facts reported by the named provider. A contradiction does
not by itself fail Core validation, and confirmation is not approval.

The `evidence.uri` value is opaque to YarraMate Core. Its provider owns URI
resolution and external validity. An optional non-empty message may explain
the observation; arbitrary provider metadata is not accepted.

## Evaluation

Generic evaluation checks:

- every subject target exists in graph v2;
- every claim target exists in graph v2;
- one evidence document evaluates a target at most once;
- versioned evidence document identities are unique in one workspace.

Successful evaluation produces deterministic
`yarramate/evidence-report/v1` JSON with counts and sorted observations. Its
normative structure is `schema/yarramate-evidence-report.schema.json`. The
input semantic graph is not modified.

```sh
yarramate evidence evidence/repository.yaml yarramate.workspace.yaml
```

Exit status is `0` for a valid report even when observations are contradicted,
unknown, or not observed. Status `1` means structural or reference
correctness failed and emits `yarramate/diagnostic-result/v1`; status `2`
means invocation or file access failed.

The typed API exposes `loadEvidence`, `evaluateEvidence`, and
`evaluateEvidenceWorkspace`. Evidence documents may be declared in the
optional `evidence` category of a workspace manifest, in which case
`yarramate check` validates them against the compiled graph.

## Boundary

Evidence overlays do not:

- introduce independent observed claims;
- mutate graph v2 or native documents;
- define completeness or CI failure policy;
- grant approval or governance status;
- require Graphify or another provider;
- interpret provider-specific URIs.

A later opt-in policy layer may decide how a report affects CI. Independent
observed claims would require a separate semantic contract rather than an
unstructured extension of this format.

Constraint satisfaction uses this same boundary. A provider may target a
stable claim such as
`yarramate-engine#compiler~constraint-tool-neutral`; its result is a
constraint assessment, not Core conformance. Core does not execute policy
rules, interpret missing observations, manage exceptions, or convert a result
into CI failure.

Diagnostics use `YM801` for an unknown subject, `YM802` for an unknown claim,
`YM803` for a duplicate target, and `YM804` for a duplicate evidence document.
The schemas are exported as `yarramate/schema/evidence` and
`yarramate/schema/evidence-report`.
