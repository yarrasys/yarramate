import { existsSync } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VISUAL_LIMITS,
  parseVisualDiagnosticResult,
  toWireAbsolutePath,
  type VisualDiagnostic,
  type VisualEvent,
  type VisualModel,
  type VisualResponse,
  type VisualSessionDescriptor,
  type VisualSessionRequest,
} from "../src/adapters/visual/protocol.js";
import {
  VISUAL_SESSION_MARKER_FORMAT,
  VISUAL_SESSION_PRUNE_LIMIT,
  appendVisualEvent,
  appendVisualResponse,
  buildVisualModelGraph,
  createVisualSession,
  pruneStaleVisualSessions,
  readActionableEventsAfter,
  recoverVisualSession,
  removeVisualSession,
  visualSessionPaths,
  writeVisualSessionDescriptor,
  type VisualSessionPaths,
} from "../src/adapters/visual/session-store.js";
import { compileWorkspaceWithProfileContext } from "../src/compiler.js";
import { projectGraphForCanvas } from "../src/graph-projection.js";

const model: VisualModel = {
  format: "yarramate/visual-model/v1",
  authority: "canonical",
  initialView: "choices",
  sourceDigests: { "model.likec4": "a".repeat(64) },
  graph: { nodes: [], edges: [] },
};

const request: VisualSessionRequest = {
  format: "yarramate/visual-session-request/v1",
  authority: "canonical",
  title: "Choose a delivery design",
  description: "Design options drawn from the checked workspace",
  chatEnabled: true,
  initialModel: model,
};

// Buffer.alloc(32, 7) is the brief's random source; the store must honour the
// requested width, so the 16-byte session id is '07' sixteen times over.
const sessionId = "07".repeat(16);
const browserSecret = "07".repeat(32);

const identifier = (index: number) => index.toString(16).padStart(32, "0");

const posixOnly = process.platform !== "win32";
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;
const journalLines = async (path: string) =>
  (await readFile(path, "utf8")).split("\n").filter((line) => line.length > 0);

const chatEvent: VisualEvent = {
  format: "yarramate/visual-event/v1",
  sessionId,
  sequence: 1,
  eventId: identifier(1),
  type: "chat.message",
  timestamp: "2026-08-08T00:00:01.000Z",
  payload: { text: "Compare the two delivery designs" },
};

const chatResponse: VisualResponse = {
  format: "yarramate/visual-response/v1",
  sessionId,
  responseId: identifier(2),
  eventId: identifier(1),
  type: "chat.response",
  timestamp: "2026-08-08T00:00:02.000Z",
  payload: { text: "Design A isolates delivery; design B shares it." },
};

const handoffResponse = {
  format: "yarramate/visual-response/v1",
  sessionId,
  responseId: identifier(3),
  eventId: identifier(1),
  type: "handoff.complete",
  timestamp: "2026-08-08T00:00:03.000Z",
  payload: {
    summary: "The user chose the isolated delivery design.",
    confirmedDecisions: ["Isolate delivery behind its own boundary"],
    requestedChanges: [],
    unresolvedQuestions: ["Does billing still need synchronous delivery?"],
    finalViews: ["choices"],
  },
} satisfies VisualResponse;

const endEvent = (sequence: number, reason: "user-ended" | "browser-timeout") =>
  ({
    format: "yarramate/visual-event/v1",
    sessionId,
    sequence,
    eventId: identifier(900 + sequence),
    type: "session.end",
    timestamp: "2026-08-08T00:01:00.000Z",
    payload: { reason },
  }) satisfies VisualEvent;

const navigateEvent = (
  sequence: number,
  viewId: string,
  requiresAttention: boolean,
) =>
  ({
    format: "yarramate/visual-event/v1",
    sessionId,
    sequence,
    eventId: identifier(500 + sequence),
    type: "view.navigate",
    timestamp: "2026-08-08T00:00:10.000Z",
    payload: { viewId, requiresAttention },
  }) satisfies VisualEvent;

const sessionDeps = (
  baseDir: string,
  createdAt = "2026-08-08T00:00:00.000Z",
) => ({
  baseDir,
  now: () => new Date(createdAt),
  randomBytes: () => Buffer.alloc(32, 7),
});

describe("visual session store", () => {
  let parent = "";

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "yarramate-visual-store-"));
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  const startSession = async (createdAt?: string) =>
    createVisualSession(request, sessionDeps(parent, createdAt));

  describe("session creation", () => {
    it("places every session artefact inside one private directory", async () => {
      const session = await startSession();

      const expected = visualSessionPaths(join(parent, sessionId));
      expect(session.paths).toEqual(expected);
      expect(session.paths.root).toBe(expected.root);
      expect(session.paths.marker).toBe(expected.marker);
      expect(session.paths.journal).toBe(expected.journal);
      expect(await readFile(session.paths.journal, "utf8")).toBe("");
    });

    it("writes a versioned session marker naming its own directory", async () => {
      const session = await startSession();

      expect(JSON.parse(await readFile(session.paths.marker, "utf8"))).toEqual({
        format: VISUAL_SESSION_MARKER_FORMAT,
        id: sessionId,
        createdAt: "2026-08-08T00:00:00.000Z",
        authority: "canonical",
      });
    });

    it("records the authority label recovery has to report", async () => {
      const canonicalModel: VisualModel = {
        ...model,
        authority: "canonical",
        sourceDigests: { "model.likec4": "a".repeat(64) },
      };
      const session = await createVisualSession(
        {
          ...request,
          authority: "canonical",
          initialModel: canonicalModel,
        },
        sessionDeps(parent),
      );

      expect(await recoverVisualSession(session.paths)).toMatchObject({
        authority: "canonical",
      });
    });

    it("rejects a session request that fails protocol validation", async () => {
      const broken = {
        ...request,
        initialModel: { ...model, sourceDigests: {} },
      } as const;

      await expect(
        createVisualSession(
          broken as unknown as VisualSessionRequest,
          sessionDeps(parent),
        ),
      ).rejects.toThrow(/YMVS1/);
      expect(existsSync(join(parent, sessionId))).toBe(false);
    });

    it("draws the browser and agent capabilities independently", async () => {
      let draw = 0;
      const session = await createVisualSession(request, {
        baseDir: parent,
        now: () => new Date("2026-08-08T00:00:00.000Z"),
        randomBytes: (size) => Buffer.alloc(size, (draw += 1)),
      });

      expect(session.browserToken).toHaveLength(64);
      expect(session.agentToken).toHaveLength(64);
      expect(session.browserToken).not.toBe(session.agentToken);
      expect(session.paths.root).toBe(
        visualSessionPaths(join(parent, "01".repeat(16))).root,
      );
    });

    it("never reuses an existing session directory", async () => {
      await startSession();

      await expect(startSession()).rejects.toThrow();
    });

    it.skipIf(!posixOnly)(
      "creates directories 0700 and sensitive files 0600",
      async () => {
        const session = await startSession();

        expect(await modeOf(session.paths.root)).toBe(0o700);
        expect(await modeOf(session.paths.marker)).toBe(0o600);
        expect(await modeOf(session.paths.journal)).toBe(0o600);
      },
    );
  });

  describe("agent descriptor", () => {
    const descriptorFor = (
      paths: VisualSessionPaths,
      overrides: Partial<VisualSessionDescriptor> = {},
    ): VisualSessionDescriptor => ({
      format: "yarramate/visual-session-descriptor/v1",
      protocolVersion: "yarramate/visual-protocol/v3",
      sessionId,
      origin: "http://127.0.0.1:49152",
      agentCapability: "5c".repeat(32),
      sessionRoot: paths.root,
      journalPath: paths.journal,
      createdAt: "2026-08-08T00:00:00.000Z",
      ...overrides,
    });

    it("writes the agent descriptor as a private document of this session", async () => {
      const session = await startSession();
      const descriptor = descriptorFor(session.paths);

      await writeVisualSessionDescriptor(session.paths, descriptor);

      expect(
        JSON.parse(await readFile(session.paths.descriptor, "utf8")),
      ).toEqual(descriptor);
    });

    it.skipIf(!posixOnly)(
      "keeps the capability-carrying descriptor readable only by its owner",
      async () => {
        const session = await startSession();

        await writeVisualSessionDescriptor(
          session.paths,
          descriptorFor(session.paths),
        );

        expect(await modeOf(session.paths.descriptor)).toBe(0o600);
      },
    );

    it("refuses a descriptor that names another session", async () => {
      const session = await startSession();

      await expect(
        writeVisualSessionDescriptor(
          session.paths,
          descriptorFor(session.paths, { sessionId: identifier(3) }),
        ),
      ).rejects.toThrow(/YMVS126/);
      expect(existsSync(session.paths.descriptor)).toBe(false);
    });

    it("refuses a descriptor that names another session directory", async () => {
      const session = await startSession();

      await expect(
        writeVisualSessionDescriptor(
          session.paths,
          descriptorFor(session.paths, {
            journalPath: toWireAbsolutePath(join(parent, "x.jsonl")),
          }),
        ),
      ).rejects.toThrow(/YMVS125/);
      expect(existsSync(session.paths.descriptor)).toBe(false);
    });

    it("refuses a descriptor that fails protocol validation", async () => {
      const session = await startSession();

      await expect(
        writeVisualSessionDescriptor(
          session.paths,
          descriptorFor(session.paths, { agentCapability: "short" }),
        ),
      ).rejects.toThrow(/YMVS103/);
      expect(existsSync(session.paths.descriptor)).toBe(false);
    });
  });

  describe("append-only journal", () => {
    it("appends one UTF-8 JSON line per record in call order", async () => {
      const session = await startSession();

      expect(await appendVisualEvent(session.paths, chatEvent)).toMatchObject({
        ok: true,
        lastSequence: 1,
      });
      expect(
        await appendVisualResponse(session.paths, chatResponse),
      ).toMatchObject({ ok: true, lastSequence: 1 });

      expect(
        (await journalLines(session.paths.journal)).map(
          (line) => JSON.parse(line) as unknown,
        ),
      ).toEqual([chatEvent, chatResponse]);
    });

    it("rejects an event whose sequence does not advance", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, { ...chatEvent, sequence: 4 });

      const replay = await appendVisualEvent(session.paths, {
        ...chatEvent,
        sequence: 4,
        eventId: identifier(11),
      });

      expect(replay.ok).toBe(false);
      expect(replay.ok === false && replay.diagnostics[0]?.code).toBe(
        "YMVS121",
      );
      expect(await journalLines(session.paths.journal)).toHaveLength(1);
    });

    it("rejects a replayed event identifier", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);

      const replay = await appendVisualEvent(session.paths, {
        ...chatEvent,
        sequence: 2,
      });

      expect(replay.ok).toBe(false);
      expect(replay.ok === false && replay.diagnostics[0]?.code).toBe(
        "YMVS127",
      );
      expect(await journalLines(session.paths.journal)).toHaveLength(1);
    });

    it("rejects a record belonging to another session", async () => {
      const session = await startSession();

      const foreign = await appendVisualEvent(session.paths, {
        ...chatEvent,
        sessionId: "ab".repeat(16),
      });

      expect(foreign.ok).toBe(false);
      expect(foreign.ok === false && foreign.diagnostics[0]?.code).toBe(
        "YMVS126",
      );
      expect(await journalLines(session.paths.journal)).toHaveLength(0);
    });

    it("rejects a malformed record before it reaches the journal", async () => {
      const session = await startSession();

      const rejected = await appendVisualEvent(session.paths, {
        ...chatEvent,
        payload: { text: "" },
      } as unknown as VisualEvent);

      expect(rejected.ok).toBe(false);
      expect(await journalLines(session.paths.journal)).toHaveLength(0);
    });

    it("rejects a response whose triggering event was never journaled", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);

      const fabricated = await appendVisualResponse(session.paths, {
        ...chatResponse,
        eventId: identifier(0xbad),
      });

      expect(fabricated.ok).toBe(false);
      expect(
        fabricated.ok === false && fabricated.diagnostics[0],
      ).toMatchObject({ code: "YMVS131", pointer: "/eventId" });
      expect(await journalLines(session.paths.journal)).toHaveLength(1);
    });

    /**
     * Every refusal is read back by the one-shot agent clients out of a
     * `visual-diagnostic-result/v1` document, and whatever that document
     * refuses is dropped rather than repaired — so a pointer that is not the
     * RFC 6901 the schema requires costs the caller the code that explains
     * the refusal, and buys a transport error in its place.
     */
    it("mints refusals the one-shot client keeps rather than drops", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);

      const refused = [
        await appendVisualEvent(session.paths, {
          ...chatEvent,
          sessionId: "ab".repeat(16),
        }),
        await appendVisualEvent(session.paths, { ...chatEvent, sequence: 2 }),
        await appendVisualEvent(session.paths, {
          ...chatEvent,
          eventId: identifier(0x5e),
        }),
        await appendVisualResponse(session.paths, {
          ...chatResponse,
          eventId: identifier(0xbad),
        }),
      ];
      await appendVisualEvent(session.paths, endEvent(2, "user-ended"));
      refused.push(
        await appendVisualEvent(session.paths, {
          ...chatEvent,
          sequence: 3,
          eventId: identifier(0x5f),
        }),
      );
      const diagnostics = refused.flatMap((result) =>
        result.ok ? [] : result.diagnostics,
      );

      expect(diagnostics.map(({ code, pointer }) => [code, pointer])).toEqual([
        ["YMVS126", "/sessionId"],
        ["YMVS127", "/eventId"],
        ["YMVS121", "/sequence"],
        ["YMVS131", "/eventId"],
        ["YMVS130", "/type"],
      ]);
      expect(
        parseVisualDiagnosticResult({
          format: "yarramate/visual-diagnostic-result/v1",
          diagnostics,
        }),
      ).toMatchObject({ ok: true });
    });

    it("accepts the handoff that answers a journaled End", async () => {
      const session = await startSession();
      const end = endEvent(1, "user-ended");
      await appendVisualEvent(session.paths, end);

      expect(
        await appendVisualResponse(session.paths, {
          ...handoffResponse,
          eventId: end.eventId,
        }),
      ).toMatchObject({ ok: true, duplicate: false });
      expect(await journalLines(session.paths.journal)).toHaveLength(2);
    });

    it("treats a duplicate response as an accepted no-op", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);
      await appendVisualResponse(session.paths, chatResponse);

      const again = await appendVisualResponse(session.paths, chatResponse);

      expect(again).toMatchObject({ ok: true, duplicate: true });
      expect(await journalLines(session.paths.journal)).toHaveLength(2);
    });

    it("serialises concurrent appends without interleaving lines", async () => {
      const session = await startSession();

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          appendVisualEvent(session.paths, {
            ...chatEvent,
            sequence: index + 1,
            eventId: identifier(index + 20),
          }),
        ),
      );

      expect(results.every((result) => result.ok)).toBe(true);
      const lines = await journalLines(session.paths.journal);
      expect(lines).toHaveLength(8);
      expect(
        lines.map((line) => (JSON.parse(line) as VisualEvent).sequence),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("freezes the session at exactly the 5 MiB transcript limit", async () => {
      const session = await startSession();
      // Every response answers a journaled event, so the event this session
      // opens with is part of the budget the responses then fill.
      await appendVisualEvent(session.paths, chatEvent);
      const opening = Buffer.byteLength(JSON.stringify(chatEvent), "utf8") + 1;
      const filler = "x".repeat(32768);
      const overhead =
        Buffer.byteLength(
          JSON.stringify({ ...chatResponse, payload: { text: "" } }),
          "utf8",
        ) + 1;
      const fullLine = overhead + filler.length;

      const budget = VISUAL_LIMITS.transcriptBytes - opening;
      let count = Math.floor(budget / fullLine);
      let finalText = budget - count * fullLine - overhead;
      if (finalText < 1) {
        count -= 1;
        finalText += fullLine;
      }
      expect(finalText).toBeGreaterThan(0);
      expect(finalText).toBeLessThanOrEqual(VISUAL_LIMITS.messageBytes);

      for (let index = 0; index < count; index += 1) {
        const accepted = await appendVisualResponse(session.paths, {
          ...chatResponse,
          responseId: identifier(1000 + index),
          payload: { text: filler },
        });
        expect(accepted.ok).toBe(true);
      }
      const last = await appendVisualResponse(session.paths, {
        ...chatResponse,
        responseId: identifier(2000),
        payload: { text: "y".repeat(finalText) },
      });

      expect(last).toMatchObject({
        ok: true,
        transcriptBytes: VISUAL_LIMITS.transcriptBytes,
      });
      expect((await stat(session.paths.journal)).size).toBe(
        VISUAL_LIMITS.transcriptBytes,
      );

      const frozen = await appendVisualResponse(session.paths, {
        ...chatResponse,
        responseId: identifier(2001),
        payload: { text: "z" },
      });

      expect(frozen).toMatchObject({ ok: false, freeze: "transcript-bytes" });
      const overflow = frozen.ok === false ? frozen.diagnostics : [];
      expect(overflow[0]).toMatchObject({
        code: "YMVS122",
        pointer: "/payload",
      });
      // The freeze reaches the agent only through the one-shot client's strict
      // read of a diagnostic result, which keeps nothing that document refuses.
      expect(
        parseVisualDiagnosticResult({
          format: "yarramate/visual-diagnostic-result/v1",
          diagnostics: overflow,
        }),
      ).toMatchObject({ ok: true });
      expect((await stat(session.paths.journal)).size).toBe(
        VISUAL_LIMITS.transcriptBytes,
      );
    });
  });

  describe("actionable events", () => {
    it("returns only events after a sequence that need an agent turn", async () => {
      const session = await startSession();
      const records: readonly VisualEvent[] = [
        {
          format: "yarramate/visual-event/v1",
          sessionId,
          sequence: 1,
          eventId: identifier(31),
          type: "browser.connected",
          timestamp: "2026-08-08T00:00:00.500Z",
          payload: { connectionId: "c1" },
        },
        { ...chatEvent, sequence: 2 },
        navigateEvent(3, "choices", false),
        navigateEvent(4, "detail", true),
        {
          format: "yarramate/visual-event/v1",
          sessionId,
          sequence: 5,
          eventId: identifier(35),
          type: "choice.selected",
          timestamp: "2026-08-08T00:00:20.000Z",
          payload: { choiceId: "delivery", optionId: "isolated" },
        },
        endEvent(6, "user-ended"),
      ];
      for (const record of records) {
        expect(await appendVisualEvent(session.paths, record)).toMatchObject({
          ok: true,
        });
      }

      expect(
        (await readActionableEventsAfter(session.paths, 0)).map(
          (event) => event.sequence,
        ),
      ).toEqual([2, 4, 5, 6]);
      expect(
        (await readActionableEventsAfter(session.paths, 4)).map(
          (event) => event.type,
        ),
      ).toEqual(["choice.selected", "session.end"]);
      expect(await readActionableEventsAfter(session.paths, 6)).toEqual([]);
    });
  });

  describe("recovery", () => {
    it("recovers accepted events and the summary without exposing the transcript", async () => {
      const session = await createVisualSession(request, {
        baseDir: parent,
        now: () => new Date("2026-08-08T00:00:00.000Z"),
        randomBytes: () => Buffer.alloc(32, 7),
      });
      await appendVisualEvent(session.paths, chatEvent);
      await appendVisualResponse(session.paths, chatResponse);
      await appendVisualResponse(session.paths, handoffResponse);

      expect(await recoverVisualSession(session.paths, false)).toMatchObject({
        format: "yarramate/visual-handoff/v1",
        summary: handoffResponse.payload.summary,
        transcript: undefined,
        lastSequence: 1,
      });
      expect(await recoverVisualSession(session.paths, true)).toMatchObject({
        transcript: [chatEvent, chatResponse],
      });
    });

    it("reports a completed handoff only when the user ended the session", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);
      await appendVisualResponse(session.paths, handoffResponse);
      await appendVisualEvent(session.paths, endEvent(2, "user-ended"));

      expect(await recoverVisualSession(session.paths)).toMatchObject({
        sessionId,
        authority: "canonical",
        decision: "completed",
        terminationReason: "user-ended",
        lastSequence: 2,
        transcriptPath: session.paths.journal,
        completedAt: "2026-08-08T00:01:00.000Z",
        confirmedDecisions: handoffResponse.payload.confirmedDecisions,
        unresolvedQuestions: handoffResponse.payload.unresolvedQuestions,
        finalViews: ["choices"],
      });
    });

    it("blames the child when the user ended without a submitted handoff", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);
      await appendVisualEvent(session.paths, endEvent(2, "user-ended"));

      expect(await recoverVisualSession(session.paths)).toMatchObject({
        decision: "failed",
        terminationReason: "child-failed",
        lastSequence: 2,
      });
    });

    it("reports a server failure when nothing terminated the session", async () => {
      const session = await startSession();
      await appendVisualEvent(
        session.paths,
        navigateEvent(1, "choices", false),
      );
      await appendVisualEvent(session.paths, navigateEvent(2, "detail", true));

      expect(await recoverVisualSession(session.paths)).toMatchObject({
        decision: "failed",
        terminationReason: "server-failed",
        finalViews: ["choices", "detail"],
        lastSequence: 2,
      });
    });

    it("recovers an empty journal without inventing a summary", async () => {
      const session = await startSession();

      expect(await recoverVisualSession(session.paths)).toMatchObject({
        decision: "failed",
        terminationReason: "server-failed",
        lastSequence: 0,
        completedAt: "2026-08-08T00:00:00.000Z",
        finalViews: [],
      });
    });

    it("ignores a torn final line and resumes the journal after a restart", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);
      await appendFile(
        session.paths.journal,
        '{"format":"yarramate/visual-event/v1","sessi',
      );

      expect(await recoverVisualSession(session.paths, true)).toMatchObject({
        lastSequence: 1,
        transcript: [chatEvent],
      });

      const resumed = await appendVisualEvent(session.paths, {
        ...chatEvent,
        sequence: 2,
        eventId: identifier(41),
      });

      expect(resumed).toMatchObject({ ok: true, lastSequence: 2 });
      expect(
        (await journalLines(session.paths.journal)).map(
          (line) => (JSON.parse(line) as VisualEvent).sequence,
        ),
      ).toEqual([1, 2]);
    });

    it("rejects a malformed complete journal line", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);
      await appendFile(session.paths.journal, '{"format":"nope"}\n');

      await expect(recoverVisualSession(session.paths)).rejects.toThrow(
        /YMVS123/,
      );
    });

    it("rejects a session directory without a valid marker", async () => {
      const unmarked = join(parent, "not-a-session");
      await mkdir(unmarked, { mode: 0o700 });
      await writeFile(join(unmarked, "journal.jsonl"), "", { mode: 0o600 });

      await expect(
        recoverVisualSession(visualSessionPaths(unmarked)),
      ).rejects.toThrow(/YMVS124/);
    });
  });

  describe("model graph construction", () => {
    const source = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: service
    kind: applicationComponent
    name: Payments service
relationships: []
`;
    const sources = [{ path: "main.yaml", source }];

    it("builds the canvas graph a session model renders from its workspace sources", () => {
      const compiled = compileWorkspaceWithProfileContext(sources);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const expectedGraph = projectGraphForCanvas(
        compiled.graph,
        compiled.profileContext,
      );

      expect(buildVisualModelGraph(sources)).toEqual({
        ok: true,
        graph: expectedGraph,
      });
    });

    it("surfaces the workspace compiler diagnostics unchanged on a failed compile", () => {
      const broken = [
        {
          path: "main.yaml",
          source: source.replace("applicationComponent", "mysteryKind"),
        },
      ];
      const compiled = compileWorkspaceWithProfileContext(broken);
      expect(compiled.ok).toBe(false);
      if (compiled.ok) return;

      expect(buildVisualModelGraph(broken)).toEqual({
        ok: false,
        diagnostics: compiled.diagnostics,
      });
    });
  });

  describe("cleanup", () => {
    it("recovers the handoff before deleting the session", async () => {
      const session = await startSession();
      await appendVisualEvent(session.paths, chatEvent);
      await appendVisualResponse(session.paths, handoffResponse);

      const handoff = await removeVisualSession(session.paths, true);

      expect(handoff).toMatchObject({
        summary: handoffResponse.payload.summary,
        transcript: [chatEvent],
      });
      expect(existsSync(session.paths.root)).toBe(false);
    });

    it("reports an already-removed session instead of failing", async () => {
      const session = await startSession();
      await removeVisualSession(session.paths);

      expect(await removeVisualSession(session.paths)).toBeUndefined();
    });

    it("refuses to delete a directory that is not a marked session", async () => {
      const unmarked = join(parent, "precious");
      await mkdir(unmarked, { mode: 0o700 });
      await writeFile(join(unmarked, "notes.md"), "keep me", { mode: 0o600 });

      await expect(
        removeVisualSession(visualSessionPaths(unmarked)),
      ).rejects.toThrow(/YMVS124/);
      expect(existsSync(join(unmarked, "notes.md"))).toBe(true);
    });

    /**
     * Root permissions cannot single out one entry, so the entry that refuses
     * removal is a directory holding a file it will not let go of. What the
     * test is about is the two files beside it: a cleanup that fails part-way
     * must not be the step that loses the handoff, nor the marker that lets a
     * later pass agree to delete what is left.
     */
    const enforcesPermissions =
      process.platform !== "win32" && process.getuid?.() !== 0;

    it.skipIf(!enforcesPermissions)(
      "keeps the journal and marker when another entry's removal fails",
      async () => {
        const session = await startSession();
        await appendVisualEvent(session.paths, chatEvent);
        await appendVisualResponse(session.paths, handoffResponse);
        const stuck = join(session.paths.root, "stuck");
        await mkdir(stuck, { mode: 0o700 });
        await writeFile(join(stuck, "held"), "keep me", { mode: 0o600 });
        await chmod(stuck, 0o500);

        await expect(removeVisualSession(session.paths)).rejects.toThrow();
        expect(existsSync(session.paths.journal)).toBe(true);
        expect(existsSync(session.paths.marker)).toBe(true);

        await chmod(stuck, 0o700);
        const handoff = await removeVisualSession(session.paths, true);

        expect(handoff).toMatchObject({
          summary: handoffResponse.payload.summary,
          transcript: [chatEvent],
        });
        expect(existsSync(session.paths.root)).toBe(false);
      },
    );

    it("removes a marked session whose journal a failed cleanup already took", async () => {
      const session = await startSession();
      await rm(session.paths.journal);

      expect(await removeVisualSession(session.paths)).toBeUndefined();
      expect(existsSync(session.paths.root)).toBe(false);
    });

    it("refuses to delete a session whose marker names another directory", async () => {
      const session = await startSession();
      await writeFile(
        session.paths.marker,
        JSON.stringify({
          format: VISUAL_SESSION_MARKER_FORMAT,
          id: "cd".repeat(16),
          createdAt: "2026-08-08T00:00:00.000Z",
          authority: "canonical",
        }),
      );

      await expect(removeVisualSession(session.paths)).rejects.toThrow(
        /YMVS125/,
      );
      expect(existsSync(session.paths.marker)).toBe(true);
    });
  });

  describe("stale pruning", () => {
    const staleNow = new Date("2026-08-09T00:00:00.001Z");
    const longAgo = "2026-08-01T00:00:00.000Z";
    const withinBudget = "2026-08-08T12:00:00.000Z";

    /**
     * Pins every artefact of a session to one modification time. Staleness is
     * a property of the filesystem rather than of the immutable marker, so a
     * test states activity the same way a live runtime leaves it behind.
     */
    const touchSession = async (paths: VisualSessionPaths, when: string) => {
      const at = new Date(when);
      for (const path of [
        paths.root,
        paths.marker,
        paths.descriptor,
        paths.journal,
      ]) {
        if (existsSync(path)) await utimes(path, at, at);
      }
    };

    it("prunes only marked sessions untouched for longer than 24 hours", async () => {
      const session = await startSession();
      await touchSession(session.paths, longAgo);
      const unmarkedDirectory = join(parent, "unmarked");
      await mkdir(unmarkedDirectory, { mode: 0o700 });
      await utimes(unmarkedDirectory, new Date(longAgo), new Date(longAgo));

      const removed = await pruneStaleVisualSessions(parent, staleNow);

      expect(removed).toEqual([session.paths.root]);
      expect(existsSync(unmarkedDirectory)).toBe(true);
      expect(existsSync(session.paths.root)).toBe(false);
    });

    it("keeps a long-lived session whose journal was appended within the budget", async () => {
      const session = await startSession(longAgo);
      await appendVisualEvent(session.paths, chatEvent);
      await touchSession(session.paths, longAgo);
      const active = new Date(withinBudget);
      await utimes(session.paths.journal, active, active);

      expect(await pruneStaleVisualSessions(parent, staleNow)).toEqual([]);
      expect(existsSync(session.paths.root)).toBe(true);
    });

    it("removes a session no artefact has touched for longer than 24 hours", async () => {
      const session = await startSession();
      await touchSession(session.paths, "2026-08-07T23:59:59.999Z");

      expect(
        await pruneStaleVisualSessions(
          parent,
          new Date("2026-08-09T00:00:00.000Z"),
        ),
      ).toEqual([session.paths.root]);
      expect(existsSync(session.paths.root)).toBe(false);
    });

    it("keeps a session whose newest artefact is exactly 24 hours old", async () => {
      const session = await startSession(longAgo);
      await touchSession(session.paths, "2026-08-08T00:00:00.000Z");

      expect(
        await pruneStaleVisualSessions(
          parent,
          new Date("2026-08-09T00:00:00.000Z"),
        ),
      ).toEqual([]);
      expect(existsSync(session.paths.root)).toBe(true);
    });

    it("never follows a symlink out of the base directory", async () => {
      const outside = await mkdtemp(
        join(tmpdir(), "yarramate-visual-outside-"),
      );
      try {
        // A genuinely stale, correctly marked session, reachable from the base
        // directory only through a symlink: nothing but the lstat check keeps
        // pruning away from it.
        const real = await createVisualSession(request, {
          baseDir: outside,
          now: () => new Date(longAgo),
          randomBytes: (size) => Buffer.alloc(size, 0xab),
        });
        await touchSession(real.paths, longAgo);
        const link = join(parent, basename(real.paths.root));
        await symlink(real.paths.root, link);
        await writeFile(join(parent, "stray.json"), "ignored");

        expect(await pruneStaleVisualSessions(parent, staleNow)).toEqual([]);
        expect(existsSync(link)).toBe(true);
        expect(existsSync(real.paths.marker)).toBe(true);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("bounds how many stale sessions one pass removes, oldest activity first", async () => {
      const roots: string[] = [];
      for (let index = 1; index <= 3; index += 1) {
        const created = await createVisualSession(request, {
          baseDir: parent,
          now: () => new Date(`2026-08-0${index}T00:00:00.000Z`),
          randomBytes: (size) => Buffer.alloc(size, index),
        });
        await touchSession(created.paths, `2026-08-0${index}T00:00:00.000Z`);
        roots.push(created.paths.root);
      }

      const removed = await pruneStaleVisualSessions(parent, staleNow, 2);

      expect(removed).toEqual([roots[0], roots[1]]);
      expect(existsSync(roots[2] as string)).toBe(true);
      expect(VISUAL_SESSION_PRUNE_LIMIT).toBeGreaterThan(0);
    });
  });
});
