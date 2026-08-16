import { Type, type Static } from "@sinclair/typebox";

export const healthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
  service: Type.Literal("zomboid-control-plane"),
  version: Type.String(),
});

export type HealthResponse = Static<typeof healthResponseSchema>;

export const databaseHealthResponseSchema = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("not_configured"), Type.Literal("error")]),
  service: Type.Literal("postgresql"),
});

export type DatabaseHealthResponse = Static<typeof databaseHealthResponseSchema>;

export const operationKinds = [
  "status",
  "start",
  "stop",
  "restart",
  "logs",
  "backup",
  "mods.list",
  "mods.add",
  "mods.remove",
  "settings.update",
  "world.reset",
] as const;

export type OperationKind = (typeof operationKinds)[number];

export const operationKindSchema = Type.Union([
  Type.Literal("status"),
  Type.Literal("start"),
  Type.Literal("stop"),
  Type.Literal("restart"),
  Type.Literal("logs"),
  Type.Literal("backup"),
  Type.Literal("mods.list"),
  Type.Literal("mods.add"),
  Type.Literal("mods.remove"),
  Type.Literal("settings.update"),
  Type.Literal("world.reset"),
]);

export const agentRuntimeSchema = Type.Union([
  Type.Literal("fex"),
  Type.Literal("box64"),
  Type.Literal("unknown"),
]);

export const agentServiceStateSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("inactive"),
  Type.Literal("failed"),
  Type.Literal("unknown"),
]);

export const agentStatusSchema = Type.Object({
  protocolVersion: Type.Literal(1),
  serverId: Type.String({ minLength: 1 }),
  serviceName: Type.String({ minLength: 1 }),
  state: agentServiceStateSchema,
  substate: Type.Union([Type.String(), Type.Null()]),
  listening: Type.Boolean(),
  runtime: agentRuntimeSchema,
  gameVersion: Type.Union([Type.String(), Type.Null()]),
  uptimeSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  playerCount: Type.Integer({ minimum: -1 }),
  checkedAt: Type.String({ minLength: 1 }),
});

export type AgentStatus = Static<typeof agentStatusSchema>;

const emptyPayloadSchema = Type.Object({});

const operationBaseSchema = {
  protocolVersion: Type.Literal(1),
  requestId: Type.String({ minLength: 1 }),
  serverId: Type.String({ minLength: 1 }),
};

export const statusOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("status"),
  payload: emptyPayloadSchema,
});

export const startOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("start"),
  payload: emptyPayloadSchema,
});

export const stopOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("stop"),
  payload: emptyPayloadSchema,
});

export const restartOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("restart"),
  payload: emptyPayloadSchema,
});

export const logsOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("logs"),
  payload: Type.Object({
    lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  }),
});

export const backupOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("backup"),
  payload: Type.Object({
    keep: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
});

export const modsListOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("mods.list"),
  payload: emptyPayloadSchema,
});

export const modsAddOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("mods.add"),
  payload: Type.Object({
    workshopId: Type.String({ pattern: "^[0-9]{6,20}$" }),
  }),
});

export const modsRemoveOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("mods.remove"),
  payload: Type.Object({
    modIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      minItems: 1,
      maxItems: 100,
    }),
  }),
});

export const settingsUpdateOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("settings.update"),
  payload: Type.Object({
    public: Type.Optional(Type.Boolean()),
    publicName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    password: Type.Optional(Type.String({ maxLength: 128 })),
    defaultPort: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
    udpPort: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
  }),
});

export const worldResetOperationRequestSchema = Type.Object({
  ...operationBaseSchema,
  kind: Type.Literal("world.reset"),
  payload: Type.Object({
    confirm: Type.Literal(true),
    createBackup: Type.Optional(Type.Boolean()),
  }),
});

export const agentOperationRequestSchema = Type.Union([
  statusOperationRequestSchema,
  startOperationRequestSchema,
  stopOperationRequestSchema,
  restartOperationRequestSchema,
  logsOperationRequestSchema,
  backupOperationRequestSchema,
  modsListOperationRequestSchema,
  modsAddOperationRequestSchema,
  modsRemoveOperationRequestSchema,
  settingsUpdateOperationRequestSchema,
  worldResetOperationRequestSchema,
]);

export type AgentOperationRequest = Static<typeof agentOperationRequestSchema>;

export const statusOperationResponseSchema = Type.Object({
  protocolVersion: Type.Literal(1),
  requestId: Type.String(),
  serverId: Type.String(),
  kind: Type.Literal("status"),
  ok: Type.Literal(true),
  data: agentStatusSchema,
});

export const agentErrorResponseSchema = Type.Object({
  protocolVersion: Type.Literal(1),
  requestId: Type.String(),
  serverId: Type.String(),
  kind: Type.String(),
  ok: Type.Literal(false),
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
  }),
});

export const agentOperationResponseSchema = Type.Union([
  statusOperationResponseSchema,
  agentErrorResponseSchema,
]);

export type AgentOperationResponse = Static<typeof agentOperationResponseSchema>;

export const queuedOperationResponseSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  status: Type.Literal("queued"),
});

export type QueuedOperationResponse = Static<typeof queuedOperationResponseSchema>;
