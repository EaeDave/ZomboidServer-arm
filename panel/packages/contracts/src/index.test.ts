import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  agentOperationRequestSchema,
  agentOperationResponseSchema,
  agentJobCompleteRequestSchema,
  agentConsoleLogRequestSchema,
  operationCreateRequestSchema,
  configSnapshotSchema,
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
    expect(Value.Check(operationCreateRequestSchema, { kind: "settings.read", payload: {} })).toBe(
      false,
    );
    expect(
      Value.Check(operationCreateRequestSchema, { kind: "logs", payload: { lines: 100 } }),
    ).toBe(false);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "restart",
        payload: { command: "rm -rf /" },
      }),
    ).toBe(false);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "config.update",
        payload: {
          expectedRevision: "a".repeat(64),
          createBackup: false,
          changes: [{ source: "server", path: "SleepAllowed", value: true }],
        },
      }),
    ).toBe(false);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "config.update",
        payload: { expectedRevision: "a".repeat(64), changes: [] },
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

  it("rejects unknown agent request fields and invalid mod ids", () => {
    expect(
      Value.Check(agentOperationRequestSchema, {
        protocolVersion: 1,
        requestId: "request-extra",
        serverId: "production",
        kind: "status",
        payload: { lines: 10, command: "tail" },
      }),
    ).toBe(false);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.remove",
        payload: { modIds: ["bad/id"] },
      }),
    ).toBe(false);
  });

  it("accepts successful responses for every non-status operation", () => {
    for (const kind of [
      "start",
      "stop",
      "restart",
      "backup",
      "mods.list",
      "mods.add",
      "mods.remove",
      "settings.update",
      "world.reset",
    ]) {
      expect(
        Value.Check(agentOperationResponseSchema, {
          protocolVersion: 1,
          requestId: `request-${kind}`,
          serverId: "production",
          kind,
          ok: true,
          data: { accepted: true },
        }),
      ).toBe(true);
    }
  });

  it("accepts only bounded typed console deltas", () => {
    expect(
      Value.Check(agentConsoleLogRequestSchema, {
        serverId: "production",
        cursor: 2,
        lines: ["line one", "line two"],
      }),
    ).toBe(true);
    expect(
      Value.Check(agentConsoleLogRequestSchema, {
        serverId: "production",
        cursor: 0,
        lines: ["line", "extra"],
      }),
    ).toBe(false);
    expect(
      Value.Check(agentConsoleLogRequestSchema, {
        serverId: "production",
        cursor: 201,
        lines: Array.from({ length: 201 }, () => "line"),
      }),
    ).toBe(false);
    expect(
      Value.Check(agentConsoleLogRequestSchema, {
        serverId: "production",
        cursor: 1,
        lines: ["x".repeat(2049)],
      }),
    ).toBe(false);
    expect(
      Value.Check(agentConsoleLogRequestSchema, {
        serverId: "production",
        cursor: 1,
        lines: ["line"],
        command: "tail -f",
      }),
    ).toBe(false);
  });

  it("rejects a completion containing both result and error", () => {
    expect(
      Value.Check(agentJobCompleteRequestSchema, {
        status: "succeeded",
        result: { ok: true },
        error: "should not be present",
      }),
    ).toBe(false);
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

  it("accepts bounded structured configuration snapshots and updates", () => {
    expect(
      Value.Check(configSnapshotSchema, {
        revision: "a".repeat(64),
        generatedAt: "2026-08-17T00:00:00Z",
        warnings: [],
        fields: [
          {
            source: "server",
            path: "SleepAllowed",
            label: "Permitir dormir",
            category: "sleep",
            categoryLabel: "Sono e passagem do tempo",
            type: "boolean",
            value: false,
            configured: true,
            description: "Permite dormir no multiplayer.",
            editable: true,
            sensitive: false,
            requiresRestart: true,
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "config.update",
        payload: {
          expectedRevision: "a".repeat(64),
          createBackup: true,
          changes: [{ source: "server", path: "SleepAllowed", value: true }],
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "config.update",
        payload: {
          expectedRevision: "invalid",
          changes: [{ source: "server", path: "SleepAllowed", value: true }],
        },
      }),
    ).toBe(false);
  });

  it("accepts a complete and deduplicated mod configuration payload shape", () => {
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.configure",
        payload: { activeModIds: ["Alpha", "Beta"], inactiveModIds: ["Gamma"] },
      }),
    ).toBe(true);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.configure",
        payload: { activeModIds: ["bad/id"], inactiveModIds: [] },
      }),
    ).toBe(false);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.configure",
        payload: { activeModIds: ["Alpha", "Alpha"], inactiveModIds: [] },
      }),
    ).toBe(false);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.configure",
        payload: { activeModIds: [], inactiveModIds: ["Alpha", "Alpha"] },
      }),
    ).toBe(false);
  });
});
