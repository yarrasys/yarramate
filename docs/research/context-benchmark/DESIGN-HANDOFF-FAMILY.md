# Testing YarraMate on building something new (draft)

Status: **draft. Nothing built yet — this is a proposal to argue with.**

## Two deliverables, deliberately kept apart

| | Purpose | Produces |
| --- | --- | --- |
| **The demo** | show conceive → design → build on one complex app | a story |
| **The experiment** | find out whether the model actually changes outcomes | numbers |

Keeping these separate is the whole discipline of this document. "We built a
complex app with YarraMate and it went great" is a good story and bad evidence
— it is the same shape as the yarradev.ai anecdote we already agreed cannot
carry weight. The demo must never emit numbers, and the experiment must never
depend on a demo going well.

## Why building, not reading

The existing benchmark gives agents tasks on finished, famous projects. The
answers are in the code and the agent can read them, so a model has nothing to
add — which is why the sweep found no clear difference. We tested the case
where a model is least useful.

When you are building something new there is no code to read. The design exists
only as intent. That is the case worth testing.

## The problem with "build an app from a prompt"

Left as a bare prompt, the test cannot be scored:

- **There is no right answer.** Two agents produce two different, both-valid
  architectures.
- **Scope floats.** One agent builds something smaller, another something
  bigger. That difference will dwarf anything YarraMate contributes.
- **One run per condition.** Building an app twice gives two quite different
  apps, and we can only afford a handful of runs.

## The fix: build from a published spec

Use an external specification that ships its own conformance tests. The
[RealWorld](https://github.com/gothinkster/realworld) "Conduit" project is the
leading candidate: it publishes an API spec (`specs/api`) and a maintained
backend test suite implementations are expected to pass.

That gives us, for free:

- **fixed scope** — the spec says what to build, so scope stops floating;
- **objective "does it work"** — the conformance suite, which we did not write;
- **architecture left completely free** — which is the one thing we want to
  vary.

We stop being the author of the answer key. That was the weakness in every
earlier version of this design.

## What we measure — and what we deliberately do not

We do **not** score whether the architecture is good. There is no ground truth
for that, and YarraMate checks correctness rather than taste.

In a greenfield build you cannot measure "right". You *can* measure "same" and
"kept its promises" — and that is the honest match to the claim, because
coherence across sessions and people is what architecture is for.

1. **Does it pass the spec?** The external conformance suite. A gate, not a
   score: runs that fail it are excluded, not ranked.
2. **Do repeat runs converge?** Run each setup three times. Without a shared
   model, three sessions invent three different structures. With one, they
   should converge. Measured by comparing the structures produced, which needs
   no right answer.
3. **Did the builders keep the designer's promises?** Design with one agent,
   implement with others. Did the implementers honour the declared components,
   boundaries and names, or quietly violate them? Mechanically checkable
   against the model that was handed to them.
4. **Does it survive extension?** Hand each finished build to a fresh agent
   with one new requirement. Does it stay coherent, or does the second agent
   bulldoze the first one's intent?
5. **Cost.** Turns, tokens, money to reach a passing build.

Metric 3 is the one I expect to discriminate. An agent without a model has to
*invent* names and boundaries for parts that do not exist yet; an agent with
one is told them. Mismatched names are exactly what breaks when someone picks
up your work.

## The comparison

Every implementer receives **prose** — that is what ADR 0054 says the
interface is, and it removes the confound the earlier draft carried: handing
one arm YAML and another a document would have varied the format and the
guarantee at once, so a loss could blame either. Here the format is constant
and the only variable is what stands behind the words.

Each arm has a design phase and a build phase, run by separate agents:

| | Design phase | What the implementers receive |
| --- | --- | --- |
| **A** | a designer agent writes a design document from the spec | that document |
| **B** | a designer agent authors a checked YarraMate model from the spec (interrogated until the catalogue is clean) | briefs rendered from the model |
| **C** | B's model with deliberate lies injected | briefs rendered from the lying model |

**A gets a real design document, not nothing.** If A got nothing, B would win
automatically and prove nothing. A designer writing a document is what teams
do today, so it is the real competition. Both arms get the same design-phase
budget, and both artifacts — A's document and B's model plus rendered briefs
— are published so anyone can check we did not hand A a deliberately weak
designer.

An optional fourth arm hands implementers B's raw model and the CLI instead
of rendered briefs. It measures the cost of the format alone — whether agents
should ever see the YAML directly — and is worth running only if B and A
separate.

⚠️ Dependency: rendered briefs at the quality this design assumes do not
exist yet — `context` emits a digest today. The brief renderer (#88) is a
prerequisite for running this family, which is the thesis making its own
experiment honest: testing "prose backed by structure" requires the prose.

## What we expect, written down before any results

- **H4** — B beats A on promise-keeping and convergence.
- **H5** — B's three runs agree with each other more than A's three do.
- **H6** — C does worse than A. A lying model is worse than no model. Worth
  retesting because the old sweep could not test it: the finished code was
  there to expose the lie. Here the unbuilt work has no code to contradict
  anything.

## What could go wrong

- **The spec is widely implemented.** Hundreds of public Conduit
  implementations exist, so an agent may recall one. This bites the *code* more
  than the *architecture*, which is still ours to choose — but if condition A
  scores near-perfectly on naming, read that as recall, not as evidence
  against H4. Consider a spec variation, or a less-implemented spec, if this
  shows up.
- **Three runs is still small.** Report ranges, never single numbers.
- **The design document decides the result.** Covered by writing it from the
  model and publishing both; it stays the easiest way to rig this.
- **Convergence could be an artifact.** Two runs might agree because the spec
  forces one obvious structure, not because the model helped. Guard: check
  whether A's runs also converge. If they do, the spec is doing the work and
  the metric is uninformative for that task.
- **A rewind is not a handover.** No meetings, no tacit knowledge. This
  measures the artifact, not the human situation.

## The demo, stated separately

One bespoke, genuinely complex application — not the spec app — taken from
conceive through design to build, written up and recorded. Unbounded scope,
n = 1, no statistics, no comparison, no claims of measurement. Its job is to
show what the workflow feels like. Its honesty depends on being labelled a
story.

## Decisions I need from you

The comparison itself is settled by ADR 0054: prose everywhere, the guarantee
as the only variable. Remaining:

1. **Is RealWorld/Conduit complex enough**, or do you want a larger published
   spec? Conduit is bounded — good for an experiment, possibly thin for a
   headline.
2. **Is the demo a separate bespoke app**, as written here, or the same spec
   app filmed?
3. **This before re-running the old sweep?** My view: yes. Re-running the old
   suite buys a tighter number on a question that does not sell the product.
4. **Sequencing**: the brief renderer (#88) gates this family. Build it
   first, or run a pilot with hand-assembled briefs to de-risk the design
   while the renderer lands?

## If it works, and if it does not

If B beats A, the pitch becomes provable: declared intent as a checked artifact
keeps separate agents and sessions building the same system.

If it does not, the honest answer is that YarraMate's real value is the
mechanical half — catching invalid models and detecting drift in CI — and we
should say that and stop implying better agent output.
