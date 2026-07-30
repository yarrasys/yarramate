# Testing YarraMate on building, not just reading (draft)

Status: **draft. Nothing built yet — this is a proposal to argue with.**

## The problem in one paragraph

Our benchmark gives agents tasks on finished, famous open-source projects:
miniflux, fastify, httpie, uptime-kuma. Most tasks ask the agent to explain
how something works. But the answer is sitting right there in the code, and
the agent can read it — so a YarraMate model has nothing to add. That is why
the sweep found no clear difference between "with model" and "without model".
We tested the case where the model is least useful.

## The idea

Test the case we have actually seen work: **building something that does not
exist yet.** When you are building, there is no code to read. The design only
exists as intent. That is where a shared, checked model should earn its keep.

## How it would work

Take a feature that miniflux (say) really did build, over several commits.

1. Rewind the repo to **halfway through** that feature — some of it exists, the
   rest does not.
2. Ask an agent to finish it.
3. Score by comparing what the agent built against **what miniflux actually
   shipped**.

The last point matters: the right answer comes from the real project, not from
our opinion of good architecture.

## The comparison

Three agents, same half-finished repo, same goal:

| | What it gets |
| --- | --- |
| **A** | the goal written as a normal design document |
| **B** | the goal as a YarraMate model, plus the CLI |
| **C** | a YarraMate model with deliberate lies in it |

**Why A gets a design doc rather than nothing:** if we gave A nothing, B would
win automatically and the result would prove nothing. Teams write design docs
today — that is the real thing we are competing with. So the question becomes
"is a checked model better than a design doc?", which we might genuinely lose.

To keep that fair, the design document is written *from* the model, by someone
not running the test, and both are published so anyone can check we did not
hand A a deliberately bad brief.

## What we would measure

All of it mechanical — no judging whether the architecture is tasteful:

- **Did they build what was asked?** How much of the real feature's structure
  (files, functions, connections) came out right.
- **Did they use the right names and boundaries?** This is the one I expect to
  matter most. Agent A has to *invent* names for the parts that do not exist
  yet; agent B is told them. Mismatched names are exactly what breaks when a
  second person picks up your work.
- **Do repeat runs agree with each other?** Run each setup a few times. If the
  model keeps different sessions building the same thing, that is the real
  team-scale benefit.
- **How much effort?** Turns, tokens, cost, and whether the project's own tests
  still pass.
- **Did the model survive?** For B and C: does `check` still pass and
  `reconcile` still come back clean afterwards.

## What we expect (written down now, before any results)

- **H4** — B beats A. A checked model beats a design document.
- **H5** — B's repeat runs agree with each other more than A's.
- **H6** — C does worse than A. A lying model is worse than no model. This is
  worth retesting because the old sweep could not really test it: the finished
  code was there to expose the lie. Here the unbuilt half has no code to
  contradict anything, so a lie should do real damage.

## What could go wrong with this test

- **The agent may already know the answer.** These are famous projects, so an
  agent might finish the feature from memory rather than from either the model
  or the doc. Warning sign: if agent A scores near-perfectly on naming, that
  means memorisation, not a real result. Use the most recent features we can,
  and say so plainly in the write-up.
- **We choose what "correct" means.** Whoever writes the checklist of expected
  files and functions has some latitude. Derive it from the real commit, and
  have a second person check it before freezing.
- **One project is not evidence.** yarradev.ai went smoothly and that is what
  prompted this — but it is a single project, built by the tool's own author,
  so "smooth" partly measures knowing the tool well. This test exists because
  that anecdote is not enough.
- **Small numbers.** Same as before: report ranges, never single numbers.
- **A rewind is not a real handover.** No meetings, no tacit knowledge. This
  measures the document, not the human situation.

## Decisions I need from you

1. **Is "checked model vs design document" the comparison you want?** It is
   honest and losable. The alternative — model vs nothing — would look better
   and mean less.
2. **Real features, or ones we invent?** Real features give us a genuine right
   answer but risk the agent remembering them. Invented ones avoid that but
   make our taste the right answer.
3. **Before or after re-running the old sweep?** My view: this first. Re-running
   the old suite buys a tighter number on a question that does not sell the
   product.

## If it works, and if it does not

If B beats A, the pitch becomes provable: declared intent as a checked artifact
keeps separate agents and sessions building the same system.

If it does not, the honest answer is that YarraMate's real value is the
mechanical half — catching invalid models and detecting drift in CI — and we
should say that and stop implying better agent output.
