import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  agentOperationRequestSchema,
  agentRealtimeInboundSchema,
  agentRealtimeExecuteSchema,
  directCommandRequestSchema,
  agentOperationResponseSchema,
  agentJobCompleteRequestSchema,
  agentConsoleLogRequestSchema,
  operationCreateRequestSchema,
  configSnapshotSchema,
  modsUpdateApplyResultSchema,
  modsUpdateCheckResultSchema,
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

  it("accepts bounded direct commands and the realtime wire protocol", () => {
    expect(
      Value.Check(directCommandRequestSchema, {
        capabilityId: "rcon.servermsg",
        input: { message: "Maintenance soon" },
      }),
    ).toBe(true);
    expect(
      Value.Check(agentRealtimeExecuteSchema, {
        type: "command.execute",
        requestId: "request-1",
        capabilityId: "rcon.players",
        input: {},
        actorRole: "viewer",
        timeoutMs: 15_000,
      }),
    ).toBe(true);
    expect(
      Value.Check(agentRealtimeInboundSchema, {
        type: "command.result",
        requestId: "request-1",
        ok: true,
        result: { output: "Players connected (0)" },
      }),
    ).toBe(true);
    expect(
      Value.Check(agentRealtimeInboundSchema, {
        type: "command.result",
        requestId: "",
        ok: true,
      }),
    ).toBe(false);
  });

  it("accepts workshop update operations and bounded results", () => {
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.update.check",
        payload: {},
      }),
    ).toBe(true);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.update.apply",
        payload: { restart: true, requireEmpty: true },
      }),
    ).toBe(true);
    expect(
      Value.Check(operationCreateRequestSchema, {
        kind: "mods.update.apply",
        payload: { command: "restart" },
      }),
    ).toBe(false);
    expect(
      Value.Check(modsUpdateCheckResultSchema, {
        status: "updates_available",
        checkedAt: "2026-08-17T00:00:00Z",
        trackedCount: 1,
        updates: [
          {
            workshopId: "1234567",
            title: "Example mod",
            storedUpdatedAt: 100,
            availableUpdatedAt: 200,
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(modsUpdateApplyResultSchema, {
        status: "partial",
        updated: [{ workshopId: "1234567", title: "Example mod" }],
        failed: [],
        backupCreated: true,
        backupPath: "/backups/modup.tar.gz",
        restartRequested: true,
        restarted: true,
        playerCount: 0,
      }),
    ).toBe(true);
  });

  it("accepts successful responses for every non-status operation", () => {
    for (const kind of [
      "start",
      "stop",
      "restart",
      "build.update",
      "backup",
      "mods.list",
      "mods.add",
      "mods.remove",
      "mods.configure",
      "mods.update.check",
      "mods.update.apply",
      "settings.read",
      "settings.update",
      "config.read",
      "config.update",
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
