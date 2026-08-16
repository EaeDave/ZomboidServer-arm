import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  agentOperationRequestSchema,
  agentOperationResponseSchema,
  operationCreateRequestSchema,
  worldResetOperationRequestSchema,
} from "./index";

describe("agent operation contracts", () => {
  it("accepts a confirmed world reset request", () => {
    expect(
      Value.Check(worldResetOperationRequestSchema, {
        protocolVersion: 1,
        requestId: "request-1",
        serverId: "production",
        kind: "world.reset",
        payload: {
          confirm: true,
          createBackup: true,
        },
      }),
    ).toBe(true);
  });

  it("accepts only allowlisted operation payloads", () => {
    expect(Value.Check(operationCreateRequestSchema, { kind: "start", payload: {} })).toBe(true);
    expect(
      Value.Check(operationCreateRequestSchema, { kind: "logs", payload: { lines: 100 } }),
    ).toBe(true);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "restart",
        payload: { command: "rm -rf /" },
      }),
    ).toBe(false);
  });

  it("accepts a status success and a bounded error response", () => {
    expect(
      Value.Check(agentOperationResponseSchema, {
        protocolVersion: 1,
        requestId: "request-3",
        serverId: "production",
        kind: "status",
        ok: true,
        data: {
          protocolVersion: 1,
          serverId: "production",
          serviceName: "zomboid-b42",
          state: "active",
          substate: "running",
          listening: true,
          runtime: "fex",
          gameVersion: "42.20.2",
          uptimeSeconds: 30,
          playerCount: 0,
          checkedAt: "2026-08-16T00:00:00Z",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(agentOperationResponseSchema, {
        protocolVersion: 1,
        requestId: "request-4",
        serverId: "production",
        kind: "restart",
        ok: false,
        error: { code: "operation_disabled", message: "only status is enabled" },
      }),
    ).toBe(true);
  });

  it("rejects an unconfirmed world reset request", () => {
    expect(
      Value.Check(agentOperationRequestSchema, {
        protocolVersion: 1,
        requestId: "request-2",
        serverId: "production",
        kind: "world.reset",
        payload: {
          confirm: false,
        },
      }),
    ).toBe(false);
  });
});
