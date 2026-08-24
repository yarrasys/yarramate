/**
 * Which relationship kinds an editor may offer for an edge that already exists.
 *
 * `connectableKinds` answers this for an edge being drawn, and the guarantee it
 * carries is that a palette built from it cannot produce an edge `check` would
 * refuse with `YM404`. Re-typing an edge is the same question asked of the same
 * table, and until now nothing asked it: the properties form offered the whole
 * vocabulary, so `applicationComponent --composition--> businessActor` was one
 * click away and the refusal only arrived at commit.
 *
 * An extension kind has no row of its own in the ArchiMate table, so it is
 * judged by the core kind it descends from — `VisualKindOption.coreLabel`,
 * which the session server resolves through the profile's declared lineage
 * exactly as a canvas edge gets its own `coreKindLabel`. That field exists
 * because of this: without it the browser could read a palette but not judge
 * it, and every extension kind would have to be offered unchecked, which is a
 * `YM404` one click away in a menu whose whole point is that it cannot produce
 * one.
 *
 * The kind the edge already has is always offered, even when the table would
 * refuse it. A model authored outside this editor is not the editor's to
 * silently rewrite, and a select whose current value is missing from its own
 * options renders blank.
 *
 * Pure, and outside any component, for the reason `view-tree-model.ts` is:
 * this repo renders React through `renderToStaticMarkup` and has no DOM test
 * environment, so logic inside a component is logic no test can reach.
 */
import type { CanvasGraph } from "../graph-projection.js";
import type { VisualKindOption } from "../adapters/visual/protocol-contract.js";
import { connectableKinds } from "../relationship-drafting.js";
import { CORE_RELATIONSHIP_KINDS } from "../relationship-matrix.js";

export interface RelationshipKindOffer {
  /** What may be chosen, in vocabulary order. */
  readonly options: readonly VisualKindOption[];
  /**
   * Whether the ArchiMate table narrowed the list. False when either endpoint
   * sits outside the core vocabulary, which is the one case where the whole
   * vocabulary is offered because nothing here can judge it.
   */
  readonly narrowed: boolean;
}

export const relationshipKindOffer = (
  graph: CanvasGraph,
  /**
   * The endpoints as they stand, which is not always what the edge was
   * authored with: a staged `from` change moves the row of the table this
   * question is asked against, and the kind offered next has to follow it.
   */
  endpoints: { readonly from: string; readonly to: string },
  vocabulary: readonly VisualKindOption[],
  currentKindLabel: string,
): RelationshipKindOffer => {
  const permitted = new Set<string>(
    connectableKinds(graph, endpoints.from, endpoints.to),
  );
  // Empty means the table has no row for this pairing — an endpoint outside the
  // core vocabulary. Offering nothing would make the kind uneditable, which is
  // a worse answer than the one this module cannot give.
  if (permitted.size === 0) return { options: vocabulary, narrowed: false };

  const core = new Set<string>(CORE_RELATIONSHIP_KINDS);
  return {
    options: vocabulary.filter(
      (option) =>
        permitted.has(option.coreLabel) ||
        // A `coreLabel` the core vocabulary does not know is a kind whose
        // lineage never reaches the table at all. There is no row to judge it
        // against, so it is offered rather than refused on a guess.
        !core.has(option.coreLabel) ||
        option.label === currentKindLabel,
    ),
    narrowed: true,
  };
};
