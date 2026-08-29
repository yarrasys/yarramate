/**
 * What a right-click offers, as data.
 *
 * Four things can be right-clicked — a subject, a relationship, the empty
 * canvas, a row in the rail — and one rule runs through all four: **operations
 * that edit the view are separated from operations that edit the model.**
 *
 * The rule is not decoration. Removing a subject from a view rewrites one
 * projection and leaves every other view alone; deleting it from the model
 * takes every relationship naming it and changes every view that drew it.
 * Rendered as neighbours in a flat list, the second is one slip away from
 * someone who meant the first. So the groups are labelled, they are ordered
 * view-before-model, and anything model-destructive sits last, behind a rule,
 * in `--failure`.
 *
 * Items carry an INTENT rather than a callback. A closure cannot be compared,
 * so a menu built from closures is a menu no test can read; a discriminated
 * union can be asserted on exactly, and the shell has nothing left to decide
 * but which reducer to hand it to. `presentationActionsFor` returns actions
 * for the same reason.
 *
 * Pure, and outside any component, because this repo renders React through
 * `renderToStaticMarkup` and has no DOM test environment.
 */
import type { CanvasGraph } from "../graph-projection.js";
import type { VisualKindOption } from "../adapters/visual/protocol-contract.js";
import { relationshipKindOffer } from "./relationship-kind-options.js";
import type { ActiveViewMembership } from "./state.js";

/** The id of the "All subjects" row, which is the absence of a view. */
export const ALL_SUBJECTS_VIEW = "";

export type ContextMenuTarget =
  | { readonly kind: "subject"; readonly id: string }
  | { readonly kind: "relationship"; readonly id: string }
  | { readonly kind: "canvas" }
  | { readonly kind: "view-row"; readonly id: string }
  | { readonly kind: "model-row"; readonly id: string };

export type ContextMenuIntent =
  | { readonly type: "subject.inspect"; readonly id: string }
  | { readonly type: "subject.connect"; readonly from: string }
  | { readonly type: "subject.delete"; readonly id: string }
  | { readonly type: "relationship.inspect"; readonly id: string }
  | {
      readonly type: "relationship.retype";
      readonly id: string;
      readonly kind: string;
    }
  | { readonly type: "relationship.delete"; readonly id: string }
  | { readonly type: "canvas.draft-subject" }
  | { readonly type: "view.open"; readonly id: string }
  /**
   * Narrow the canvas to this subject and everything one hop from it (#407).
   * A view operation, so it lives in the view group and survives `readOnly`.
   * It sets the same narrowed state every other filter sets and is cleared by
   * the same "Show all subjects" — one narrowing concept, one escape.
   */
  | { readonly type: "subject.focus"; readonly id: string }
  /** The relationship and its two endpoints. Nothing further (#407). */
  | { readonly type: "relationship.focus"; readonly id: string }
  | { readonly type: "view.clear" }
  | { readonly type: "view.new" }
  /**
   * A new view in a folder that does not exist yet. A folder is a label on a
   * document (ADR 0104), so an empty one cannot persist and this is what
   * "New folder" honestly is: name the folder, then put the first view in it.
   */
  | { readonly type: "view.new-folder" }
  /**
   * A new view in the folder this one occupies. Folders come from projection
   * paths (#245), so the only way to name one is to point at a view already in
   * it — which also means the folder is one the manifest demonstrably reaches.
   */
  | { readonly type: "view.new-in-folder"; readonly id: string }
  /** Retitles the view. The id and the path do not move — see `viewRowMenu`. */
  | { readonly type: "view.rename"; readonly id: string }
  | { readonly type: "view.duplicate"; readonly id: string }
  | { readonly type: "view.copy-path"; readonly id: string }
  | { readonly type: "canvas.export-png" }
  | { readonly type: "view.delete"; readonly id: string }
  /**
   * One subject into or out of the ACTIVE view's membership list. Only a view
   * that enumerates `subjects:` has one — see `ContextMenuContext.membership`.
   */
  | { readonly type: "view.add-subject"; readonly id: string }
  | { readonly type: "view.remove-subject"; readonly id: string };

/** Which half of the split an operation belongs to. */
export type ContextMenuScope = "view" | "model";

export interface ContextMenuItem {
  /** Stable across renders and readable in a test. */
  readonly key: string;
  readonly label: string;
  readonly intent: ContextMenuIntent;
  /** Marked as the value already in force, for a group that names a choice. */
  readonly current?: true;
}

export interface ContextMenuGroup {
  readonly key: string;
  readonly scope: ContextMenuScope;
  /** The heading, or null for a group that needs no name. */
  readonly label: string | null;
  /**
   * Whether this group removes authored text. Exactly one group per menu may
   * say so, it is always last, and it is the group that draws in `--failure`.
   */
  readonly destructive: boolean;
  readonly items: readonly ContextMenuItem[];
}

export interface ContextMenuContext {
  readonly graph: CanvasGraph | null;
  readonly relationshipKinds: readonly VisualKindOption[];
  /** The view the canvas is showing, or `ALL_SUBJECTS_VIEW`. */
  readonly activeViewId: string;
  /** Whether anything at all is narrowing the canvas right now. */
  readonly filtered: boolean;
  /**
   * How the active view can be told what it holds, or `null` when no view is
   * active and there is nothing to tell.
   *
   * A view that enumerates its subjects is told by its list; one that
   * describes them with facets is told by `exclude` (#267, ADR 0122). A
   * faceted view used to be `null` here, on the reasoning that an item which
   * could only ever do nothing is worse than no item (#255) - true of adding a
   * subject to a rule, and never true of taking one out of it.
   */
  readonly membership: ActiveViewMembership | null;
  /**
   * A viewer, not an author (#298, ADR 0117). A read-only menu keeps the items
   * that read or navigate and drops every item whose intent stages a change -
   * absent, never disabled.
   */
  readonly readOnly?: boolean;
}

/**
 * The intents that only read or navigate. Everything outside this set stages
 * a change - directly, or by opening a dialog whose whole purpose is to stage
 * one - and a read-only menu (#298) is the menu filtered to this set.
 * `subject.connect` is here in spirit only: it stages nothing itself, but the
 * panel it opens exists to stage a relationship, so it is out.
 */
const READING_INTENTS: ReadonlySet<ContextMenuIntent["type"]> = new Set([
  "subject.inspect",
  "relationship.inspect",
  "view.open",
  "view.clear",
  // Focus reads and narrows; it stages nothing, so a viewer keeps it.
  "subject.focus",
  "relationship.focus",
  "view.copy-path",
  "canvas.export-png",
]);

/**
 * Putting a subject into the active view, or taking it out — whichever the
 * view does not already say. One group, because a subject is either in the
 * view or not and only one of the two items is ever true.
 *
 * The two kinds of view read the same question from opposite fields: an
 * enumerating view holds a subject when its list names it, a faceted one holds
 * a subject unless `exclude` names it. On a faceted view the item that is NOT
 * offered is the honest one: "add" only ever lifts an exception, because
 * adding a subject the facets do not select would need an `include` tier that
 * does not exist and would quietly turn the rule into a list (#267).
 */
const membershipGroup = (
  id: string,
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => {
  if (context.membership === null) return [];
  const held =
    context.membership.kind === "enumerated"
      ? context.membership.subjects.includes(id)
      : !context.membership.excluded.includes(id);
  return [
    {
      key: "view",
      scope: "view",
      label: "View",
      destructive: false,
      items: [
        held
          ? {
              key: "view.remove-subject",
              label: "Remove from view",
              intent: { type: "view.remove-subject", id },
            }
          : {
              key: "view.add-subject",
              label: "Add to this view",
              intent: { type: "view.add-subject", id },
            },
      ],
    },
  ];
}

const NEW_VIEW: ContextMenuItem = {
  key: "view.new",
  label: "New view…",
  intent: { type: "view.new" },
};

const NEW_FOLDER: ContextMenuItem = {
  key: "view.new-folder",
  label: "New folder…",
  intent: { type: "view.new-folder" },
};

const SHOW_ALL: ContextMenuItem = {
  key: "view.clear",
  label: "Show all subjects",
  intent: { type: "view.clear" },
};

const deleteGroup = (
  intent: ContextMenuIntent,
  label: string,
): ContextMenuGroup => ({
  key: "delete",
  scope: "model",
  label: null,
  destructive: true,
  items: [{ key: "delete", label, intent }],
});

/**
 * The view group for a subject or relationship: focus, whatever membership
 * items the active view can be told, and the way out when anything is
 * narrowing (#407).
 *
 * One group rather than two. Focus and membership are both view operations,
 * and a second "View" heading three items later would read as a different
 * kind of thing. `membershipGroup` returns its own group when a view can be
 * told what it holds and nothing otherwise, so its items are folded in here
 * rather than sitting beside a focus group that would sometimes be alone.
 *
 * "Show all subjects" appears here for the same reason it appears on the
 * canvas menu: focus is most often cleared from the thing it focused, and
 * making the reviewer find blank canvas to escape would be the second exit
 * this feature exists not to add.
 */
const focusAndMembershipGroups = (
  focus: ContextMenuIntent,
  membership: readonly ContextMenuGroup[],
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => [
  {
    key: "view",
    scope: "view",
    label: "View",
    destructive: false,
    items: [
      { key: "focus", label: "Focus on this", intent: focus },
      ...membership.flatMap((group) => group.items),
      ...(context.filtered ? [SHOW_ALL] : []),
    ],
  },
];

const subjectMenu = (
  id: string,
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => {
  const node = context.graph?.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) return [];
  return [
    // Removing a subject from a view rewrites one projection; deleting it from
    // the model takes every relationship naming it. View first, destructive
    // last, and the two never neighbours.
    ...focusAndMembershipGroups(
      { type: "subject.focus", id },
      membershipGroup(id, context),
      context,
    ),
    {
      key: "model",
      scope: "model",
      label: "Model",
      destructive: false,
      items: [
        {
          key: "inspect",
          label: "Properties",
          intent: { type: "subject.inspect", id },
        },
        {
          key: "connect",
          label: "Connect from here…",
          intent: { type: "subject.connect", from: id },
        },
      ],
    },
    deleteGroup({ type: "subject.delete", id }, "Delete from model…"),
  ];
};

const relationshipMenu = (
  id: string,
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => {
  const graph = context.graph;
  const edge = graph?.edges.find((candidate) => candidate.id === id);
  if (graph === null || graph === undefined || edge === undefined) return [];

  // The whole point of the change-kind group: it is built from the table, so a
  // menu cannot draw an edge the compiler would refuse.
  const offer = relationshipKindOffer(
    graph,
    { from: edge.from, to: edge.to },
    context.relationshipKinds,
    edge.kindLabel,
  );

  const groups: ContextMenuGroup[] = [
    ...focusAndMembershipGroups(
      { type: "relationship.focus", id },
      [],
      context,
    ),
    {
      key: "model",
      scope: "model",
      label: "Model",
      destructive: false,
      items: [
        {
          key: "inspect",
          label: "Properties",
          intent: { type: "relationship.inspect", id },
        },
      ],
    },
  ];

  // A group of one is the kind it already has and nothing to change it to;
  // a heading over a single unclickable choice teaches nothing.
  if (offer.options.length > 1) {
    groups.push({
      key: "kind",
      scope: "model",
      label: "Change kind",
      destructive: false,
      items: offer.options.map((option) => ({
        key: `kind:${option.label}`,
        label: option.label,
        intent: {
          type: "relationship.retype" as const,
          id,
          kind: option.label,
        },
        ...(option.label === edge.kindLabel ? { current: true as const } : {}),
      })),
    });
  }

  groups.push(
    deleteGroup({ type: "relationship.delete", id }, "Delete from model…"),
  );
  return groups;
};

const canvasMenu = (
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => {
  if (context.graph === null) return [];
  return [
    {
      key: "view",
      scope: "view",
      label: "View",
      destructive: false,
      items: [
        NEW_VIEW,
        NEW_FOLDER,
        ...(context.filtered ? [SHOW_ALL] : []),
        // What is on screen, as a picture. A view-scope read rather than a
        // model one: it takes a copy of the canvas and changes nothing.
        {
          key: "canvas.export-png",
          label: "Export PNG",
          intent: { type: "canvas.export-png" },
        },
      ],
    },
    {
      key: "model",
      scope: "model",
      label: "Model",
      destructive: false,
      items: [
        {
          key: "add",
          label: "Add subject…",
          intent: { type: "canvas.draft-subject" },
        },
      ],
    },
  ];
};

const viewRowMenu = (
  id: string,
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => {
  const groups: ContextMenuGroup[] = [
    {
      key: "view",
      scope: "view",
      label: "View",
      destructive: false,
      items:
        id === ALL_SUBJECTS_VIEW
          ? [SHOW_ALL, NEW_VIEW, NEW_FOLDER]
          : [
              {
                key: "view.open",
                label: "Open view",
                intent: { type: "view.open", id },
                ...(id === context.activeViewId
                  ? { current: true as const }
                  : {}),
              },
              // Retitling only. The id decides the path AND keys the layout
              // sidecar (`.yarramate/visual-layout/<id>.yaml`), so a rename
              // that moved the id would silently orphan the positions the
              // reviewer dragged. Moving a view is a different motion.
              {
                key: "view.rename",
                label: "Rename…",
                intent: { type: "view.rename", id },
              },
              {
                key: "view.duplicate",
                label: "Duplicate",
                intent: { type: "view.duplicate", id },
              },
              {
                key: "view.new-in-folder",
                label: "New view in this folder…",
                intent: { type: "view.new-in-folder", id },
              },
              NEW_VIEW,
              NEW_FOLDER,
              {
                key: "view.copy-path",
                label: "Copy projection path",
                intent: { type: "view.copy-path", id },
              },
            ],
    },
  ];
  // "All subjects" is the absence of a view, not a document, so there is
  // nothing to delete and no rule to draw.
  if (id !== ALL_SUBJECTS_VIEW) {
    // Behind the rule and in `--failure` like every other destructive item,
    // even though its blast radius is one projection: the reviewer learns one
    // rule about where the dangerous items sit, not two.
    groups.push({
      key: "delete",
      scope: "view",
      label: null,
      destructive: true,
      items: [
        {
          key: "delete",
          label: "Delete view…",
          intent: { type: "view.delete", id },
        },
      ],
    });
  }
  return groups;
};

const modelRowMenu = (
  id: string,
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => {
  const node = context.graph?.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) return [];
  return [
    // The rail's own answer to "add this one to the view I am looking at",
    // which is what the design draws as a drag from this tree onto the canvas.
    ...membershipGroup(id, context),
    {
      key: "model",
      scope: "model",
      label: "Model",
      destructive: false,
      items: [
        {
          key: "inspect",
          label: "Properties",
          intent: { type: "subject.inspect", id },
        },
      ],
    },
    deleteGroup({ type: "subject.delete", id }, "Delete from model…"),
  ];
};

/**
 * The menu for a target, already ordered: view groups first, model groups
 * after them, and the destructive group last of all.
 *
 * Empty when the target has gone — a commit can replace the model between the
 * right-click and the render, and a menu over a subject that no longer exists
 * should not be drawn rather than drawn with dead items.
 */
export const contextMenuFor = (
  target: ContextMenuTarget,
  context: ContextMenuContext,
): readonly ContextMenuGroup[] => {
  const groups = ((): readonly ContextMenuGroup[] => {
    switch (target.kind) {
      case "subject":
        return subjectMenu(target.id, context);
      case "relationship":
        return relationshipMenu(target.id, context);
      case "canvas":
        return canvasMenu(context);
      case "view-row":
        return viewRowMenu(target.id, context);
      case "model-row":
        return modelRowMenu(target.id, context);
    }
  })();
  if (context.readOnly !== true) return groups;
  // One filter, by intent, rather than a read-only branch in every builder:
  // the intents are the discriminated union built to be read, so "which items
  // stage" is a question the menu can be asked once, at the end. A group
  // emptied by the filter is dropped whole - including every destructive
  // group, which by the rule above holds nothing but staging items.
  return groups.flatMap((group) => {
    const items = group.items.filter((item) =>
      READING_INTENTS.has(item.intent.type),
    );
    return items.length === 0 ? [] : [{ ...group, items }];
  });
};

export interface MenuPlacement {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the menu is drawn, given where the pointer was.
 *
 * A menu opened near the right or bottom edge would otherwise run off the
 * viewport with no scrollbar to reach it, which is how a right-click on the
 * last row of a rail loses its own delete item. Flipping to the other side of
 * the pointer keeps the menu beside what was clicked rather than over it;
 * clamping to zero is the last resort for a menu taller than the window.
 */
export const placeMenu = (
  pointer: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): MenuPlacement => ({
  left: Math.max(
    0,
    pointer.x + size.width <= viewport.width
      ? pointer.x
      : Math.min(pointer.x - size.width, viewport.width - size.width),
  ),
  top: Math.max(
    0,
    pointer.y + size.height <= viewport.height
      ? pointer.y
      : Math.min(pointer.y - size.height, viewport.height - size.height),
  ),
});
