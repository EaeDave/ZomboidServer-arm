import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  agentRealtimeInboundSchema,
  type AgentCapability,
  type AgentRealtimeInbound,
  type AgentRealtimeExecute,
  type DirectCommandRequest,
  type DirectCommandResponse,
} from "@zomboid/contracts";

export interface RealtimeSocket {
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}

type PendingCommand = {
  serverId: string;
  capabilityId: string;
  startedAt: number;
  resolve: (response: DirectCommandResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type AgentConnection = {
  socket: RealtimeSocket;
  capabilities: AgentCapability[];
  connectedAt: number;
};

export class RealtimeAgentUnavailableError extends Error {
  constructor(message = "The realtime host agent is not connected") {
    super(message);
    this.name = "RealtimeAgentUnavailableError";
  }
}

export class RealtimeCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeCapabilityError";
  }
}

export class RealtimeCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealtimeCommandError";
  }
}

export class RealtimeBroker {
  private readonly connections = new Map<string, AgentConnection>();
  private readonly pending = new Map<string, PendingCommand>();
  private static readonly maxPendingPerServer = 32;

  connect(serverId: string, socket: RealtimeSocket) {
    const previous = this.connections.get(serverId);
    if (previous && previous.socket !== socket) {
      this.rejectPending(
        serverId,
        new RealtimeAgentUnavailableError("The realtime host agent reconnected"),
      );
      previous.socket.close(1012, "Replaced by a new agent connection");
    }
    this.connections.set(serverId, { socket, capabilities: [], connectedAt: Date.now() });
  }

  disconnect(serverId: string, socket: RealtimeSocket) {
    if (this.connections.get(serverId)?.socket !== socket) return;
    this.connections.delete(serverId);
    this.rejectPending(
      serverId,
      new RealtimeAgentUnavailableError("The realtime host agent disconnected"),
    );
  }

  private rejectPending(serverId: string, error: Error) {
    for (const [requestId, command] of this.pending) {
      if (command.serverId !== serverId) continue;
      clearTimeout(command.timer);
      command.reject(error);
      this.pending.delete(requestId);
    }
  }

  receive(serverId: string, socket: RealtimeSocket, value: unknown) {
    if (this.connections.get(serverId)?.socket !== socket) return;
    if (!Value.Check(agentRealtimeInboundSchema, value)) {
      socket.close(1008, "Invalid realtime protocol message");
      return;
    }
    const message = value as AgentRealtimeInbound;
    if (message.type === "agent.hello") {
      if (message.serverId !== serverId) {
        socket.close(1008, "Server identity mismatch");
        return;
      }
      const connection = this.connections.get(serverId);
      if (connection) connection.capabilities = message.capabilities;
      return;
    }
    const command = this.pending.get(message.requestId);
    if (!command || command.serverId !== serverId) return;
    clearTimeout(command.timer);
    this.pending.delete(message.requestId);
    if (!message.ok) {
      command.reject(new RealtimeCommandError(message.error ?? "Host command failed"));
      return;
    }
    command.resolve({
      requestId: message.requestId,
      capabilityId: command.capabilityId,
      durationMs: Math.max(0, Date.now() - command.startedAt),
      result: message.result ?? null,
    });
  }

  capabilities(serverId: string) {
    const connection = this.connections.get(serverId);
    return {
      protocolVersion: 1 as const,
      connected: Boolean(connection),
      capabilities: connection?.capabilities ?? [],
    };
  }

  capability(serverId: string, capabilityId: string) {
    return this.connections
      .get(serverId)
      ?.capabilities.find((capability) => capability.id === capabilityId);
  }

  execute(
    serverId: string,
    request: DirectCommandRequest,
    actorRole: AgentCapability["role"],
    timeoutMs = 15_000,
  ) {
    const connection = this.connections.get(serverId);
    if (!connection) return Promise.reject(new RealtimeAgentUnavailableError());
    let pendingForServer = 0;
    for (const command of this.pending.values()) {
      if (command.serverId === serverId) pendingForServer += 1;
    }
    if (pendingForServer >= RealtimeBroker.maxPendingPerServer) {
      return Promise.reject(
        new RealtimeAgentUnavailableError("Too many realtime commands are already in flight"),
      );
    }
    const capability = connection.capabilities.find((item) => item.id === request.capabilityId);
    if (!capability) {
      return Promise.reject(
        new RealtimeCapabilityError("The host does not advertise this capability"),
      );
    }
    if (capability.mode !== "direct") {
      return Promise.reject(
        new RealtimeCapabilityError("This capability must run as a durable job"),
      );
    }
    const requestId = randomUUID();
    const message: AgentRealtimeExecute = {
      type: "command.execute",
      requestId,
      capabilityId: request.capabilityId,
      input: request.input,
      actorRole,
      timeoutMs,
    };
    return new Promise<DirectCommandResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new RealtimeAgentUnavailableError("The host did not answer the realtime command in time"),
        );
      }, timeoutMs + 1_000);
      this.pending.set(requestId, {
        serverId,
        capabilityId: request.capabilityId,
        startedAt: Date.now(),
        resolve,
        reject,
        timer,
      });
      try {
        connection.socket.send(JSON.stringify(message));
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new RealtimeAgentUnavailableError("The realtime command could not be sent"));
      }
    });
  }
}
