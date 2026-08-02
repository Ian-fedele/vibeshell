import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentSession } from "../agent/index.js";
import type { Checkpointer } from "./checkpoint.js";
import type { EngineEvent } from "./protocol.js";
import { SessionManager, type CreateSessionFn } from "./manager.js";

/** A controllable fake session that yields a fixed script, then completes. */
function makeFake(script: AgentEvent[]): {
  session: AgentSession;
  sent: string[];
  isClosed: () => boolean;
} {
  const sent: string[] = [];
  let closed = false;
  let release!: () => void;
  const untilClosed = new Promise<void>((r) => (release = r));
  const session: AgentSession = {
    send: (text) => {
      sent.push(text);
    },
    close: () => {
      closed = true;
      release();
    },
    interrupt: async () => {},
    respondPermission: () => {},
    events: (async function* () {
      for (const event of script) yield event;
      await untilClosed; // stay open until closed, like a real session
    })(),
  };
  return { session, sent, isClosed: () => closed };
}

/** A checkpointer that never captures anything (keeps unit tests off git). */
const noCheckpoint: Checkpointer = {
  snapshot: async () => null,
  restore: async () => true,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("SessionManager", () => {
  it("emits session_created, tagged agent events, then session_closed", async () => {
    const events: EngineEvent[] = [];
    let resolve!: () => void;
    const finished = new Promise<void>((r) => (resolve = r));
    const script: AgentEvent[] = [
      { type: "text", text: "hi" },
      { type: "result", ok: true, durationMs: 1000, tokens: 1200 },
    ];
    const createSession: CreateSessionFn = () => makeFake(script).session;
    const mgr = new SessionManager({
      createSession,
      checkpointer: noCheckpoint,
      onEvent: (e) => {
        events.push(e);
        if (e.type === "session_closed") resolve();
      },
    });

    mgr.handleCommand({
      type: "create_session",
      requestId: "r1",
      provider: "fake",
      model: "m",
      cwd: "/",
    });
    const sessionId = (events[0] as { sessionId: string }).sessionId;
    await tick(); // let the script events pump through
    mgr.handleCommand({ type: "close_session", sessionId }); // end the stream
    await finished;

    expect(events[0]).toEqual({
      type: "session_created",
      requestId: "r1",
      sessionId: expect.any(String),
    });
    expect(events).toContainEqual({
      type: "agent_event",
      sessionId,
      event: { type: "text", text: "hi" },
    });
    expect(events.at(-1)).toEqual({ type: "session_closed", sessionId });
  });

  it("routes send_message to the correct session", () => {
    const fake = makeFake([]);
    const mgr = new SessionManager({
      createSession: () => fake.session,
      checkpointer: noCheckpoint,
      onEvent: () => {},
    });
    const sessionId = mgr.create("fake", { model: "m", cwd: "/" });
    mgr.handleCommand({ type: "send_message", sessionId, text: "hello" });
    expect(fake.sent).toEqual(["hello"]);
  });

  it("snapshots before a turn and emits a checkpoint event", async () => {
    const events: EngineEvent[] = [];
    const fake = makeFake([]);
    const checkpointer: Checkpointer = {
      snapshot: async () => "tree1",
      restore: async () => true,
    };
    const mgr = new SessionManager({
      createSession: () => fake.session,
      checkpointer,
      onEvent: (e) => events.push(e),
    });
    const sessionId = mgr.create("fake", { model: "m", cwd: "/repo" });
    mgr.handleCommand({ type: "send_message", sessionId, text: "hi" });
    await tick();
    expect(events).toContainEqual({ type: "checkpoint", sessionId, available: true });
    expect(fake.sent).toEqual(["hi"]);
  });

  it("undo restores the last checkpoint and clears availability", async () => {
    const events: EngineEvent[] = [];
    const fake = makeFake([]);
    let restored: string | null = null;
    let checkpointReady!: () => void;
    const ready = new Promise<void>((r) => (checkpointReady = r));
    const checkpointer: Checkpointer = {
      snapshot: async () => "tree1",
      restore: async (_cwd, tree) => {
        restored = tree;
        return true;
      },
    };
    const mgr = new SessionManager({
      createSession: () => fake.session,
      checkpointer,
      onEvent: (e) => {
        events.push(e);
        if (e.type === "checkpoint" && e.available) checkpointReady();
      },
    });
    const sessionId = mgr.create("fake", { model: "m", cwd: "/repo" });
    mgr.handleCommand({ type: "send_message", sessionId, text: "hi" });
    await ready; // the snapshot has landed
    mgr.handleCommand({ type: "undo", sessionId });
    await tick();
    expect(restored).toBe("tree1");
    expect(events).toContainEqual({ type: "checkpoint", sessionId, available: false });
  });

  it("undo with nothing to restore emits an error", async () => {
    const events: EngineEvent[] = [];
    const mgr = new SessionManager({
      createSession: () => makeFake([]).session,
      checkpointer: noCheckpoint,
      onEvent: (e) => events.push(e),
    });
    const sessionId = mgr.create("fake", { model: "m", cwd: "/" });
    mgr.handleCommand({ type: "undo", sessionId });
    await tick();
    expect(events).toContainEqual({
      type: "error",
      message: "Nothing to undo",
      sessionId,
    });
  });

  it("closes a session on close_session", () => {
    const fake = makeFake([]);
    const mgr = new SessionManager({
      createSession: () => fake.session,
      checkpointer: noCheckpoint,
      onEvent: () => {},
    });
    const sessionId = mgr.create("fake", { model: "m", cwd: "/" });
    mgr.handleCommand({ type: "close_session", sessionId });
    expect(fake.isClosed()).toBe(true);
  });

  it("emits an error for a command against an unknown session", () => {
    const events: EngineEvent[] = [];
    const mgr = new SessionManager({
      createSession: () => makeFake([]).session,
      checkpointer: noCheckpoint,
      onEvent: (e) => events.push(e),
    });
    mgr.handleCommand({ type: "send_message", sessionId: "nope", text: "x" });
    expect(events).toContainEqual({
      type: "error",
      message: expect.stringContaining("nope"),
      sessionId: "nope",
      requestId: undefined,
    });
  });
});
