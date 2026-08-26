import { filteredSubjectCount, GraphCanvas } from "./graph-canvas.js";
import type { PresentationFlag } from "./query-fields.js";
import { QueryPanel, type BottomPanelTabId } from "./query-panel.js";
import { QuickFilterBox } from "./quick-filter.js";
import { ViewTree } from "./view-tree.js";
import { SaveViewDialog } from "./save-view.js";
import { describeQuery } from "./describe-query.js";
import { ChangesetTray } from "./changeset-tray.js";
import {
  ConceptFacts,
  ConceptForm,
  RelationshipFacts,
  RelationshipForm,
} from "./subject-form.js";
import { OpenQuestions } from "./open-questions.js";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { NestingKind } from "../nesting.js";
import type { ProjectionQuery } from "../projection.js";
import type { VisualRenderedModel } from "../adapters/visual/wire.js";
import type { YarramateOperation } from "../operations.js";
import type {
  VisualChoicePresentPayload,
  VisualDiagnostic,
  VisualLayoutSavePayload,
  VisualViewOperation,
  VisualViewSummary,
} from "../adapters/visual/protocol-contract.js";
import type { EditorHost } from "./editor-host.js";
import { Section, SectionSplitter, stackRows } from "./section-stack.js";
import { useVisualSession } from "./session-client.js";
import { activeViewMembership } from "./state.js";
import type { VisualAppRecord, VisualAppState } from "./state.js";
import {
  conversationWidthBounds,
  createVisualWorkspaceState,
  editorPointerFor,
  formatContextualQuestion,
  normalizeSelectedElement,
  normalizeSelectedRelationship,
  presentationActionsFor,
  viewNeedingApplication,
  visualWorkspaceReducer,
  type ConnectionDraft,
  type EditorPointer,
  type EditorPointerContext,
  RIGHT_SECTIONS,
  type RightSectionId,
  type SelectedDiagramSubject,
} from "./workspace-state.js";
import { ConnectionPanel } from "./connection-panel.js";
import { faultedSubjects } from "./faults.js";
import { KindPalette } from "./kind-palette.js";
import { SubjectDraftPanel } from "./subject-draft-panel.js";
import { ConfirmDialog } from "./confirm-dialog.js";
import { PromptDialog } from "./prompt-dialog.js";
import {
  declaredFolder,
  duplicateView,
  renameView,
} from "../adapters/visual/view-identity.js";
import { ContextMenu } from "./context-menu.js";
import {
  contextMenuFor,
  type ContextMenuIntent,
  type ContextMenuTarget,
} from "./context-menu-model.js";
import { stageRelationshipScalarChange } from "./subject-form.js";
import { describeDeletion, draftDeletion } from "../deletion-drafting.js";
import { stagedSubjectIds } from "../relationship-drafting.js";

/**
 * A drawing board, not a document: the diagram holds the workspace, one compact
 * strip carries the facts and the controls above it, and the conversation is a
 * panel the reviewer sizes or puts away without losing what it holds.
 */

const SPEAKERS: Readonly<Record<VisualAppRecord["speaker"], string>> = {
  reviewer: "You",
  agent: "Agent",
  session: "Session",
};

const STATUS_WORDS: Readonly<
  Record<"thinking" | "compiling" | "waiting" | "idle", string>
> = {
  thinking: "Agent is thinking",
  compiling: "Agent is compiling the model",
  waiting: "Agent is waiting",
  idle: "Agent is idle",
};

const connectionOf = (state: VisualAppState, connected: boolean): string => {
  switch (state.lifecycle) {
    case "connecting":
      return "Opening";
    case "active":
      return connected ? "Live" : "Reconnecting";
    case "ending":
      return "Ending";
    case "disconnected":
      return "Reconnecting";
    case "closed":
      return "Closed";
  }
};

const endTransitionStatus = (state: VisualAppState): string => {
  if (state.lifecycle === "closed") {
    return "Visual conversation ended. Continue in the main agent.";
  }
  if (state.lifecycle !== "ending") return "";
  if (state.handoff !== null) {
    return "Handoff ready — returning control to the main agent.";
  }
  return "Ending conversation — preparing a handoff for the main agent.";
};

/**
 * Identity, and nothing else (#249).
 *
 * Every control the strip used to carry has gone to the thing it acts on: the
 * quick filter to the canvas it narrows, saving a view to the rail that lists
 * views, ending the session to the chat section that owns the conversation. A
 * strip that carried them put the session's most consequential button as far
 * from the conversation as the window allows.
 *
 * The description sits here rather than behind a `Details` disclosure. It is
 * one line about what this session IS, which is identity - and a button that
 * only ever revealed a sentence was a control the strip had no reason to keep.
 */
const CommandStrip = ({
  state,
  connection,
}: {
  readonly state: VisualAppState;
  readonly connection: string;
}) => (
  <header className="command-strip">
    <div className="command-identity">
      <h1>{state.title === "" ? "Opening the session" : state.title}</h1>
      <span className="beta-badge">Beta</span>
      <span className="authority">Checked YarraMate model</span>
      <span className="connection-state" role="status">
        {connection}
      </span>
    </div>
    {state.description === "" ? null : (
      <p className="session-description" title={state.description}>
        {state.description}
      </p>
    )}
  </header>
);


const Choices = ({
  choices,
  disabled,
  onChoice,
}: {
  readonly choices: VisualChoicePresentPayload;
  readonly disabled: boolean;
  readonly onChoice: (optionId: string) => void;
}) => (
  <div className="choices">
    <p className="question">{choices.question}</p>
    <ul>
      {choices.options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            onClick={() => onChoice(option.id)}
            disabled={disabled}
          >
            <span className="label">{option.label}</span>
            {option.description === undefined ? null : (
              <span className="detail">{option.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  </div>
);
/**
 * The server's own refusals of a browser frame (`YMVS...`). These are about the
 * frame rather than about a subject, so they carry no `subjects` and there is
 * nothing on the diagram to mark. A refused COMMIT is a different thing and
 * lands in the changeset tray, where what it names is counted and marked
 * (ADR 0102).
 */
const Faults = ({
  diagnostics,
}: {
  readonly diagnostics: readonly VisualDiagnostic[];
}) =>
  diagnostics.length === 0 ? null : (
    <div className="faults" role="alert">
      <p className="faults-title">
        The last change did not compile. The diagram still shows the model that
        did.
      </p>
      <ul>
        {diagnostics.map((diagnostic) => (
          <li key={`${diagnostic.code}-${diagnostic.pointer}`}>
            <span className="code">{diagnostic.code}</span> {diagnostic.message}
            <span className="where">
              {diagnostic.path}:{diagnostic.line}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

const DiagramWorkspace = ({
  state,
  selectedId,
  waiting,
  layout,
  nesting,
  showLifecycle,
  showEvidence,
  showOwnership,
  showNudges,
  openQuestionCounts,
  connection,
  onConnectTarget,
  onConnectCancel,
  onConnectStage,
  onDraftStage,
  draftingSubject,
  draftInitialKind,
  onKindDrop,
  onDraftSubject,
  onDraftSubjectClose,
  pendingDeletion,
  onDeletionDismiss,
  onSelect,
  onCanvasMenu,
  onClearFilter,
  onSaveLayout,
  onCanvasReady,
  onQuickFilterChange,
  view,
  bottomPanel,
  onTogglePresentation,
  onToggleBottomPanel,
  onSelectBottomTab,
  onApplyFilter,
  onStageView,
  readOnly,
}: {
  readonly state: VisualAppState;
  readonly selectedId: string | null;
  readonly waiting: string | null;
  readonly layout: "layered";
  readonly nesting: readonly NestingKind[];
  readonly showLifecycle: boolean;
  readonly showEvidence: boolean;
  readonly showOwnership: boolean;
  readonly showNudges: boolean;
  readonly openQuestionCounts: ReadonlyMap<string, number>;
  readonly connection: ConnectionDraft | null;
  readonly onConnectTarget: (id: string) => void;
  readonly onConnectCancel: () => void;
  readonly onConnectStage: (operation: YarramateOperation) => void;
  /**
   * Staging for a subject the reviewer is CREATING, which is not the same
   * motion as staging a relationship or a deletion: a created subject also
   * joins the view that created it (#255).
   */
  readonly onDraftStage: (operation: YarramateOperation) => void;
  readonly draftingSubject: boolean;
  /** The kind the open draft was seeded with - a palette pick (#295) - or
   * undefined for a draft opened plain. */
  readonly draftInitialKind: string | undefined;
  /** A kind dropped from the palette onto the canvas (#295). */
  readonly onKindDrop: (
    kindLabel: string,
    position: { readonly x: number; readonly y: number },
  ) => void;
  readonly onDraftSubject: () => void;
  readonly onDraftSubjectClose: () => void;
  readonly pendingDeletion: string | null;
  readonly onDeletionDismiss: () => void;
  readonly onSelect: (subject: SelectedDiagramSubject) => void;
  readonly onCanvasMenu: (
    target: {
      readonly type: "node" | "edge" | "canvas";
      readonly id: string | null;
    },
    position: { readonly x: number; readonly y: number },
  ) => void;
  readonly onClearFilter: () => void;
  readonly onSaveLayout: (payload: VisualLayoutSavePayload) => void;
  readonly onCanvasReady: (png: (() => string) | null) => void;
  readonly onQuickFilterChange: (text: string) => void;
  readonly view: VisualViewSummary | null;
  readonly bottomPanel: {
    readonly open: boolean;
    readonly tab: BottomPanelTabId;
  };
  readonly onTogglePresentation: (
    flag: PresentationFlag,
    value: boolean,
  ) => void;
  readonly onToggleBottomPanel: () => void;
  readonly onSelectBottomTab: (tab: BottomPanelTabId) => void;
  readonly onApplyFilter: (query: ProjectionQuery) => void;
  readonly onStageView: (operation: VisualViewOperation) => void;
  /**
   * A viewer, not an author (#298, ADR 0117). The canvas still selects,
   * filters and navigates; everything that stages - the Add-subject opener,
   * the palette drop, the stage-view-change affordance - is absent, and a
   * drag still moves a node transiently but writes no layout.
   */
  readonly readOnly: boolean;
}) => {
  // An edge names its endpoints by node id; the reviewer reads titles. The
  // rendering model the renderer itself draws answers that, so nothing here
  // reaches into the compiled document.
  const nodeTitles = useMemo(
    () =>
      new Map(
        (state.model?.graph.nodes ?? []).map(
          (node) => [node.id, node.name] as const,
        ),
      ),
    [state.model],
  );

  // A filter that leaves nothing visible blanks the canvas, and a blank
  // canvas does not say why (#307): at register scale the very same blank is
  // what an off-viewport survivor looks like, so absence has to be stated,
  // never inferred. Counted with the exact narrowing the canvas applies
  // (`filteredSubjectCount` restates `applyFilter`), and attributed to what
  // caused it: the standing query when its own match set draws no subject,
  // the quick filter's text when subjects would otherwise be drawn. A model
  // with no subjects earns no pill, because nothing was hidden.
  const graphNodes = state.model?.graph.nodes ?? [];
  const structuralMatchedIds = state.activeFilter?.matchedIds ?? null;
  const filterEmptiedCanvas =
    graphNodes.length > 0 &&
    (state.activeFilter !== null || state.quickFilterText.trim() !== "") &&
    filteredSubjectCount(
      graphNodes,
      structuralMatchedIds,
      state.quickFilterText,
    ) === 0;
  const structuralFilterEmptied =
    state.activeFilter !== null &&
    filteredSubjectCount(graphNodes, structuralMatchedIds, "") === 0;

  return (
    <section className="diagram-workspace" aria-label="Architecture diagram">
      {/*
       * A view's own query is named by the tree, so a pill would repeat it,
       * and that holds while the reviewer edits it: the query tab is showing
       * the edit and the tree is still naming the view. Every other standing
       * filter has nothing else naming it - the tab can be collapsed and chat
       * can be scrolled away - so the canvas would show a subset while every
       * control claimed the whole model.
       */}
      {state.activeFilter !== null &&
      state.activeFilter.source !== "view" &&
      state.activeFilter.source !== "editor" ? (
        <div className="filter-pill" role="status">
          <span>
            Filtered by {state.activeFilter.source}:{" "}
            <code>{describeQuery(state.activeFilter.query)}</code>
          </span>
          <button type="button" onClick={onClearFilter}>
            Show all
          </button>
        </div>
      ) : null}
      <div className="canvas">
        {state.model === null ? null : (
          // On the canvas, because the canvas is what it narrows. It used to
          // sit in the command strip, as far from the diagram as the window
          // allows, next to controls that had nothing to do with it (#249).
          <div className="canvas-controls">
            <QuickFilterBox
              value={state.quickFilterText}
              onChange={onQuickFilterChange}
            />
            {readOnly ? null : (
              <button
                type="button"
                className="subject-draft-open"
                onClick={onDraftSubject}
              >
                Add subject
              </button>
            )}
          </div>
        )}
        {!draftingSubject || state.model === null ? null : (
          <SubjectDraftPanel
            // Keyed on the seed: a kind picked up while the form is already
            // open is a fresh draft, re-seeded, rather than a pick that
            // silently changes nothing (ADR 0116).
            key={draftInitialKind ?? ""}
            initialKind={draftInitialKind}
            graph={state.model.graph}
            kinds={state.model.vocabulary.conceptKinds}
            documents={state.model.documents}
            defaultDocument={
              // Near what the reviewer is looking at: the selected subject's
              // document, or the first the workspace declares.
              (selectedId === null
                ? undefined
                : state.model.graph.nodes.find(
                    (node) => node.id === selectedId,
                  )?.document) ??
              state.model.documents[0] ??
              ""
            }
            onStage={onDraftStage}
            onCancel={onDraftSubjectClose}
          />
        )}
        {pendingDeletion === null || state.model === null ? null : (
          <ConfirmDialog
            title="Delete"
            message={
              describeDeletion(state.model.graph, pendingDeletion) ??
              "That subject is no longer on the diagram."
            }
            confirmLabel="Delete"
            cancelLabel="Keep"
            onConfirm={() => {
              // One batch: a subject and the relationships naming it have to
              // go together or `apply` refuses the lot (ADR 0069).
              for (const operation of draftDeletion(
                state.model!.graph,
                pendingDeletion,
              )) {
                onConnectStage(operation);
              }
              onDeletionDismiss();
            }}
            onCancel={onDeletionDismiss}
          />
        )}
        {connection === null || state.model === null ? null : (
          <ConnectionPanel
            draft={connection}
            graph={state.model.graph}
            // What is staged but not landed: the graph cannot know these ids,
            // and without them a second relationship between the same pair
            // collides with the first and is silently swallowed (#306).
            reservedIds={stagedSubjectIds(state.pendingChangeset.operations)}
            onStage={onConnectStage}
            onCancel={onConnectCancel}
          />
        )}
        {state.model === null ? null : (
          <GraphCanvas
            graph={state.model.graph}
            selectedId={selectedId}
            onSelect={(id, type) => {
              const graph = state.model!.graph;
              if (type === "node") {
                // While a relationship is being drawn, naming a subject means
                // "connect to that", not "inspect that". Selection resumes as
                // soon as the draft is resolved or cancelled.
                if (connection !== null) {
                  onConnectTarget(id);
                  return;
                }
                const node = graph.nodes.find((n) => n.id === id);
                if (node !== undefined)
                  onSelect(normalizeSelectedElement(node));
              } else {
                const edge = graph.edges.find((e) => e.id === id);
                if (edge !== undefined)
                  onSelect(normalizeSelectedRelationship(edge, nodeTitles));
              }
            }}
            onContextMenu={onCanvasMenu}
            matchedIds={state.activeFilter?.matchedIds ?? null}
            quickFilterText={state.quickFilterText}
            nesting={nesting}
            faultedIds={faultedSubjects(state.commitDiagnostics ?? [])}
            showLifecycle={showLifecycle}
            showEvidence={showEvidence}
            showOwnership={showOwnership}
            showNudges={showNudges}
            openQuestionCounts={openQuestionCounts}
            activeViewId={state.activeView}
            savedPositions={state.model.layouts[state.activeView]}
            // A read-only drag still moves the node - arranging what is on
            // screen is reading - but the debounced save it would queue goes
            // nowhere: nothing a viewer does may write. The saved-layout pill
            // keeps working either way; Discard is session-local.
            onSaveLayout={readOnly ? () => undefined : onSaveLayout}
            // No palette in a read-only mount, so nothing honest could drop:
            // an undefined handler makes the canvas refuse the drag itself.
            onKindDrop={readOnly ? undefined : onKindDrop}
            onCanvasReady={onCanvasReady}
          />
        )}
        {/*
         * The canvas is blank because of a filter, not because the model is
         * empty (#307): say so where the subjects would be, and hand back the
         * way out. Attribution decides the escape offered: a standing query
         * that itself matches no subject gets the pill's own Show all, while
         * a quick filter that zeroed an otherwise drawn set gets its text
         * named and cleared, leaving the standing filter standing.
         */}
        {!filterEmptiedCanvas ? null : (
          <div className="filter-empty-pill" role="status">
            {structuralFilterEmptied && state.activeFilter !== null ? (
              <>
                <span>
                  Nothing matches this filter:{" "}
                  <code>{describeQuery(state.activeFilter.query)}</code>
                </span>
                <button type="button" onClick={onClearFilter}>
                  Show all
                </button>
              </>
            ) : (
              <>
                <span>
                  Nothing matches “{state.quickFilterText.trim()}”
                </span>
                <button type="button" onClick={() => onQuickFilterChange("")}>
                  Clear filter
                </button>
              </>
            )}
          </div>
        )}
        {state.layoutNotice === null ? null : (
          <div className="layout-notice-pill" role="status">
            <span>{state.layoutNotice}</span>
          </div>
        )}
        {waiting === null ? null : <p className="waiting">{waiting}</p>}
      </div>
      <QueryPanel
        // Re-seeded when the reviewer moves to another view, and not when they
        // edit the one they are on: an `editor` filter leaves `activeView`
        // standing, so the fields survive every keystroke and are replaced
        // only by a navigation that means "edit a different view".
        key={state.activeView}
        nodes={state.model?.graph.nodes ?? []}
        activeFilter={state.activeFilter}
        view={view}
        open={bottomPanel.open}
        tab={bottomPanel.tab}
        showLifecycle={showLifecycle}
        showEvidence={showEvidence}
        showOwnership={showOwnership}
        showNudges={showNudges}
        onTogglePresentation={onTogglePresentation}
        onToggleOpen={onToggleBottomPanel}
        onSelectTab={onSelectBottomTab}
        onApply={onApplyFilter}
        onStage={onStageView}
        readOnly={readOnly}
      />
    </section>
  );
};

/**
 * A description is worth reading in full and worth not burying the rest of the
 * panel under. Three lines are the default; the disclosure appears only when
 * the browser actually clipped something, measured rather than guessed, because
 * panel width and font metrics both move.
 */
const ExpandableDescription = ({
  text,
  expanded,
  onToggle,
}: {
  readonly text: string | null;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) => {
  const description = text ?? "No description declared in this model";
  const body = useRef<HTMLParagraphElement>(null);
  const [canExpand, setCanExpand] = useState(false);

  useLayoutEffect(() => {
    const element = body.current;
    if (element === null || expanded) return;
    const measure = () =>
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [description, expanded]);

  return (
    <div className="subject-description">
      <p
        ref={body}
        className={expanded ? "description-expanded" : "description-clamped"}
      >
        {description}
      </p>
      {canExpand || expanded ? (
        <button type="button" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
};

/**
 * What the reviewer clicked, said back to them in the model's own words: the
 * facts the diagram cannot fit, and nothing the renderer would have to be
 * trusted to render.
 */
const SelectedSubjectInspector = ({
  subject,
  model,
  operations,
  expanded,
  onToggleDescription,
  onClear,
  onConnect,
  onDelete,
  onStageChange,
  readOnly,
}: {
  readonly subject: SelectedDiagramSubject;
  readonly model: VisualRenderedModel;
  readonly operations: readonly YarramateOperation[];
  readonly expanded: boolean;
  readonly onToggleDescription: () => void;
  readonly onClear: () => void;
  readonly onConnect: (from: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onStageChange: (operation: YarramateOperation) => void;
  /**
   * A viewer, not an author (#298): Connect and Delete are absent and the
   * facts render as values rather than as the editable forms. Clear stays -
   * putting a selection down is reading.
   */
  readonly readOnly: boolean;
}) => {
  const node =
    subject.type === "element"
      ? model.graph.nodes.find((candidate) => candidate.id === subject.id)
      : undefined;
  const edge =
    subject.type === "relationship"
      ? model.graph.edges.find((candidate) => candidate.id === subject.id)
      : undefined;

  return (
    <section className="subject-inspector" aria-labelledby="subject-heading">
      <div className="subject-heading-row">
        <div>
          <p className="subject-type">
            {subject.type === "element"
              ? "Selected element"
              : "Selected relationship"}
          </p>
          <h2 id="subject-heading">
            {subject.type === "element"
              ? subject.title
              : `${subject.sourceTitle} → ${subject.targetTitle}`}
          </h2>
        </div>
        {subject.type === "element" && !readOnly ? (
          <button
            type="button"
            className="subject-connect"
            onClick={() => onConnect(subject.id)}
          >
            Connect
          </button>
        ) : null}
        {readOnly ? null : (
          <button
            type="button"
            className="subject-delete"
            onClick={() => onDelete(subject.id)}
          >
            Delete
          </button>
        )}
        <button type="button" className="subject-clear" onClick={onClear}>
          Clear
        </button>
      </div>

      {node !== undefined ? (
        readOnly ? (
          <ConceptFacts node={node} model={model} />
        ) : (
          <ConceptForm
            node={node}
            model={model}
            operations={operations}
            onStageChange={onStageChange}
          />
        )
      ) : null}
      {edge !== undefined ? (
        readOnly ? (
          <RelationshipFacts edge={edge} model={model} />
        ) : (
          <RelationshipForm
            edge={edge}
            model={model}
            operations={operations}
            onStageChange={onStageChange}
          />
        )
      ) : null}

      <ExpandableDescription
        text={subject.description}
        expanded={expanded}
        onToggle={onToggleDescription}
      />
    </section>
  );
};

/**
 * The chat section: the transcript, the composer, and the session's own
 * control (#249).
 *
 * `Return to agent` lives HERE, beside the conversation it ends, rather than in
 * a strip that carries identity and nothing else. It is one button and it does
 * what it always did - hand control back to the main agent, which is what the
 * notice it writes has always said. The design draws a second, `End session`,
 * for a handback that leaves the session live; nothing can do that yet, and a
 * button that claimed to would be lying about the lifecycle.
 */
/**
 * What the Chat header says while it is shut, which is whose turn it is. A
 * count belongs there only when something arrived unread; the rest of the time
 * the useful word is what the agent is doing.
 */
const chatMeta = (state: VisualAppState): string =>
  state.lifecycle !== "active"
    ? "closed"
    : state.awaitingAgent
      ? (STATUS_WORDS[state.agentStatus?.state ?? "thinking"] ?? "working")
      : "agent idle";

const ChatSection = ({
  state,
  disabled,
  selectedSubject,
  onSend,
  onChoice,
  onClearSubject,
  onEnd,
}: {
  readonly state: VisualAppState;
  readonly disabled: boolean;
  readonly selectedSubject: SelectedDiagramSubject | null;
  readonly onSend: (text: string) => void;
  readonly onChoice: (optionId: string) => void;
  readonly onClearSubject: () => void;
  readonly onEnd: () => void;
}) => {
  const [draft, setDraft] = useState("");
  const agentWaiting = state.lifecycle === "active" && state.awaitingAgent;
  const visibleAgentStatus =
    state.lifecycle === "active" ? state.agentStatus : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || disabled) return;
    onSend(text);
    setDraft("");
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <div className="talk">
      <div className="conversation-scroll">
        <ol className="ledger" role="log" aria-live="polite">
          {state.transcript.length === 0 ? (
            <li className="empty">
              <p>Nothing asked yet. Question anything on the diagram.</p>
            </li>
          ) : (
            state.transcript.map((record) => (
              <li key={record.id} className={`said said-${record.speaker}`}>
                <p className="who">{SPEAKERS[record.speaker]}</p>
                <p className="words">{record.text}</p>
              </li>
            ))
          )}
        </ol>

        <Faults diagnostics={state.diagnostics} />

        {state.choices === null ? null : (
          <Choices
            choices={state.choices}
            disabled={disabled}
            onChoice={onChoice}
          />
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        {selectedSubject === null ? null : (
          <div className="subject-chip">
            <span>
              {selectedSubject.type === "element"
                ? selectedSubject.title
                : `${selectedSubject.sourceTitle} → ${selectedSubject.targetTitle}`}
            </span>
            <button
              type="button"
              aria-label="Remove selected diagram context"
              onClick={onClearSubject}
            >
              Remove
            </button>
          </div>
        )}
        <label className="offscreen" htmlFor="composer-text">
          Ask about this design
        </label>
        <textarea
          id="composer-text"
          name="question"
          rows={3}
          value={draft}
          disabled={disabled}
          placeholder={
            !state.chatEnabled
              ? "This session is read-only"
              : selectedSubject?.type === "element"
                ? "Ask about this element"
                : selectedSubject?.type === "relationship"
                  ? "Ask about this relationship"
                  : "Ask about this design"
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        <div className="composer-foot">
          <p
            className="agent-status"
            role="status"
            aria-live="polite"
            aria-busy={agentWaiting}
          >
            {agentWaiting ? (
              <span className="agent-spinner" aria-hidden="true" />
            ) : null}
            <span>
              {visibleAgentStatus === null
                ? agentWaiting
                  ? "Awaiting agent response"
                  : "\u00a0"
                : (STATUS_WORDS[visibleAgentStatus.state] ?? "\u00a0")}
            </span>
          </p>
          <button type="submit" disabled={disabled || draft.trim() === ""}>
            Send
          </button>
        </div>
        <div className="session-foot">
          <span
            className="end-transition-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {endTransitionStatus(state)}
          </span>
          <button
            type="button"
            className="end-session"
            onClick={onEnd}
            disabled={state.lifecycle !== "active"}
          >
            {state.lifecycle === "ending" || state.lifecycle === "closed"
              ? "Returning…"
              : "Return to agent"}
          </button>
        </div>
      </form>
    </div>
  );
};

const ConversationSeparator = ({
  width,
  viewportWidth,
  onResize,
}: {
  readonly width: number;
  readonly viewportWidth: number;
  readonly onResize: (width: number) => void;
}) => {
  // From the state the reducer clamped against, never from `window`: a resize
  // that leaves the panel width alone still changes what this may be dragged
  // to, and a render that read the live global would only say so by accident.
  const bounds = conversationWidthBounds(viewportWidth);
  const drag = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    onResize(active.startWidth + active.startX - event.clientX);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    onResize(width + (event.key === "ArrowLeft" ? step : -step));
  };
  return (
    <div
      className="conversation-separator"
      role="separator"
      aria-label="Resize conversation"
      aria-orientation="vertical"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={keyDown}
    />
  );
};

/**
 * The editor.
 *
 * It takes a HOST rather than opening a session of its own (#252): the same
 * component runs against the session server over a websocket and against an
 * embedder's own store with no server at all. `sections` is what the host
 * wants shown - a product with no agent behind it leaves `chat` out, and the
 * section and the session button go with it.
 *
 * `readOnly` is one flag, threaded once (#298, ADR 0117): a viewer keeps
 * everything that reads - the canvas, the tree, the query fields, the facts,
 * the questions - and every affordance that stages or commits is absent
 * rather than disabled. A UI posture only: whatever this shell draws, the
 * host still answers for its own store.
 */
export const App = ({
  host,
  sections = RIGHT_SECTIONS,
  readOnly = false,
  onReady,
}: {
  readonly host: EditorHost;
  readonly sections?: readonly RightSectionId[];
  readonly readOnly?: boolean;
  /**
   * How the mount layer's handle reaches this shell's reducer (#297,
   * ADR 0118). Called once, after the first render, with the pointer the
   * handle delegates to - which is what makes the handle's pre-ready
   * false-return window real. Selection and dialog state are client state,
   * so this rides a prop rather than the `EditorHost` seam: the protocol
   * carries documents, not gestures.
   */
  readonly onReady?: (pointer: EditorPointer) => void;
}) => {
  const {
    state,
    connected,
    ask,
    choose,
    navigate,
    filter,
    clearFilter,
    setQuickFilterText,
    stageViewChange,
    stageViewMembership,
    saveLayout,
    discardChange,
    stageChange,
    clearChangeset,
    undoChangeset,
    redoChangeset,
    commitChangeset,
    end,
  } = useVisualSession(host);

  const [workspace, dispatchWorkspace] = useReducer(
    visualWorkspaceReducer,
    // Both dimensions: the column's width is clamped against one and the
    // sections' heights against the other, and a stack seeded with no height
    // clamps every splitter to its floor (#249).
    { width: window.innerWidth, height: window.innerHeight },
    ({ width, height }) => createVisualWorkspaceState(width, height),
  );

  const [layoutWaiting, setLayoutWaiting] = useState<string | null>(null);
  // The save-view form has several openers - the rail's new-view button and
  // three context-menu items - and none of them is the form, so the shell owns
  // whether it is open.
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  // Which folder a new view is saved into. Set by "New view in this folder…"
  // and cleared by every other opener, so the default directory is what a
  // plain "New view…" gets.
  // Whether the reviewer is naming a brand new folder. Only the openness: the
  // half-typed name belongs to the dialog while it is on screen.
  const [namingFolder, setNamingFolder] = useState(false);
  const [saveViewFolder, setSaveViewFolder] = useState<
    string | undefined
  >(undefined);
  // The kind a palette gesture picked up, seeding the Add-subject dialog it
  // opens (#295). Shell state like `saveViewFolder`, not workspace state: it
  // is the gesture's payload on its way to the form, not a fact about the
  // workspace - the reducer keeps only that the draft is open. A plain opener
  // clears it, so "Add subject" still starts with no kind chosen (ADR 0116).
  const [draftKind, setDraftKind] = useState<string | undefined>(undefined);
  // A way to photograph the canvas, handed up by `GraphCanvas` while one
  // exists. A ref rather than state: nothing renders differently because of
  // it, and a menu item reads it at the moment it is chosen.
  const canvasPngRef = useRef<(() => string) | null>(null);

  // What the host's pointer reads at call time (#297, ADR 0118). Refreshed
  // every render rather than captured when the pointer was handed up, so a
  // method called after a commit answers for the graph that is on screen.
  const pointerContext = useRef<EditorPointerContext>({
    graph: null,
    readOnly,
  });
  pointerContext.current = {
    graph: state.model?.graph ?? null,
    readOnly,
  };
  useEffect(() => {
    onReady?.(
      editorPointerFor(
        () => pointerContext.current,
        dispatchWorkspace,
        setDraftKind,
      ),
    );
  }, [onReady]);

  useEffect(() => {
    const resized = () =>
      dispatchWorkspace({
        type: "viewport.resized",
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);

  // Applying a view is one job with two triggers - the tree, and the view
  // the session opens on - so it runs here rather than in the tree's
  // handler, which the server-chosen opening never passes through. The ref
  // records what has already landed, so a reviewer-driven navigate (which
  // moves `activeView` synchronously) is applied exactly once, and clearing
  // back to "All" re-arms the view the reviewer left.
  const appliedViewRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.activeView === "") {
      appliedViewRef.current = null;
      return;
    }
    const view = viewNeedingApplication(
      state.activeView,
      state.views,
      appliedViewRef.current,
      connected,
    );
    if (view === null) return;
    appliedViewRef.current = view.id;
    filter(view.query, "view");
    for (const action of presentationActionsFor(view.presentation)) {
      dispatchWorkspace(action);
    }
  }, [state.activeView, state.views, connected, filter]);

  // Only what arrived from the agent counts as attention: everything the
  // reviewer did themselves is already in front of them.
  const attention = useRef({
    transcriptLength: state.transcript.length,
    choices: state.choices,
    diagnostics: state.diagnostics,
  });

  useEffect(() => {
    const previous = attention.current;
    let receivedTranscript = false;
    for (
      let index = previous.transcriptLength;
      index < state.transcript.length;
      index += 1
    ) {
      if (state.transcript[index]?.speaker === "agent") {
        receivedTranscript = true;
        break;
      }
    }
    const received =
      receivedTranscript ||
      (state.choices !== null && state.choices !== previous.choices) ||
      (state.diagnostics.length > 0 &&
        state.diagnostics !== previous.diagnostics);
    attention.current = {
      transcriptLength: state.transcript.length,
      choices: state.choices,
      diagnostics: state.diagnostics,
    };
    if (received) dispatchWorkspace({ type: "attention.received" });
  }, [state.transcript.length, state.choices, state.diagnostics]);

  // A commit or a promotion replaces the whole model. The workspace re-reads the
  // held subject from the new graph rather than assuming it is gone; views and
  // lifecycle change under the same model and must leave the selection alone.
  const activeCandidate = useRef(state.model);
  useEffect(() => {
    if (state.model !== activeCandidate.current) {
      activeCandidate.current = state.model;
      dispatchWorkspace({
        type: "model.replaced",
        graph: state.model?.graph ?? null,
      });
    }
  }, [state.model]);

  // "No model to draw" is only true before anything has arrived; once a
  // model exists, `waiting` reflects the canvas's own busy state (e.g. a
  // `force` layout's two-pass run) instead of always being null.
  const waiting =
    state.model !== null
      ? layoutWaiting
      : state.lifecycle === "connecting"
        ? "Reading the session"
        : "No model to draw";

  const stagedCount =
    state.pendingChangeset.operations.length +
    state.pendingChangeset.viewOperations.length;
  const sectionOpen = (section: RightSectionId) =>
    !workspace.conversation.collapsed.includes(section);
  // The interrogation overlay rides the model frame (#292); both change
  // identity together, which is what keeps the chips and the graph telling
  // one story. A host that ships no overlay hides the whole surface -
  // chips, section, and all - rather than drawing zeros it cannot stand
  // behind.
  const interrogation = state.model?.interrogation;
  const openQuestionCounts = useMemo(
    () =>
      new Map(
        Object.entries(interrogation?.subjects ?? {}).map(
          ([id, questions]) => [id, questions.length] as const,
        ),
      ),
    [interrogation],
  );
  // Read-only strips the sections that exist only to stage (#298, ADR 0117):
  // a palette that cannot create and a changes tray that cannot commit are
  // not "sections the host wants shown", whatever the list says. The filter
  // sits beside the questions gate because both answer the same question -
  // which sections have anything true to draw.
  const offeredSections = readOnly
    ? sections.filter(
        (section) => section !== "palette" && section !== "changes",
      )
    : sections;
  const visibleSections =
    interrogation === undefined
      ? offeredSections.filter((section) => section !== "questions")
      : offeredSections;
  const selectedElementId =
    workspace.selectedSubject?.type === "element"
      ? workspace.selectedSubject.id
      : null;
  const openQuestionMeta =
    interrogation === undefined
      ? undefined
      : selectedElementId === null
        ? interrogation.workspace.length
        : (openQuestionCounts.get(selectedElementId) ?? 0);
  // The palette's rows are the model frame's own vocabulary (#295) - the same
  // list the Add-subject dialog compiles its Kind select from, so the two can
  // never disagree about what a workspace may contain.
  const paletteKinds = state.model?.vocabulary.conceptKinds ?? [];
  const treeCollapsed = useMemo(
    () => new Set(workspace.tree.collapsed),
    [workspace.tree.collapsed],
  );
  const conversationHidden = workspace.conversation.hidden;
  const shellStyle = {
    // A hidden column gives its grid track back to the canvas; the dragged
    // width stays in state, waiting for the reopen (#294).
    "--conversation-width": conversationHidden
      ? "0px"
      : `${workspace.conversation.width}px`,
    // The two sections that have a height of their own; properties takes what
    // is left. A shut section is its header and nothing more, so the height it
    // was dragged to waits for it to open again.
    "--changes-height": sectionOpen("changes")
      ? `${workspace.conversation.changesHeight}px`
      : "auto",
    "--chat-height": sectionOpen("chat")
      ? `${workspace.conversation.chatHeight}px`
      : "auto",
  } as CSSProperties;

  // Every palette gesture ends here (#295): the kind rides along to seed the
  // form, and the same Add-subject dialog opens - a drop is not a shortcut
  // past the name and the document, it is a shortcut past the Kind select.
  // The drop's position is deliberately NOT taken further: placement belongs
  // to the layout system, so a dropped kind lands where elk puts it, and the
  // canvas hands the position up only so a future layout integration has the
  // seam already cut (ADR 0116).
  const draftWithKind = (kindLabel: string) => {
    setDraftKind(kindLabel);
    dispatchWorkspace({ type: "subject.draft.opened" });
  };

  const openMenu = (
    target: ContextMenuTarget,
    position: { readonly x: number; readonly y: number },
  ) =>
    dispatchWorkspace({
      type: "menu.opened",
      target,
      x: position.x,
      y: position.y,
    });

  // The menu is rebuilt from the live model on every render rather than
  // captured when it opened, so a commit landing underneath it cannot leave
  // items pointing at a subject that has gone.
  const menuGroups =
    workspace.contextMenu === null
      ? []
      : contextMenuFor(workspace.contextMenu.target, {
          graph: state.model?.graph ?? null,
          relationshipKinds: state.model?.vocabulary.relationshipKinds ?? [],
          activeViewId: state.activeView,
          filtered: state.activeFilter !== null,
          membership: activeViewMembership(state),
          readOnly,
        });

  /**
   * Every menu item ends here. The menu itself decides nothing about what an
   * item does; it names an intent, and this is the single place that turns one
   * into the dispatch, filter or staged operation it already had a name for.
   */
  const runIntent = (intent: ContextMenuIntent) => {
    const graph = state.model?.graph ?? null;
    switch (intent.type) {
      case "subject.inspect": {
        const node = graph?.nodes.find(
          (candidate) => candidate.id === intent.id,
        );
        if (node === undefined) return;
        dispatchWorkspace({
          type: "subject.selected",
          subject: normalizeSelectedElement(node),
        });
        return;
      }
      case "relationship.inspect": {
        const edge = graph?.edges.find(
          (candidate) => candidate.id === intent.id,
        );
        if (edge === undefined || graph === null) return;
        dispatchWorkspace({
          type: "subject.selected",
          subject: normalizeSelectedRelationship(
            edge,
            new Map(graph.nodes.map((node) => [node.id, node.name] as const)),
          ),
        });
        return;
      }
      case "subject.connect":
        dispatchWorkspace({ type: "connection.started", from: intent.from });
        return;
      case "subject.delete":
      case "relationship.delete":
        // Both go through the same confirmation the side panel already uses:
        // `draftDeletion` composes the batch and knows an edge from a node.
        dispatchWorkspace({ type: "deletion.asked", id: intent.id });
        return;
      case "relationship.retype": {
        const edge = graph?.edges.find(
          (candidate) => candidate.id === intent.id,
        );
        if (edge === undefined) return;
        for (const operation of stageRelationshipScalarChange(
          edge.document,
          edge.localId,
          "kind",
          edge.kindLabel,
          intent.kind,
        )) {
          stageChange(operation);
        }
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "canvas.draft-subject":
        // A plain opener: no kind arrives with the gesture, so none is left
        // over from an earlier palette pick.
        setDraftKind(undefined);
        dispatchWorkspace({ type: "subject.draft.opened" });
        return;
      case "view.add-subject":
      case "view.remove-subject":
        // Always the ACTIVE view: the menu only offers these where that view
        // has a membership list, and `activeViewMembership` is what decided
        // which of the two it offered.
        stageViewMembership(
          state.activeView,
          intent.id,
          intent.type === "view.add-subject" ? "add" : "remove",
        );
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.open":
        navigate(intent.id);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.clear":
        clearFilter();
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.new":
        // Same motion the rail's own new-view button makes, and seeded the
        // same way: from the query on the canvas, because that is what a
        // reviewer reaching for "new view" is usually keeping (#249).
        setSaveViewFolder(undefined);
        setSaveViewOpen(true);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.delete":
        // Asked, not done: removing a projection is the one view operation
        // that destroys authored text, so it goes through the same
        // confirm-then-stage shape a subject deletion does.
        dispatchWorkspace({ type: "viewDeletion.asked", id: intent.id });
        return;
      case "view.rename":
        dispatchWorkspace({ type: "viewRename.asked", id: intent.id });
        return;
      case "view.new-folder":
        // A folder is a label on a document, so an empty one cannot persist:
        // naming a folder and putting the first view in it are one motion.
        setNamingFolder(true);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      case "view.duplicate": {
        const view = state.views.find((candidate) => candidate.id === intent.id);
        if (view === undefined) return;
        const copy = duplicateView(
          view,
          new Set(state.views.map((candidate) => candidate.id)),
        );
        stageViewChange({ op: "write-view", ...copy });
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "view.new-in-folder": {
        const view = state.views.find((candidate) => candidate.id === intent.id);
        if (view === undefined) return;
        // The new view declares the folder this one declares. Nothing about
        // the filesystem is involved: both documents sit beside every other
        // projection and say which folder they belong to (ADR 0104).
        setSaveViewFolder(declaredFolder(view));
        setSaveViewOpen(true);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "view.copy-path": {
        const view = state.views.find((candidate) => candidate.id === intent.id);
        if (view === undefined) return;
        void navigator.clipboard?.writeText(view.path);
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
      case "canvas.export-png": {
        const png = canvasPngRef.current;
        if (png === null) return;
        // A local page, so an anchor with a data: href is the whole download.
        const link = document.createElement("a");
        link.href = png();
        link.download = `${state.activeView === "" ? "all-subjects" : state.activeView}.png`;
        link.click();
        dispatchWorkspace({ type: "menu.dismissed" });
        return;
      }
    }
  };

  const pendingViewDelete =
    workspace.pendingViewDeletion === null
      ? null
      : (state.views.find(
          (view) => view.id === workspace.pendingViewDeletion,
        ) ?? null);

  const pendingViewRename =
    workspace.pendingViewRename === null
      ? null
      : (state.views.find((view) => view.id === workspace.pendingViewRename) ??
        null);

  // The reopen strip's accessible name says what the hidden column is
  // holding back: a reader who cannot see the badges gets the same facts.
  const reopenLabel = [
    "Show the session panel",
    ...(workspace.conversation.unread === 0
      ? []
      : [`${workspace.conversation.unread} unread`]),
    ...(state.choices === null ? [] : ["the agent is waiting on a choice"]),
  ].join(", ");

  return (
    <main className="visual-shell" style={shellStyle}>
      <CommandStrip state={state} connection={connectionOf(state, connected)} />
      <div className="workspace">
        <ViewTree
          views={state.views}
          // Landed truth plus the reviewer's own staged intent (#299): the
          // tree merges these over `state.views`, so a staged view — and the
          // folder it declares — is visible, marked, before commit. Read off
          // the changeset, never stored: discarding the row is the revert.
          stagedViewOperations={state.pendingChangeset.viewOperations}
          activeViewId={state.activeView}
          nodes={state.model?.graph.nodes ?? []}
          // What the canvas is drawing, which is the graph narrowed by the
          // standing filter's match set — never `state.model.graph`, which
          // holds every subject the workspace declares whatever is on screen.
          inViewIds={
            state.activeFilter === null
              ? null
              : new Set(state.activeFilter.matchedIds)
          }
          filterText={workspace.tree.filterText}
          collapsed={treeCollapsed}
          onFilterChange={(filterText) =>
            dispatchWorkspace({ type: "tree.filtered", filterText })
          }
          onToggle={(key) => dispatchWorkspace({ type: "tree.toggled", key })}
          onSelectView={(id) => navigate(id)}
          onClearView={clearFilter}
          onNewView={() => {
            // Seeded from what is on the canvas, not from a blank model. The
            // strip's `Save view` button was how a reviewer kept the query they
            // were looking at, and the strip carries identity only now (#249) -
            // so this is that motion, and clearing the filter first would throw
            // away the thing being saved. It reverses the call #245 made when
            // this item was the only way to reach the form.
            setSaveViewFolder(undefined);
            setSaveViewOpen(true);
          }}
          onSelectSubject={(id) => {
            const node = state.model?.graph.nodes.find(
              (candidate) => candidate.id === id,
            );
            if (node === undefined) return;
            dispatchWorkspace({
              type: "subject.selected",
              subject: normalizeSelectedElement(node),
            });
          }}
          onRowMenu={(row, position) =>
            openMenu(
              row.kind === "view"
                ? { kind: "view-row", id: row.id }
                : { kind: "model-row", id: row.id },
              position,
            )
          }
          readOnly={readOnly}
        />
        <DiagramWorkspace
          state={state}
          selectedId={workspace.selectedSubject?.id ?? null}
          waiting={waiting}
          layout={workspace.layout}
          nesting={workspace.nesting}
          connection={workspace.connection}
          onConnectTarget={(id) =>
            dispatchWorkspace({ type: "connection.targeted", to: id })
          }
          onConnectCancel={() =>
            dispatchWorkspace({ type: "connection.cancelled" })
          }
          onConnectStage={stageChange}
          onDraftStage={(operation) => {
            stageChange(operation);
            // A view that LISTS its subjects cannot match one that did not
            // exist when the list was written, so it has to be told. A view
            // that describes them with facets already knows, and the reducer
            // is what decides which this is - the shell states the intent and
            // holds no copy of the rule.
            if (operation.op === "add-concept") {
              stageViewMembership(
                state.activeView,
                operation.concept.id,
                "add",
              );
            }
          }}
          draftingSubject={workspace.draftingSubject}
          draftInitialKind={draftKind}
          onKindDrop={(kindLabel) => draftWithKind(kindLabel)}
          onDraftSubject={() => {
            // The plain opener starts with no kind chosen, whatever a palette
            // gesture seeded last time (ADR 0116).
            setDraftKind(undefined);
            dispatchWorkspace({ type: "subject.draft.opened" });
          }}
          onDraftSubjectClose={() =>
            dispatchWorkspace({ type: "subject.draft.closed" })
          }
          pendingDeletion={workspace.pendingDeletion}
          onDeletionDismiss={() =>
            dispatchWorkspace({ type: "deletion.dismissed" })
          }
          showLifecycle={workspace.showLifecycle}
          showEvidence={workspace.showEvidence}
          showOwnership={workspace.showOwnership}
          showNudges={workspace.showNudges}
          openQuestionCounts={openQuestionCounts}
          onSelect={(subject) =>
            dispatchWorkspace({ type: "subject.selected", subject })
          }
          onCanvasMenu={(target, position) =>
            openMenu(
              target.type === "node"
                ? { kind: "subject", id: target.id ?? "" }
                : target.type === "edge"
                  ? { kind: "relationship", id: target.id ?? "" }
                  : { kind: "canvas" },
              position,
            )
          }
          onClearFilter={clearFilter}
          onSaveLayout={saveLayout}
          onCanvasReady={(png) => {
            canvasPngRef.current = png;
          }}
          onQuickFilterChange={setQuickFilterText}
          view={
            state.views.find((candidate) => candidate.id === state.activeView) ??
            null
          }
          bottomPanel={workspace.bottomPanel}
          onTogglePresentation={(flag, value) =>
            dispatchWorkspace({ type: "presentation.toggled", flag, value })
          }
          onToggleBottomPanel={() =>
            dispatchWorkspace({ type: "bottomPanel.toggled" })
          }
          onSelectBottomTab={(tab) =>
            dispatchWorkspace({ type: "bottomPanel.tabSelected", tab })
          }
          // An edit of the active view's query is still that view, so it is
          // filtered as `editor` and the tree goes on naming what is drawn.
          onApplyFilter={(query) => filter(query, "editor")}
          onStageView={stageViewChange}
          readOnly={readOnly}
        />
        {conversationHidden ? (
          // The way back stands where the column stood: a thin strip, not a
          // memory test, and it carries what the hidden column would have
          // shown - the unread count and a waiting choice - so presenting
          // never means missing the agent (#294).
          <button
            type="button"
            className="conversation-reopen"
            title="Show the session panel"
            aria-label={reopenLabel}
            onClick={() => dispatchWorkspace({ type: "conversation.toggled" })}
          >
            <span className="reopen-chevron" aria-hidden="true">
              «
            </span>
            {workspace.conversation.unread === 0 ? null : (
              <span className="attention-count">
                {workspace.conversation.unread}
              </span>
            )}
            {state.choices === null ? null : (
              <span
                className="attention-choice"
                title="The agent is waiting on a choice"
              >
                ?
              </span>
            )}
          </button>
        ) : (
          <>
            {/* Never against a hidden column: the separator resizes what is
                on screen, and the reopen strip is not a thing to drag. */}
            <ConversationSeparator
              width={workspace.conversation.width}
              viewportWidth={workspace.viewportWidth}
              onResize={(width) =>
                dispatchWorkspace({ type: "conversation.resized", width })
              }
            />
            <aside className="section-stack" aria-label="Session">
              <div className="stack-rim">
                <button
                  type="button"
                  className="conversation-hide"
                  title="Hide the session panel"
                  aria-label="Hide the session panel"
                  onClick={() =>
                    dispatchWorkspace({ type: "conversation.toggled" })
                  }
                >
                  »
                </button>
              </div>
              {stackRows(
                visibleSections,
                {
                  palette: (
                    <Section
                      id="palette"
                      label="Kind palette"
                      meta={
                        paletteKinds.length === 0
                          ? undefined
                          : paletteKinds.length === 1
                            ? "1 kind"
                            : `${paletteKinds.length} kinds`
                      }
                      open={sectionOpen("palette")}
                      onToggle={() =>
                        dispatchWorkspace({ type: "section.toggled", section: "palette" })
                      }
                    >
                      {paletteKinds.length === 0 ? (
                        <p className="section-empty">
                          No model yet. The kinds arrive with it.
                        </p>
                      ) : (
                        <KindPalette kinds={paletteKinds} onPick={draftWithKind} />
                      )}
                    </Section>
                  ),
                  properties: (
                    <Section
                      id="properties"
                      label="Element properties"
                      meta={workspace.selectedSubject?.id}
                      open={sectionOpen("properties")}
                      onToggle={() =>
                        dispatchWorkspace({ type: "section.toggled", section: "properties" })
                      }
                    >
                      {workspace.selectedSubject === null || state.model === null ? (
                        <p className="section-empty">
                          Nothing selected. Pick a subject on the canvas or in the rail.
                        </p>
                      ) : (
                        <SelectedSubjectInspector
                          subject={workspace.selectedSubject}
                          model={state.model}
                          operations={state.pendingChangeset.operations}
                          expanded={workspace.descriptionExpanded}
                          onToggleDescription={() =>
                            dispatchWorkspace({ type: "description.toggled" })
                          }
                          onClear={() => dispatchWorkspace({ type: "subject.cleared" })}
                          onConnect={(from) =>
                            dispatchWorkspace({ type: "connection.started", from })
                          }
                          onDelete={(id) =>
                            dispatchWorkspace({ type: "deletion.asked", id })
                          }
                          onStageChange={stageChange}
                          readOnly={readOnly}
                        />
                      )}
                    </Section>
                  ),
                  questions: (
                    <Section
                      id="questions"
                      label="Open questions"
                      meta={
                        openQuestionMeta === undefined
                          ? undefined
                          : openQuestionMeta === 0
                            ? "nothing open"
                            : `${openQuestionMeta} open`
                      }
                      open={sectionOpen("questions")}
                      onToggle={() =>
                        dispatchWorkspace({ type: "section.toggled", section: "questions" })
                      }
                    >
                      {interrogation === undefined ? null : (
                        <OpenQuestions
                          overlay={interrogation}
                          selectedId={selectedElementId}
                        />
                      )}
                    </Section>
                  ),
                  changes: (
                    <Section
                      id="changes"
                      label="Changes"
                      meta={stagedCount === 0 ? "nothing staged" : `${stagedCount} staged`}
                      open={sectionOpen("changes")}
                      onToggle={() =>
                        dispatchWorkspace({ type: "section.toggled", section: "changes" })
                      }
                    >
                      <ChangesetTray
                        state={state}
                        onDiscardChange={discardChange}
                        onClearChangeset={clearChangeset}
                        onUndoChangeset={undoChangeset}
                        onRedoChangeset={redoChangeset}
                        onCommitChangeset={commitChangeset}
                      />
                    </Section>
                  ),
                  chat: (
                    <Section
                      id="chat"
                      label="Chat"
                      meta={
                        workspace.conversation.unread === 0 ? (
                          chatMeta(state)
                        ) : (
                          <span className="attention-count">
                            {workspace.conversation.unread}
                          </span>
                        )
                      }
                      open={sectionOpen("chat")}
                      onToggle={() =>
                        dispatchWorkspace({ type: "section.toggled", section: "chat" })
                      }
                    >
                      <ChatSection
                        state={state}
                        disabled={!state.composerEnabled}
                        selectedSubject={workspace.selectedSubject}
                        onSend={(text) =>
                          ask(formatContextualQuestion(text, workspace.selectedSubject))
                        }
                        onChoice={choose}
                        onClearSubject={() =>
                          dispatchWorkspace({ type: "subject.cleared" })
                        }
                        onEnd={end}
                      />
                    </Section>
                  ),
                },
                {
                  changes: (
                    <SectionSplitter
                      label="Resize the changes section"
                      height={workspace.conversation.changesHeight}
                      viewportHeight={workspace.viewportHeight}
                      onResize={(height) =>
                        dispatchWorkspace({
                          type: "section.resized",
                          section: "changes",
                          height,
                        })
                      }
                    />
                  ),
                  chat: (
                    <SectionSplitter
                      label="Resize the chat section"
                      height={workspace.conversation.chatHeight}
                      viewportHeight={workspace.viewportHeight}
                      onResize={(height) =>
                        dispatchWorkspace({
                          type: "section.resized",
                          section: "chat",
                          height,
                        })
                      }
                    />
                  ),
                },
              )}
            </aside>
          </>
        )}
      </div>
      {/* At the shell, not inside the canvas or the rail: a menu opened on the
          last row of the rail has to be able to hang past the rail's edge. */}
      {workspace.contextMenu === null ? null : (
        <ContextMenu
          groups={menuGroups}
          x={workspace.contextMenu.x}
          y={workspace.contextMenu.y}
          onChoose={runIntent}
          onDismiss={() => dispatchWorkspace({ type: "menu.dismissed" })}
        />
      )}
      <SaveViewDialog
        views={state.views}
        activeViewId={state.activeView}
        // Seeded from what the canvas is drawing: saving a view is keeping the
        // query on screen, which is why nothing clears it on the way in.
        query={state.activeFilter?.query ?? null}
        layout={workspace.layout}
        showLifecycle={workspace.showLifecycle}
        showEvidence={workspace.showEvidence}
        showOwnership={workspace.showOwnership}
        open={saveViewOpen}
        folder={saveViewFolder}
        onClose={() => setSaveViewOpen(false)}
        onStage={stageViewChange}
      />
      {!namingFolder ? null : (
        <PromptDialog
          title="New folder"
          label="Folder"
          initialValue=""
          confirmLabel="Continue"
          cancelLabel="Cancel"
          onConfirm={(folder) => {
            setNamingFolder(false);
            const named = folder.trim();
            if (named === "") return;
            // Straight into the save form with the folder filled in: a folder
            // with no view in it is a folder no document declares, and so not
            // a folder at all.
            setSaveViewFolder(named);
            setSaveViewOpen(true);
          }}
          onCancel={() => setNamingFolder(false)}
        />
      )}
      {pendingViewRename === null ? null : (
        <PromptDialog
          title="Rename view"
          label="Title"
          initialValue={pendingViewRename.title}
          confirmLabel="Rename"
          cancelLabel="Cancel"
          onConfirm={(title) => {
            stageViewChange({
              op: "write-view",
              ...renameView(pendingViewRename, title),
            });
            dispatchWorkspace({ type: "viewRename.dismissed" });
          }}
          onCancel={() => dispatchWorkspace({ type: "viewRename.dismissed" })}
        />
      )}
      {pendingViewDelete === null ? null : (
        <ConfirmDialog
          title="Delete view"
          message={`Stage the removal of "${pendingViewDelete.title}"? The projection document goes when the changeset is committed; no subject is touched.`}
          confirmLabel="Delete"
          cancelLabel="Keep"
          onConfirm={() => {
            stageViewChange({
              op: "delete-view",
              path: pendingViewDelete.path,
            });
            dispatchWorkspace({ type: "viewDeletion.dismissed" });
          }}
          onCancel={() => dispatchWorkspace({ type: "viewDeletion.dismissed" })}
        />
      )}
    </main>
  );
};
