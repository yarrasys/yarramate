# Core vocabulary reference

`yarramate/core@0.1` reuses ArchiMate's element and relationship taxonomy on
purpose (ADR 0087): the 62 concept kinds below, across the 8 ArchiMate
layers, plus the 11 relationship kinds that connect them. ArchiMate itself is
only a rendering mode (`presentation.notation: 'archimate'`); this vocabulary
*is* native YarraMate, checked the same way regardless of how a projection
chooses to draw it. Full field lists live in
`schema/yarramate-document.schema.json`; kinds are declared in
`src/profile.ts`. Profiles (see [Profiles](PROFILES.md)) may add new kind
*names* as specializations of these, but cannot add new fields — every
concept and relationship, core or extended, has the shape below.

An interactive, searchable version of this reference (color-coded by layer,
filterable) is also available; ask in the team channel for the current link,
since it is not committed to the repository.

## Shape

Every concept is an entry under a document's `concepts:`:

```yaml
- id: kebab-id             # required
  kind: applicationComponent   # required — one of the kind ids below
  name: Human-readable name    # required
  description: One line of prose   # optional
  status: planned | current | retired   # optional
  owner: some-other-id             # optional — reference to another concept
  aka: [Legacy name]               # optional
  constraints:                     # optional
    - id: authn
      ref: policy-doc#constraint-id
```

Every relationship is an entry under `relationships:`:

```yaml
- id: kebab-id        # required
  kind: flow           # required — one of the 11 kinds below
  from: source-id       # required
  to: target-id           # required
  mode: read | write | read-write   # access only
  content: What moves across the hop   # flow only
  status: planned | current | retired   # optional
```

## Concept kinds

### Motivation

Why the architecture exists: the stakeholders, drivers, goals, and
requirements that shape it.

- **`stakeholder`** — Stakeholder *(anti-rigid)*
  The role of an individual, team, or organization with an interest in the
  outcome of the architecture.
  ```yaml
  - id: cfo
    kind: stakeholder
    name: Chief Financial Officer
  ```
- **`driver`** — Driver
  An external or internal condition that motivates an organization to
  formulate its goals.
  ```yaml
  - id: cost-pressure
    kind: driver
    name: Rising infrastructure cost
  ```
- **`assessment`** — Assessment
  The result of analyzing the state of affairs regarding some driver.
  ```yaml
  - id: legacy-risk
    kind: assessment
    name: Legacy platform end-of-life risk
  ```
- **`goal`** — Goal
  A high-level statement of intent, direction, or desired end state.
  ```yaml
  - id: reliable-delivery
    kind: goal
    name: Reliable delivery
  ```
- **`outcome`** — Outcome
  An end result that has actually been achieved.
  ```yaml
  - id: fewer-incidents
    kind: outcome
    name: 40% fewer P1 incidents
  ```
- **`principle`** — Principle
  A qualitative statement of intent that architecture decisions should
  satisfy.
  ```yaml
  - id: api-first
    kind: principle
    name: API-first integration
  ```
- **`requirement`** — Requirement
  A statement of need that must be realized by a system.
  ```yaml
  - id: pci-scope
    kind: requirement
    name: Card data must stay out of PCI scope
  ```
- **`constraint`** — Constraint
  A limitation on how the architecture may be designed or implemented.
  ```yaml
  - id: australia-only
    kind: constraint
    name: Australian data residency
  ```
- **`meaning`** — Meaning
  The knowledge or interpretation carried by a business object in its
  context.
  ```yaml
  - id: churn-defn
    kind: meaning
    name: '"Churn" means no purchase in 90 days'
  ```
- **`value`** — Value
  The relative worth or importance of something to a stakeholder.
  ```yaml
  - id: trust
    kind: value
    name: Customer trust
  ```

### Strategy

How capabilities and resources are configured and directed to pursue the
motivation layer.

- **`resource`** — Resource
  An asset owned or controlled by an individual or organization.
  ```yaml
  - id: platform-team
    kind: resource
    name: Platform engineering team
  ```
- **`capability`** — Capability
  An ability that an active structure element, such as an organization,
  possesses.
  ```yaml
  - id: order-mgmt
    kind: capability
    name: Order management
  ```
- **`valueStream`** — Value stream
  A sequence of activities that creates an overall result for a customer or
  stakeholder.
  ```yaml
  - id: order-to-cash
    kind: valueStream
    name: Order to cash
  ```
- **`courseOfAction`** — Course of action
  An approach or plan for configuring capabilities and resources to achieve a
  goal.
  ```yaml
  - id: modular-monolith
    kind: courseOfAction
    name: Modular monolith option
  ```

### Business

Products, services, processes, and the actors and roles that carry them out.

- **`businessActor`** — Business actor
  A business entity capable of performing behavior, e.g. a person or
  organizational unit.
  ```yaml
  - id: sales-rep
    kind: businessActor
    name: Sales Representative
  ```
- **`businessRole`** — Business role *(anti-rigid)*
  The responsibility for performing specific behavior, assigned to an actor.
  ```yaml
  - id: approver
    kind: businessRole
    name: Approver
  ```
- **`businessCollaboration`** — Business collaboration *(anti-rigid)*
  An aggregate of two or more business roles that work together to perform
  collective behavior.
  ```yaml
  - id: claims-review-board
    kind: businessCollaboration
    name: Claims review board
  ```
- **`businessInterface`** — Business interface
  A point of access where a business service is made available to the
  environment.
  ```yaml
  - id: contact-centre-phone
    kind: businessInterface
    name: Contact centre phone line
  ```
- **`businessProcess`** — Business process
  A sequence of business behaviors that achieves a specific outcome.
  ```yaml
  - id: process-claim
    kind: businessProcess
    name: Process insurance claim
  ```
- **`businessFunction`** — Business function
  A collection of business behavior grouped by required skills, resources, or
  knowledge.
  ```yaml
  - id: claims-handling
    kind: businessFunction
    name: Claims handling
  ```
- **`businessInteraction`** — Business interaction
  A unit of collective business behavior performed by two or more roles or
  actors.
  ```yaml
  - id: claim-intake-call
    kind: businessInteraction
    name: Claim intake call
  ```
- **`businessEvent`** — Business event
  A business behavior element that denotes an organizational state change.
  ```yaml
  - id: claim-lodged
    kind: businessEvent
    name: Claim lodged
  ```
- **`businessService`** — Business service
  An explicitly defined behavior that a role or actor exposes to its
  environment.
  ```yaml
  - id: claims-service
    kind: businessService
    name: Claims lodgement service
  ```
- **`businessObject`** — Business object
  A concept used within a particular business domain.
  ```yaml
  - id: claim-file
    kind: businessObject
    name: Claim file
  ```
- **`contract`** — Contract
  A formal or informal agreement specifying rights and obligations associated
  with a product.
  ```yaml
  - id: document-record
    kind: contract
    name: Document record
  ```
- **`representation`** — Representation
  A perceptible form taken by the information carried by a business object.
  ```yaml
  - id: claim-form-pdf
    kind: representation
    name: Claim form PDF
  ```
- **`product`** — Product
  A coherent collection of services and/or objects, with a contract, offered
  to customers.
  ```yaml
  - id: comprehensive-cover
    kind: product
    name: Comprehensive cover policy
  ```

### Application

Software components, their interfaces and processes, and the data they act
on.

- **`applicationComponent`** — Application component
  A modular, deployable, replaceable part of a software system that
  encapsulates behavior and data.
  ```yaml
  - id: contact-exp-api
    kind: applicationComponent
    name: Contact Experience API
  ```
- **`applicationCollaboration`** — Application collaboration *(anti-rigid)*
  An aggregate of two or more application components working together on
  collective behavior.
  ```yaml
  - id: checkout-collab
    kind: applicationCollaboration
    name: Checkout collaboration
  ```
- **`applicationInterface`** — Application interface
  A point of access where application services are made available to a user,
  another component, or a node. This is where API contract details (a
  method, a path, a request/response shape) attach in practice — see
  [Interface contract fidelity](#interface-contract-fidelity) below.
  ```yaml
  - id: contact-api-rest
    kind: applicationInterface
    name: Contact API (REST)
  ```
- **`applicationFunction`** — Application function
  Automated behavior performed by a component, grouped by required
  application resources.
  ```yaml
  - id: pricing-calc
    kind: applicationFunction
    name: Pricing calculation
  ```
- **`applicationInteraction`** — Application interaction
  A unit of collective application behavior performed by two or more
  components.
  ```yaml
  - id: exp-prc-handoff
    kind: applicationInteraction
    name: Experience-to-process handoff
  ```
- **`applicationProcess`** — Application process
  A sequence of application behaviors that achieves a specific outcome.
  ```yaml
  - id: accept-contact-update
    kind: applicationProcess
    name: Accept contact update
  ```
- **`applicationEvent`** — Application event
  An application behavior element that denotes a state change in software.
  ```yaml
  - id: order-placed
    kind: applicationEvent
    name: Order placed event
  ```
- **`applicationService`** — Application service
  An explicitly defined, exposed application behavior.
  ```yaml
  - id: order-service
    kind: applicationService
    name: Order management
  ```
- **`dataObject`** — Data object
  Data structured for automated processing.
  ```yaml
  - id: contact-record
    kind: dataObject
    name: Contact record
  ```

### Technology

The infrastructure — nodes, networks, and system software — that runs the
application layer.

- **`node`** — Node
  A computational or physical resource that hosts, manipulates, or interacts
  with other resources.
  ```yaml
  - id: cloudhub2
    kind: node
    name: MuleSoft CloudHub 2.0
  ```
- **`device`** — Device
  A physical IT resource with computing capabilities.
  ```yaml
  - id: pos-terminal
    kind: device
    name: Point-of-sale terminal
  ```
- **`systemSoftware`** — System software
  Software providing the environment other software runs in, e.g. an OS or
  database engine.
  ```yaml
  - id: postgres
    kind: systemSoftware
    name: PostgreSQL 16
  ```
- **`technologyCollaboration`** — Technology collaboration *(anti-rigid)*
  An aggregate of two or more technology elements working together on
  collective behavior.
  ```yaml
  - id: ha-cluster
    kind: technologyCollaboration
    name: High-availability cluster
  ```
- **`technologyInterface`** — Technology interface
  A point of access where technology services are made available.
  ```yaml
  - id: jdbc-endpoint
    kind: technologyInterface
    name: JDBC endpoint
  ```
- **`path`** — Path
  A link between nodes through which data or materials can be exchanged.
  ```yaml
  - id: vpc-peering
    kind: path
    name: VPC peering link
  ```
- **`communicationNetwork`** — Communication network
  A set of structures connecting nodes for transmission, routing, and
  reception.
  ```yaml
  - id: corp-mpls
    kind: communicationNetwork
    name: Corporate MPLS backbone
  ```
- **`technologyFunction`** — Technology function
  Automated technology-layer behavior grouped by required skills or
  resources.
  ```yaml
  - id: tls-termination
    kind: technologyFunction
    name: TLS termination
  ```
- **`technologyProcess`** — Technology process
  A sequence of technology behaviors that achieves a specific outcome.
  ```yaml
  - id: nightly-backup
    kind: technologyProcess
    name: Nightly database backup
  ```
- **`technologyInteraction`** — Technology interaction
  A unit of collective technology behavior performed by two or more
  elements.
  ```yaml
  - id: cluster-failover
    kind: technologyInteraction
    name: Cluster failover handshake
  ```
- **`technologyEvent`** — Technology event
  A technology behavior element that denotes a state change in
  infrastructure.
  ```yaml
  - id: disk-threshold
    kind: technologyEvent
    name: Disk usage threshold breached
  ```
- **`technologyService`** — Technology service
  An explicitly defined technology behavior that a node exposes to its
  environment.
  ```yaml
  - id: object-storage
    kind: technologyService
    name: Object storage service
  ```
- **`artifact`** — Artifact
  A piece of data used or produced in development, deployment, or operation,
  such as a file.
  ```yaml
  - id: contact-api-jar
    kind: artifact
    name: contact-api-1.4.0.jar
  ```

### Physical

Tangible resources outside IT: equipment, facilities, and the networks that
move material.

- **`equipment`** — Equipment
  A physical resource with functionality needed to operate in the physical
  world.
  ```yaml
  - id: barcode-scanner
    kind: equipment
    name: Warehouse barcode scanner
  ```
- **`facility`** — Facility
  A physical structure or environment purpose-built to perform a specific
  function.
  ```yaml
  - id: fulfilment-centre
    kind: facility
    name: Melbourne fulfilment centre
  ```
- **`distributionNetwork`** — Distribution network
  A physical network used to transport materials or energy.
  ```yaml
  - id: courier-network
    kind: distributionNetwork
    name: Last-mile courier network
  ```
- **`material`** — Material
  Tangible physical matter or energy.
  ```yaml
  - id: packaging-stock
    kind: material
    name: Packaging stock
  ```

### Implementation & migration

The work, deliverables, and transitional states that carry an architecture
from plateau to plateau.

- **`workPackage`** — Work package
  A series of actions designed to achieve specific results within a set
  time, without introducing new architectural change.
  ```yaml
  - id: migrate-to-ch2
    kind: workPackage
    name: Migrate APIs to CloudHub 2.0
  ```
- **`implementationEvent`** — Implementation event
  A behavior element that denotes a state change related to implementation
  or migration.
  ```yaml
  - id: ch1-decommissioned
    kind: implementationEvent
    name: CloudHub 1.0 decommissioned
  ```
- **`deliverable`** — Deliverable
  A precisely defined result produced by a work package.
  ```yaml
  - id: cutover-runbook
    kind: deliverable
    name: Cutover runbook
  ```
- **`plateau`** — Plateau
  A relatively stable state of the architecture that exists for a limited
  period.
  ```yaml
  - id: ch1-baseline
    kind: plateau
    name: CloudHub 1.0 baseline
  ```
- **`gap`** — Gap
  A statement of difference between two plateaus.
  ```yaml
  - id: observability-gap
    kind: gap
    name: Missing distributed tracing
  ```

### Composite

Structural elements used to group or route other concepts, not tied to any
one layer.

- **`grouping`** — Grouping
  A set of elements sharing a common trait, aggregated for presentation or
  organization.
  ```yaml
  - id: contact-domain
    kind: grouping
    name: Contact domain
  ```
- **`location`** — Location
  A conceptual or physical place with a geographic or logical position.
  ```yaml
  - id: apac-region
    kind: location
    name: APAC region
  ```
- **`andJunction`** — AND junction
  A logical AND: every incoming or outgoing relationship must hold together.
  ```yaml
  - id: fanout-and
    kind: andJunction
    name: AND junction
  ```
- **`orJunction`** — OR junction
  A logical OR: any one incoming or outgoing relationship is sufficient.
  ```yaml
  - id: fallback-or
    kind: orJunction
    name: OR junction
  ```

## Relationship kinds

The 11 ways two concepts — from any layer — can be connected. A
relationship's `kind` is what carries meaning; four kinds also constrain
which aspect an endpoint must be, and the compiler names a repair when that
constraint is violated.

- **`composition`** — Strong whole-part structure: the part cannot exist
  without the whole.
  ```yaml
  - id: monolith-contains-api
    kind: composition
    from: modular-monolith
    to: delivery-api
  ```
- **`aggregation`** — Weak whole-part structure: the part can exist
  independently of the whole.
  ```yaml
  - id: cover-aggregates-claims-service
    kind: aggregation
    from: comprehensive-cover
    to: claims-service
  ```
- **`assignment`** — Allocate an active structure element to behavior or
  responsibility. `from` must be active-structure (an actor, component, or
  node); otherwise the compiler suggests `association`.
  ```yaml
  - id: exp-assigned-accept
    kind: assignment
    from: contact-exp-api
    to: accept-contact-update
  ```
- **`realization`** — Fulfil a more abstract concept.
  ```yaml
  - id: api-realizes-service
    kind: realization
    from: delivery-api
    to: delivery-service
  ```
- **`serving`** — Make behavior or an interface available to another
  element.
  ```yaml
  - id: interface-serves-sales-rep
    kind: serving
    from: contact-exp-api-interface
    to: sales-rep
  ```
- **`access`** — Read, write, create, or use passive structure. `to` must
  be passive-structure (a business object, data object, or artifact);
  otherwise the compiler suggests `association`.
  ```yaml
  - id: update-writes-record
    kind: access
    from: update-salesforce-contact
    to: contact-record
    mode: write
  ```
- **`influence`** — Affect a motivation concept, positively or negatively.
  `to` must be a motivation concept (a goal, requirement, or principle);
  otherwise the compiler suggests `association`.
  ```yaml
  - id: cost-pressure-influences-goal
    kind: influence
    from: cost-pressure
    to: reliable-delivery
  ```
- **`association`** — A relevant connection with no stronger meaning; the
  escape hatch when nothing else fits.
  ```yaml
  - id: microservices-associated-with-delivery
    kind: association
    from: microservices
    to: reliable-delivery
  ```
- **`triggering`** — Express temporal or causal precedence between
  behavior. Both `from` and `to` must be behavior; otherwise the compiler
  suggests `flow` between active-structure elements, or a behavior concept
  plus `assignment`.
  ```yaml
  - id: claim-lodged-triggers-process
    kind: triggering
    from: claim-lodged
    to: process-claim
  ```
- **`flow`** — Transfer information, value, goods, or material from one
  element to another.
  ```yaml
  - id: accept-flows-prc-interface
    kind: flow
    from: accept-contact-update
    to: contact-prc-api-interface
    content: Contact update request
  ```
- **`specialization`** — Express a more specific form of another concept of
  the same kind.
  ```yaml
  - id: priority-support-specializes-support
    kind: specialization
    from: priority-support
    to: claims-service
  ```

## Interface contract fidelity

`applicationInterface` is the kind that marks a real API boundary — the
`test/fixtures/journeys/contact-update/` fixture models a MuleSoft API-led
flow with one `applicationInterface` per API-led layer (Experience, Process,
System) plus one for the external Salesforce contract, and every
cross-component `flow`/`serving` relationship targets the interface, not the
internal `applicationProcess` behind it. That is the fidelity fix: a hop
between components should name the contract it crosses, not just the two
processes on either side of it.

Core has no dedicated fields for a method, a path, or a request/response
schema — a concept's shape (above) is the same for every kind, and profiles
can only add new kind *names*, never new fields (see [Conservative
extension](PROFILES.md#conservative-extension)). This is deliberate: Core
tracks architecture shape, not API schema. Contract-level fidelity on an
`applicationInterface` is expressed through the mechanisms Core already has:

- **`description`** for a short prose statement of the contract.
- **`constraints[]`** referencing a `mechanism-constraint` (protocol/style,
  e.g. "HTTPS REST" or "Salesforce REST API (sObjects)"), an
  `authentication-constraint`, and a `rate-limit-constraint` from the
  `yarramate/policy@0.1` profile (see [Profiles](PROFILES.md)) — these are
  the contract-level facts, and belong on the interface rather than the
  process behind it. Internal behavior, like retry/idempotency policy,
  stays a `reliability-constraint` on the `applicationProcess`.
- **Evidence** (`yarramate/evidence/v1`, see [Evidence](EVIDENCE.md)) with a
  `uri:` pointing at the real OpenAPI or RAML spec file, to reconcile the
  declared interface against the actual contract artifact. The precise
  schema lives in that file, not duplicated into the architecture model;
  evidence is how the two stay checked against each other.
