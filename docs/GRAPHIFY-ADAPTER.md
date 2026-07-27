# Graphify evidence adapter

The optional Graphify adapter turns explicitly mapped Graphify nodes into a
standard YarraMate evidence overlay. It reads Graphify's generated
`graphify-out/graph.json`; YarraMate Core does not depend on Graphify.

## Explicit mapping

```yaml
format: yarramate/adapter-mapping/v1
id: repository-graphify
version: "1.0"
adapter: graphify
mappings:
  - native: delivery-platform#delivery-api
    external: src_delivery_api
    type: concept
```

The native identity is a globally qualified YarraMate subject. The external
identity is an opaque Graphify node ID. The adapter does not infer this
correspondence from labels, paths, communities, or similarity.

The initial adapter deliberately supports concept subjects only. Graphify
nodes do not provide a stable edge identity that could safely evaluate a
native relationship subject.

## Observation

```sh
yarramate-graphify observe \
  graphify-out/graph.json \
  .yarramate/integrations/graphify/subject-mapping.yaml \
  .yarramate/workspace.yaml \
  --id repository-graphify \
  --version 1.0 \
  > .yarramate/evidence/graphify.yaml
```

JSON is valid YAML, so the generated file can be declared by the workspace's
ordinary `evidence` pattern. A mapped Graphify node produces `confirmed`; an
absent node produces `not-observed`. Evidence URIs use the opaque
`graphify:<node-id>` scheme.

Run ordinary Core commands afterward:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate reconcile .yarramate/workspace.yaml
```

## Boundary

The adapter does not:

- execute Graphify extraction;
- create native concepts or relationships;
- infer architectural intent from Graphify structure;
- map communities or labels by heuristic;
- automatically edit an existing evidence overlay;
- convert a missing node into a Core validation error.

Graphify remains responsible for extraction and its graph contract. Git review
remains responsible for accepting the mapping and any resulting architecture
proposal.
