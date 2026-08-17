import { describe, expect, it, jest } from "bun:test";
import type { AgentCapability } from "@zomboid/contracts";
import {
  RealtimeAgentUnavailableError,
  RealtimeBroker,
  RealtimeCapabilityError,
  RealtimeCommandError,
} from "./realtime-broker";

const capabilities: AgentCapability[] = [
  {
    id: "server.status",
    title: "Server status",
    description: "Read status",
    category: "Server",
    mode: "direct",
    role: "viewer",
    arguments: [],
    effects: ["read"],
  },
];

class FakeSocket {
  readonly sent: string[] = [];
  closed?: { code?: number; reason?: string };

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }

  take(index = 0) {
    const message = this.sent[index];
    if (message === undefined) throw new Error(`No outbound message at index ${index}`);
    return JSON.parse(message) as { requestId: string; capabilityId: string };
  }
}

function connect(broker: RealtimeBroker, socket: FakeSocket) {
  broker.connect("production", socket);
  broker.receive("production", socket, {
    type: "agent.hello",
    protocolVersion: 1,
    serverId: "production",
    capabilities,
  });
}

describe("RealtimeBroker", () => {
  it("correlates concurrent responses even when they complete out of order", async () => {
    const broker = new RealtimeBroker();
    const socket = new FakeSocket();
    connect(broker, socket);

    const first = broker.execute(
      "production",
      { capabilityId: "server.status", input: {} },
      "viewer",
    );
    const second = broker.execute(
      "production",
      { capabilityId: "server.status", input: {} },
      "viewer",
    );
    const firstMessage = socket.take(0);
    const secondMessage = socket.take(1);

    broker.receive("production", socket, {
      type: "command.result",
      requestId: secondMessage.requestId,
      ok: true,
      result: { output: "second" },
    });
    broker.receive("production", socket, {
      type: "command.result",
      requestId: firstMessage.requestId,
      ok: true,
      result: { output: "first" },
    });

    expect((await first).result).toEqual({ output: "first" });
    expect((await second).result).toEqual({ output: "second" });
  });

  it("rejects pending commands when the agent disconnects", async () => {
    const broker = new RealtimeBroker();
    const socket = new FakeSocket();
    connect(broker, socket);
    const pending = broker.execute(
      "production",
      { capabilityId: "server.status", input: {} },
      "viewer",
    );

    broker.disconnect("production", socket);

    await expect(pending).rejects.toBeInstanceOf(RealtimeAgentUnavailableError);
    expect(broker.capabilities("production")).toEqual({
      protocolVersion: 1,
      connected: false,
      capabilities: [],
    });
  });

  it("rejects commands bound to a connection that gets replaced", async () => {
    const broker = new RealtimeBroker();
    const firstSocket = new FakeSocket();
    const replacement = new FakeSocket();
    connect(broker, firstSocket);
    const pending = broker.execute(
      "production",
      { capabilityId: "server.status", input: {} },
      "viewer",
    );

    broker.connect("production", replacement);

    await expect(pending).rejects.toMatchObject({
      message: "The realtime host agent reconnected",
    });
    expect(firstSocket.closed).toEqual({
      code: 1012,
      reason: "Replaced by a new agent connection",
    });
  });

  it("times out commands and ignores a late response", async () => {
    jest.useFakeTimers();
    try {
      const broker = new RealtimeBroker();
      const socket = new FakeSocket();
      connect(broker, socket);
      const pending = broker.execute(
        "production",
        { capabilityId: "server.status", input: {} },
        "viewer",
        1_000,
      );
      const message = socket.take();

      jest.advanceTimersByTime(2_001);
      await expect(pending).rejects.toMatchObject({
        message: "The host did not answer the realtime command in time",
      });
      expect(() =>
        broker.receive("production", socket, {
          type: "command.result",
          requestId: message.requestId,
          ok: true,
          result: { output: "late" },
        }),
      ).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounds pending commands per server", async () => {
    const broker = new RealtimeBroker();
    const socket = new FakeSocket();
    connect(broker, socket);
    const pending = Array.from({ length: 32 }, () =>
      broker.execute("production", { capabilityId: "server.status", input: {} }, "viewer"),
    );

    await expect(
      broker.execute("production", { capabilityId: "server.status", input: {} }, "viewer"),
    ).rejects.toMatchObject({
      message: "Too many realtime commands are already in flight",
    });
    broker.disconnect("production", socket);
    const settled = await Promise.allSettled(pending);
    expect(settled.every((result) => result.status === "rejected")).toBe(true);
  });

  it("surfaces structured agent failures", async () => {
    const broker = new RealtimeBroker();
    const socket = new FakeSocket();
    connect(broker, socket);
    const pending = broker.execute(
      "production",
      { capabilityId: "server.status", input: {} },
      "viewer",
    );
    const message = socket.take();

    broker.receive("production", socket, {
      type: "command.result",
      requestId: message.requestId,
      ok: false,
      error: "host command failed",
    });

    await expect(pending).rejects.toBeInstanceOf(RealtimeCommandError);
  });

  it("rejects invalid registration frames and unavailable direct capabilities", async () => {
    const broker = new RealtimeBroker();
    const invalidSocket = new FakeSocket();
    broker.connect("production", invalidSocket);
    broker.receive("production", invalidSocket, { type: "invalid" });
    expect(invalidSocket.closed?.code).toBe(1008);

    const mismatchSocket = new FakeSocket();
    broker.connect("production", mismatchSocket);
    broker.receive("production", mismatchSocket, {
      type: "agent.hello",
      protocolVersion: 1,
      serverId: "staging",
      capabilities,
    });
    expect(mismatchSocket.closed?.code).toBe(1008);

    const socket = new FakeSocket();
    connect(broker, socket);
    await expect(
      broker.execute("production", { capabilityId: "config.read", input: {} }, "operator"),
    ).rejects.toBeInstanceOf(RealtimeCapabilityError);

    broker.receive("production", socket, {
      type: "agent.hello",
      protocolVersion: 1,
      serverId: "production",
      capabilities: [
        {
          ...capabilities[0]!,
          id: "server.start",
          mode: "job",
          operationKind: "start",
        },
      ],
    });
    await expect(
      broker.execute("production", { capabilityId: "server.start", input: {} }, "operator"),
    ).rejects.toBeInstanceOf(RealtimeCapabilityError);
  });
});
