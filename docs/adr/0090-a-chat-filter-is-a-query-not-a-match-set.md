# A chat filter is a query, not a match set

Status: accepted

`chat.response` carries an optional `appliedQuery` so a reviewer who types
"show me only the application layer" gets the canvas filtered, not just a
paragraph about it. The field has two halves - the `ProjectionQuery` the pill
displays and the `matchedIds` the canvas highlights - and the delegated agent
supplied both. That was wrong in three separate ways, and the authoring guide
in `references/visual-conversations.md` prescribed the first of them.

The guide told the child to call `yarramate_ask`, publish
`query: { subjects: seeds, relationships: 'connected' }`, and take
`matchedIds` from the ask result's `result.subjects`. But `ask` applies a
neighbour cap of 12 before it returns (`ask-command.ts:338`, applied at
`:1148` and `:1364`), and the published query says nothing about a cap. The
pill therefore advertised an uncapped query while the canvas highlighted a
capped subset. Re-running that same query in the filter panel lit up a
strictly larger set. One query, two answers, both from the same session.

Second, the recipe only reached seed focus. `ProjectionQuery` also carries
`layers`, `kinds`, `statuses`, `excludeStatuses`, `owners`, `constraints`,
`relationshipKinds`, and `documents`; the panel evaluates all of them. The
agent could compute `matchedIds` for none of them, because `ask` accepts free
text, a subject id, or a saved projection path - never an ad-hoc query object.
"Show me only the application layer" was unanswerable as a filter, not because
the query was unrepresentable, but because the agent had no way to evaluate
one.

Third, nothing checked the answer. `parseVisualResponse` confirms `matchedIds`
is an array of unique strings and stops there. An agent could highlight ids
that name nothing in the graph and the runtime would journal it.

Decided: the agent states the query and the runtime evaluates it. On accepting
a `chat.response` carrying `appliedQuery`, the session server calls
`filterMatchedIds` - the same function, over the same `compiledWorkspace`,
that a `filter.query` event from the panel is evaluated through - and fills
`matchedIds` in before the response is journaled or streamed.

## The seam is semantics against evaluation

Translating "hide anything retired" into `{ excludeStatuses: ['retired'] }`
needs language understanding and the rendered model's vocabulary, both of
which the child has. Turning that query into a set of subject ids needs a
compiled `SemanticGraph` and the projection evaluator, both of which the
runtime already holds and the child would have to re-derive by shelling out to
a second process that compiles the workspace again.

So the split is not a restriction placed on the agent; it is the removal of
work it was doing badly. The `yarramate_ask` round trip disappears from the
loop entirely, and with it the second compile, the cap mismatch, and the
seed-focus ceiling. What the child sends is shorter and covers more.

The property that matters is that a chat filter and a panel filter carrying
the same query can no longer disagree, because there is exactly one evaluator
and one graph behind both. Resolution happens before the append, so the
transcript records what the browser was shown rather than what the agent
proposed - a session replayed from its journal highlights the same subjects it
highlighted live.

## Asserting a match set is refused, not ignored

An agent that sends `matchedIds` anyway is answered with `YMVS311` and a
pointer at `/payload/appliedQuery/matchedIds`. Discarding it silently was the
alternative and it is worse: an agent that believes it is authoritative would
keep computing sets, keep being wrong, and keep looking correct, because the
canvas it saw agreed with it for reasons that had nothing to do with its work.
The wire says which side owns the answer; a violation is a protocol error and
reads like one.

Forbidding the field outright in the schema would have been stricter still,
and it is not available. The same document shape is validated on the way in
from the agent and on the way back out of the transcript
(`session-store.ts:345`), so the schema must accept a resolved response
carrying the ids the runtime just computed. `matchedIds` stays optional in
`$defs/chatAppliedQuery` for that round trip, and the authority rule is
enforced where the direction of travel is known.

That is also why `chatAppliedQuery` is a new definition rather than a loosened
`filterResultPayload`. The `filter.result` envelope is runtime-authored and
genuinely carries both halves; requiring only `query` there would weaken a
document the runtime writes to accommodate one it receives.

## An empty resolution is still an answer

A query that matches nothing highlights nothing. The runtime forwards it with
an empty `matchedIds` rather than dropping `appliedQuery` or failing the turn,
which is what `filter.query` from the panel already does - the reviewer sees
that their filter selected nothing, instead of watching the previous filter
stay lit and concluding it was applied.

## What this does not do

It does not let chat compose a filter the panel cannot. `appliedQuery` carries
a `ProjectionQuery` and nothing else, so the vocabulary is exactly the one the
filter panel and saved views already share. Chat becomes a faster way to reach
that vocabulary, not a second one.

It also does not make the agent's query correct. The runtime evaluates
faithfully what it was given; a child that maps "the payment path" onto the
wrong subjects produces a truthful highlight of the wrong question. That is a
conversation to have with the reviewer, and the pill showing the query it
resolved is what makes it visible.
