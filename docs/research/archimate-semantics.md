# ArchiMate semantics for a YarraMate profile

Research date: 2026-07-27

## Executive conclusion

YarraMate can reproduce most of the *semantic shape* of the ArchiMate modeling
language in LikeC4: a typed concept vocabulary, a constrained relationship
algebra, viewpoint definitions, and computed validation. It should not present
itself as an ArchiMate implementation, an ArchiMate-compatible product, or a
conformant/certified tool without legal review and the applicable permission,
license, and certification.

The safest implementation is an independently named, open-source language
profile whose documentation says that it is **inspired by enterprise
architecture concepts** and provides an optional, separately documented
mapping to the ArchiMate language. Do not copy the specification's prose,
figures, reference cards, icons, color scheme, or relationship matrix.

## Semantic inventory

The Open Group describes four domains: Motivation, Strategy, Core, and
Implementation & Migration. Core has Business, Application, and Technology
layers; physical concepts extend the Technology layer. This differs slightly
from the convenient implementation grouping below. The Open Group community's
officially hosted introduction confirms the four domains and their purposes:
Motivation captures reasons for design/change, Strategy captures direction and
value creation, Core describes the solution, and Implementation & Migration
describes programs/projects and migration planning.

Sources:
[ArchiMate 101 — language structure](https://archimate-community.pages.opengroup.org/workgroups/archimate-101/#_language_structure),
[The Open Group certification overview](https://www.opengroup.org/certifications/archimate).

### Element kinds to implement

Use these as the target semantic coverage inventory. The names are concise
identifiers, not copied definitions.

| Group | Concepts |
| --- | --- |
| Motivation | Stakeholder, Driver, Assessment, Goal, Outcome, Principle, Requirement, Constraint, Meaning, Value |
| Strategy | Resource, Capability, Value Stream, Course of Action |
| Business — active structure | Business Actor, Business Role, Business Collaboration, Business Interface |
| Business — behavior | Business Process, Business Function, Business Interaction, Business Event, Business Service |
| Business — passive/composite | Business Object, Contract, Representation, Product |
| Application — active structure | Application Component, Application Collaboration, Application Interface |
| Application — behavior | Application Function, Application Interaction, Application Process, Application Event, Application Service |
| Application — passive structure | Data Object |
| Technology — active structure | Node, Device, System Software, Technology Collaboration, Technology Interface, Path, Communication Network |
| Technology — behavior | Technology Function, Technology Process, Technology Interaction, Technology Event, Technology Service |
| Technology — passive structure | Artifact |
| Physical | Equipment, Facility, Distribution Network, Material |
| Implementation & Migration | Work Package, Deliverable, Implementation Event, Plateau, Gap |
| Cross-domain/composite | Grouping, Location |

The hosted community introduction independently confirms the language's
active-structure/behavior/passive-structure split, the distinction between
Service, Process, and Function, and representative layer-specific concepts
including Business Actor/Object, Application Component/Data Object, System
Software, Device, Artifact, and Equipment:
[generic metamodel and core layers](https://archimate-community.pages.opengroup.org/workgroups/archimate-101/#_archimate_core_language).

### LikeC4 representation

Implement one LikeC4 `element` kind per concept and attach controlled metadata
that exposes the semantic coordinates:

```likec4
element applicationComponent {
  metadata {
    domain 'core'
    layer 'application'
    aspect 'active-structure'
    semanticId 'application-component'
  }
}
```

Treat `Grouping` as a semantic element, not as LikeC4 source nesting. Treat
`Location` as a semantic element too. LikeC4 nesting gives lexical identity,
ownership, and rendering containment; it is not automatically Composition,
Aggregation, Assignment, or Realization.

## Relationship algebra

### Relationship kinds

Implement the eleven relationship types in four categories:

| Category | Relationships |
| --- | --- |
| Structural | Composition, Aggregation, Assignment, Realization |
| Dependency | Serving, Access, Influence, Association |
| Dynamic | Triggering, Flow |
| Other | Specialization |

Also model `And Junction` and `Or Junction` as relationship connectors. They are
not ordinary domain elements. LikeC4 may require project-owned pseudo-elements
for them, but validators should restrict them to joining relationships of the
same type and direction.

The official community introduction supplies the core semantics needed for an
implementation:

- Composition expresses decomposition; selected relationships may be rendered
  as nesting.
- Assignment links active structure to behavior.
- Realization links a more concrete concept to a more abstract result (for
  example internal behavior to an externally visible service).
- Flow transfers information, goods, money, or other material.
- Triggering expresses temporal or causal precedence.
- Serving expresses that functionality is provided to another concept.
- Access is directed from behavior/active structure to passive structure and
  carries read/write-like access semantics.

Source:
[ArchiMate 101 — generic metamodel](https://archimate-community.pages.opengroup.org/workgroups/archimate-101/#_the_generic_metamodel_and_the_system_metaphor).

### Direction and relationship attributes

YarraMate should preserve:

- semantic source and target independently of arrow rendering;
- Access mode (`read`, `write`, `read-write`, `unspecified`);
- Influence strength as optional free text or a controlled value;
- Flow label/content;
- explicit versus derived status;
- derivation provenance (`derivedFrom` relationship IDs);
- relationship-to-relationship endpoints, which the exchange format supports
  through references, even if LikeC4 needs an internal proxy representation.

### Constraints

The language is not a free graph: validity depends on the source kind, target
kind, and relationship kind. The official community guide explicitly says the
metamodel determines which relationships are valid between each pair of
elements. The Open Group community issue tracker also demonstrates that these
constraints are exact enough for one interface type to admit an Assignment
while another does not:
[metamodel rule](https://archimate-community.pages.opengroup.org/workgroups/archimate-101/#_model_and_metamodel),
[constraint example](https://community.opengroup.org/archimate-community/home/-/issues/77).

Implementation consequences:

1. Store a versioned, machine-readable `allowedRelationships` matrix.
2. Validate every explicit relationship against it.
3. Keep this matrix independent of view/rendering rules.
4. Do not infer a semantic relationship merely from visual nesting.
5. Permit Association only where the profile deliberately allows it; do not
   use it as an escape hatch around a failed constraint.
6. Add tests for every allowed matrix cell and representative forbidden cells.

The official exchange XSD validates packaging and concept type names, not the
full relationship semantics. The Open Group says exchange data is intended for
an “ArchiMate aware” tool and rules out standalone semantic inference from the
exchange file. Therefore YarraMate needs its own semantic validator:
[Model Exchange FAQ](https://www.opengroup.org/open-group-archimate-model-exchange-file-format).

## Relationship derivation

Derivation is transitive semantic inference across relationship paths. It lets
a model expose a higher-level relationship implied by lower-level detail. This
must not be implemented as unrestricted graph reachability.

Recommended design:

```text
explicit relationship
  -> validate endpoint/kind matrix
  -> normalize relationship strength/category
  -> apply versioned pairwise derivation table
  -> emit derived relationship with provenance
  -> repeat to fixed point with cycle/duplicate protection
```

Implementation rules:

- Use an ordered relationship-strength table; when composing two paths, only
  emit the relationship permitted by the official derivation rule represented
  in the profile.
- Keep derived relationships separate from authored relationships.
- Record all supporting relationship IDs.
- Never serialize a derived relationship as authored unless the user accepts
  it explicitly.
- Recompute after every relevant edit.
- Support suppression/explanation because dense models can produce many
  technically valid but unhelpful inferences.
- Version the derivation table with the semantic profile.

The relationship matrix and derivation table are the most copyright-sensitive
parts of a faithful port. Do not transcribe them from the licensed
specification into a public repository without written confirmation that this
use is permitted. An independently developed matrix can be checked using
public examples and interoperability tests, but legal review remains advisable.

## Viewpoints

A viewpoint is a reusable set of conventions for producing views that address
known stakeholder concerns. A view is one representation made according to a
viewpoint; it may be a diagram, catalog, matrix, or another visualization.
Viewpoint definition is multidimensional:

- stakeholders and concerns;
- purpose: informing, deciding, or designing;
- content/detail: overview, coherence, or details;
- representation;
- concept restrictions and modeling conventions.

Source:
[ArchiMate 101 — importance of viewpoints](https://archimate-community.pages.opengroup.org/workgroups/archimate-101/#_importance_of_viewpoints).

YarraMate should make viewpoints data, not hard-coded view names:

```yaml
id: capability-map
stakeholders: [executive, enterprise-architect]
concerns: [strategic-fit, investment-priority]
purpose: deciding
detail: overview
representation: diagram
allowedKinds: [capability]
allowedRelationships: [composition, aggregation, specialization]
```

Seed a viewpoint library only after the semantic core works. Candidate families
cover organization, business processes/cooperation/products, application
structure/behavior/cooperation/usage, technology/infrastructure/deployment,
layering, physical structure, stakeholder/goals/requirements/motivation,
strategy/capability/value stream/outcome/resource mapping, project/migration,
implementation/deployment, and migration analysis. Treat these as templates,
not mandatory diagram types: the official community guidance says tools should
not rigidly enforce concept restrictions because a legitimate exceptional
concept may be needed.

## Exchange compatibility

The official exchange standard separates model, view, and diagram schemas. It
is intended for tool-to-tool transport, not as the persistent model store.
Most ancillary information is optional, including metadata and organizations.
This suggests:

- Keep YarraMate's canonical form in LikeC4 plus generated semantic indexes.
- Build exchange import/export as adapters.
- Map stable YarraMate IDs to exchange identifiers.
- Preserve unsupported properties in a namespace rather than discarding them.
- Validate generated XML against the official XSD, then validate semantics
  separately.
- Do not claim that XSD-valid output proves language conformance.

Sources:
[exchange format resources](https://www.opengroup.org/xsd/archimate/),
[exchange FAQ](https://www.opengroup.org/open-group-archimate-model-exchange-file-format).

## Licensing, naming, and trademark boundary

This is an engineering risk summary, not legal advice.

1. **ArchiMate is a registered trademark.** The Open Group requires it to be
   used as an adjective with a generic noun and with attribution. Its
   guidelines prohibit using its marks (or variations, takeoffs, or
   abbreviations) as a product, service, company, or domain name without
   permission. “YarraMate” should receive legal review because its `-Mate`
   ending may be viewed as a takeoff despite being independently branded.
   Source: [The Open Group trademark guidelines](https://www.opengroup.org/trademarks).

2. **Do not imply endorsement, certification, or conformance.** The public
   register distinguishes certified tools and asks that unsupported claims be
   reported. Use wording such as “independent enterprise-architecture semantic
   profile” until certification/legal questions are resolved.
   Source: [certified tools register](https://training.opengroup.org/tool-register/archimate/).

3. **The specification is licensed documentation, not evidently open-source
   content.** The current 3.2 download paths offer a time-limited evaluation
   license, a non-commercial license, member terms, and a commercial license.
   The non-commercial page expressly includes products or tools for commercial
   gain within commercial use. An Apache/MIT-licensed implementation does not
   automatically grant permission to reproduce specification content.
   Sources:
   [licensed downloads](https://www.opengroup.org/archimate-licensed-downloads),
   [non-commercial license overview](https://www.opengroup.org/archimate-32-non-commercial-license),
   [commercial license overview](https://www.opengroup.org/commercial-license).

4. **The official community introduction is CC BY-SA 4.0**, but that license
   applies to the community-authored book, not automatically to the
   specification. If YarraMate adapts its prose or figures, attribution and
   ShareAlike obligations apply. Prefer original prose and no copied figures.
   Source:
   [ArchiMate 101 license and trademarks](https://archimate-community.pages.opengroup.org/workgroups/archimate-101/#_license_and_trademarks).

5. **The exchange schema is the interoperability boundary.** Linking to and
   validating against official schema resources is lower-risk than embedding
   licensed explanatory content. Before vendoring XSD files, icons, matrices,
   or examples, inspect their specific notices and obtain counsel.

## Recommended implementation order

1. Establish independent naming and a legal/IP decision record.
2. Define the 61 element kinds with semantic coordinates.
3. Define the 11 relationship kinds plus junctions and attributes.
4. Implement explicit relationship validation from a versioned matrix.
5. Add semantic lint rules (assignment, access direction, realization chains,
   cross-layer consistency).
6. Implement derivation with provenance and suppression.
7. Add viewpoint-as-data and generate LikeC4 views from it.
8. Add Model Exchange import/export as an optional adapter.
9. Only then evaluate an official license/certification path and claims of
   compatibility.

## Primary-source caveat

The full ArchiMate 3.2 online specification currently redirects to an
authenticated Open Group account and is governed by its download license. This
report therefore uses only public Open Group pages, the official hosted
community guide, the official exchange resources, and the Open Group community
tracker. Exact definitions and the complete normative relationship/derivation
matrices must be verified under the applicable specification license before
YarraMate declares semantic parity.
