import { describe, expect, it, vi } from "bun:test";
import type { AgentCapability } from "@zomboid/contracts";
import {
  RealtimeAgentUnavailableError,
  RealtimeBroker,
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
    vi.useFakeTimers();
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

      vi.advanceTimersByTime(2_001);
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
      vi.useRealTimers();
    }
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
});
