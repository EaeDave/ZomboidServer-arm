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

export const authUserSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  email: Type.String({ minLength: 3, maxLength: 320 }),
  role: Type.Union([Type.Literal("admin"), Type.Literal("operator"), Type.Literal("viewer")]),
});

export type AuthUser = Static<typeof authUserSchema>;

export const authLoginRequestSchema = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 320 }),
  password: Type.String({ minLength: 1, maxLength: 256 }),
});

export type AuthLoginRequest = Static<typeof authLoginRequestSchema>;

export const authSessionResponseSchema = Type.Object({
  user: authUserSchema,
  expiresAt: Type.String({ minLength: 1 }),
});

export const authMeResponseSchema = Type.Object({
  user: authUserSchema,
});

export const authLogoutResponseSchema = Type.Object({
  ok: Type.Literal(true),
});

export const authErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  }),
});

export const auditEventSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  action: Type.String({ minLength: 1 }),
  actorUserId: Type.Union([Type.String(), Type.Null()]),
  agentId: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Union([Type.Unknown(), Type.Null()]),
  createdAt: Type.String({ minLength: 1 }),
});

export const auditListResponseSchema = Type.Object({
  events: Type.Array(auditEventSchema),
});

export type AuditEvent = Static<typeof auditEventSchema>;

export type AuthErrorResponse = Static<typeof authErrorResponseSchema>;

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

export const agentServerConfigSchema = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 128 }),
  serviceName: Type.String({ minLength: 1, maxLength: 128 }),
  port: Type.Integer({ minimum: 1024, maximum: 65535 }),
  runtime: agentRuntimeSchema,
  dataDir: Type.String({ minLength: 1, maxLength: 512 }),
});

export const agentEnrollmentRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  enrollmentToken: Type.String({ minLength: 1, maxLength: 512 }),
  server: agentServerConfigSchema,
});

export type AgentServerConfig = Static<typeof agentServerConfigSchema>;
export type AgentEnrollmentRequest = Static<typeof agentEnrollmentRequestSchema>;

export const agentEnrollmentResponseSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }),
  accessToken: Type.String({ minLength: 1 }),
});

export const agentHeartbeatRequestSchema = Type.Object({
  status: agentStatusSchema,
});

export type AgentHeartbeatRequest = Static<typeof agentHeartbeatRequestSchema>;

export const agentHeartbeatResponseSchema = Type.Object({
  ok: Type.Literal(true),
});

export const agentOperationErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  }),
});

const closedObjectOptions = { additionalProperties: false } as const;
const emptyPayloadSchema = Type.Object({}, closedObjectOptions);

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

export const operationStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const operationCreateRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal("status"), payload: emptyPayloadSchema }, closedObjectOptions),
  Type.Object({ kind: Type.Literal("start"), payload: emptyPayloadSchema }, closedObjectOptions),
  Type.Object({ kind: Type.Literal("stop"), payload: emptyPayloadSchema }, closedObjectOptions),
  Type.Object({ kind: Type.Literal("restart"), payload: emptyPayloadSchema }, closedObjectOptions),
  Type.Object(
    {
      kind: Type.Literal("logs"),
      payload: Type.Object(
        { lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })) },
        closedObjectOptions,
      ),
    },
    closedObjectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal("backup"),
      payload: Type.Object(
        { keep: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
        closedObjectOptions,
      ),
    },
    closedObjectOptions,
  ),
  Type.Object(
    { kind: Type.Literal("mods.list"), payload: emptyPayloadSchema },
    closedObjectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal("mods.add"),
      payload: Type.Object(
        { workshopId: Type.String({ pattern: "^[0-9]{6,20}$" }) },
        closedObjectOptions,
      ),
    },
    closedObjectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal("mods.remove"),
      payload: Type.Object(
        {
          modIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
            minItems: 1,
            maxItems: 100,
          }),
        },
        closedObjectOptions,
      ),
    },
    closedObjectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal("settings.update"),
      payload: Type.Object(
        {
          public: Type.Optional(Type.Boolean()),
          publicName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          password: Type.Optional(Type.String({ maxLength: 128 })),
          defaultPort: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
          udpPort: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
        },
        closedObjectOptions,
      ),
    },
    closedObjectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal("world.reset"),
      payload: Type.Object(
        { confirm: Type.Literal(true), createBackup: Type.Optional(Type.Boolean()) },
        closedObjectOptions,
      ),
    },
    closedObjectOptions,
  ),
]);

export type OperationCreateRequest = Static<typeof operationCreateRequestSchema>;

export const operationRecordSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  serverId: Type.String({ minLength: 1 }),
  kind: operationKindSchema,
  status: operationStatusSchema,
  createdAt: Type.String({ minLength: 1 }),
  startedAt: Type.Union([Type.String(), Type.Null()]),
  finishedAt: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
});

export type OperationRecord = Static<typeof operationRecordSchema>;

export const agentJobSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  request: agentOperationRequestSchema,
});

export type AgentJob = Static<typeof agentJobSchema>;

export const agentJobResponseSchema = Type.Object({
  job: Type.Union([Type.Null(), agentJobSchema]),
});

export const agentJobCompleteRequestSchema = Type.Object({
  status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String({ maxLength: 1000 })),
});

export type AgentJobCompleteRequest = Static<typeof agentJobCompleteRequestSchema>;

export const agentJobCompleteResponseSchema = Type.Object({
  ok: Type.Literal(true),
});

export const queuedOperationResponseSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  status: Type.Literal("queued"),
});

export type QueuedOperationResponse = Static<typeof queuedOperationResponseSchema>;
