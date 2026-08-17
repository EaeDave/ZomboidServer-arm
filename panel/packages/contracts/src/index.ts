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
  "backup",
  "mods.list",
  "mods.add",
  "mods.remove",
  "mods.configure",
  "settings.update",
  "config.update",
  "world.reset",
] as const;

export type OperationKind = (typeof operationKinds)[number];

export const operationKindSchema = Type.Union([
  Type.Literal("status"),
  Type.Literal("start"),
  Type.Literal("stop"),
  Type.Literal("restart"),
  Type.Literal("backup"),
  Type.Literal("mods.list"),
  Type.Literal("mods.add"),
  Type.Literal("mods.remove"),
  Type.Literal("mods.configure"),
  Type.Literal("settings.update"),
  Type.Literal("config.update"),
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

export const steamSessionCheckModeSchema = Type.Union([
  Type.Literal("observe"),
  Type.Literal("required"),
  Type.Literal("disabled"),
]);

export const steamSessionEvidenceSchema = Type.Union([
  Type.Literal("observed"),
  Type.Literal("not_observed"),
  Type.Literal("not_checked"),
]);

export const steamSessionStatusSchema = Type.Object({
  mode: steamSessionCheckModeSchema,
  evidence: steamSessionEvidenceSchema,
  checkedAt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  message: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});

export const agentModCollectionSchema = Type.Object({
  id: Type.String({ pattern: "^[0-9]{6,20}$" }),
  title: Type.String({ minLength: 1, maxLength: 256 }),
});

export const agentModItemSchema = Type.Object({
  workshopId: Type.String({ pattern: "^[0-9]{6,20}$" }),
  title: Type.String({ minLength: 1, maxLength: 256 }),
  modIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 100 }),
});

export const agentModsStatusSchema = Type.Object({
  collections: Type.Optional(Type.Array(agentModCollectionSchema, { maxItems: 50 })),
  configuredItems: Type.Optional(Type.Array(agentModItemSchema, { maxItems: 500 })),
  // Temporary compatibility with agents deployed before collection snapshots.
  workshopIds: Type.Optional(
    Type.Array(Type.String({ pattern: "^[0-9]{6,20}$" }), { maxItems: 500 }),
  ),
  activeModIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 1_000 }),
  ),
  inactiveModIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 1_000 }),
});

export const agentServerSettingsSchema = Type.Object({
  public: Type.Boolean(),
  publicName: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  passwordConfigured: Type.Boolean(),
  defaultPort: Type.Integer({ minimum: 1024, maximum: 65535 }),
  udpPort: Type.Integer({ minimum: 1024, maximum: 65535 }),
  publicAddress: Type.Union([Type.String({ maxLength: 255 }), Type.Null()]),
});

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
  onlinePlayers: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 100 }),
  ),
  rconAvailable: Type.Optional(Type.Boolean()),
  checkedAt: Type.String({ minLength: 1 }),
  steamSession: Type.Optional(steamSessionStatusSchema),
  mods: Type.Optional(agentModsStatusSchema),
  settings: Type.Optional(agentServerSettingsSchema),
});

export type AgentStatus = Static<typeof agentStatusSchema>;

export const agentSettingsRevealSchema = Type.Object({
  public: Type.Boolean(),
  publicName: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  password: Type.String({ maxLength: 128 }),
  defaultPort: Type.Integer({ minimum: 1024, maximum: 65535 }),
  udpPort: Type.Integer({ minimum: 1024, maximum: 65535 }),
  publicAddress: Type.Union([Type.String({ maxLength: 255 }), Type.Null()]),
});

export type AgentSettingsReveal = Static<typeof agentSettingsRevealSchema>;

export const configScalarSchema = Type.Union([
  Type.Boolean(),
  Type.Integer(),
  Type.Number(),
  Type.String({ maxLength: 4096 }),
]);

export const configFieldSchema = Type.Object(
  {
    source: Type.Union([Type.Literal("server"), Type.Literal("sandbox")]),
    path: Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z_][A-Za-z0-9_.]*$" }),
    label: Type.String({ minLength: 1, maxLength: 256 }),
    category: Type.String({ minLength: 1, maxLength: 64 }),
    categoryLabel: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.Union([
      Type.Literal("boolean"),
      Type.Literal("integer"),
      Type.Literal("number"),
      Type.Literal("string"),
    ]),
    value: Type.Union([configScalarSchema, Type.Null()]),
    configured: Type.Boolean(),
    description: Type.String({ maxLength: 2000 }),
    editable: Type.Boolean(),
    sensitive: Type.Boolean(),
    requiresRestart: Type.Boolean(),
    minimum: Type.Optional(Type.Number()),
    maximum: Type.Optional(Type.Number()),
    defaultValue: Type.Optional(configScalarSchema),
    options: Type.Optional(
      Type.Array(
        Type.Object({ value: configScalarSchema, label: Type.String({ maxLength: 256 }) }),
        {
          maxItems: 100,
        },
      ),
    ),
  },
  { additionalProperties: false },
);

export const configSnapshotSchema = Type.Object(
  {
    revision: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]+$" }),
    generatedAt: Type.String({ minLength: 1 }),
    fields: Type.Array(configFieldSchema, { maxItems: 2_000 }),
    warnings: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 100 }),
  },
  { additionalProperties: false },
);

export type ConfigField = Static<typeof configFieldSchema>;
export type ConfigSnapshot = Static<typeof configSnapshotSchema>;

export const configChangeSchema = Type.Object(
  {
    source: Type.Union([Type.Literal("server"), Type.Literal("sandbox")]),
    path: Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z_][A-Za-z0-9_.]*$" }),
    value: configScalarSchema,
  },
  { additionalProperties: false },
);

export const configUpdatePayloadSchema = Type.Object(
  {
    expectedRevision: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]+$" }),
    createBackup: Type.Optional(Type.Boolean()),
    changes: Type.Array(configChangeSchema, { minItems: 1, maxItems: 200 }),
  },
  { additionalProperties: false },
);

export const configUpdateResultSchema = Type.Object({
  changed: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 200 }),
  backupPaths: Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 2 }),
  revision: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]+$" }),
  requiresRestart: Type.Boolean(),
});

export type ConfigUpdatePayload = Static<typeof configUpdatePayloadSchema>;
export type ConfigUpdateResult = Static<typeof configUpdateResultSchema>;

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

export const statusOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("status"),
    payload: emptyPayloadSchema,
  },
  closedObjectOptions,
);

export const startOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("start"),
    payload: emptyPayloadSchema,
  },
  closedObjectOptions,
);

export const stopOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("stop"),
    payload: emptyPayloadSchema,
  },
  closedObjectOptions,
);

export const restartOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("restart"),
    payload: emptyPayloadSchema,
  },
  closedObjectOptions,
);

export const settingsReadOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("settings.read"),
    payload: emptyPayloadSchema,
  },
  closedObjectOptions,
);

export const configReadOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("config.read"),
    payload: emptyPayloadSchema,
  },
  closedObjectOptions,
);

export const backupOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("backup"),
    payload: Type.Object(
      { keep: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
      closedObjectOptions,
    ),
  },
  closedObjectOptions,
);

export const modsListOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("mods.list"),
    payload: emptyPayloadSchema,
  },
  closedObjectOptions,
);

export const modsAddOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("mods.add"),
    payload: Type.Object(
      { workshopId: Type.String({ pattern: "^[0-9]{6,20}$" }) },
      closedObjectOptions,
    ),
  },
  closedObjectOptions,
);

export const modsRemoveOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("mods.remove"),
    payload: Type.Object(
      {
        modIds: Type.Array(Type.String({ pattern: "^[A-Za-z0-9_.-]+$", maxLength: 128 }), {
          minItems: 1,
          maxItems: 100,
        }),
      },
      closedObjectOptions,
    ),
  },
  closedObjectOptions,
);

export const modsConfigurePayloadSchema = Type.Object(
  {
    activeModIds: Type.Array(Type.String({ pattern: "^[A-Za-z0-9_.-]+$", maxLength: 128 }), {
      maxItems: 1_000,
      uniqueItems: true,
    }),
    inactiveModIds: Type.Array(Type.String({ pattern: "^[A-Za-z0-9_.-]+$", maxLength: 128 }), {
      maxItems: 1_000,
      uniqueItems: true,
    }),
  },
  closedObjectOptions,
);

export const modsConfigureOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("mods.configure"),
    payload: modsConfigurePayloadSchema,
  },
  closedObjectOptions,
);

export const settingsUpdateOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("settings.update"),
    payload: Type.Object(
      {
        public: Type.Optional(Type.Boolean()),
        publicName: Type.Optional(
          Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\r\\n]*$" }),
        ),
        password: Type.Optional(Type.String({ maxLength: 128, pattern: "^[^\\r\\n]*$" })),
        defaultPort: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
        udpPort: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
      },
      closedObjectOptions,
    ),
  },
  closedObjectOptions,
);

export const configUpdateOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("config.update"),
    payload: configUpdatePayloadSchema,
  },
  closedObjectOptions,
);

export const worldResetOperationRequestSchema = Type.Object(
  {
    ...operationBaseSchema,
    kind: Type.Literal("world.reset"),
    payload: Type.Object(
      { confirm: Type.Literal(true), createBackup: Type.Optional(Type.Boolean()) },
      closedObjectOptions,
    ),
  },
  closedObjectOptions,
);

export const agentOperationRequestSchema = Type.Union([
  statusOperationRequestSchema,
  startOperationRequestSchema,
  stopOperationRequestSchema,
  restartOperationRequestSchema,
  backupOperationRequestSchema,
  modsListOperationRequestSchema,
  modsAddOperationRequestSchema,
  modsRemoveOperationRequestSchema,
  modsConfigureOperationRequestSchema,
  settingsReadOperationRequestSchema,
  settingsUpdateOperationRequestSchema,
  configReadOperationRequestSchema,
  configUpdateOperationRequestSchema,
  worldResetOperationRequestSchema,
]);

export type AgentOperationRequest = Static<typeof agentOperationRequestSchema>;

export const statusOperationResponseSchema = Type.Object(
  {
    protocolVersion: Type.Literal(1),
    requestId: Type.String(),
    serverId: Type.String(),
    kind: Type.Literal("status"),
    ok: Type.Literal(true),
    data: agentStatusSchema,
  },
  closedObjectOptions,
);

export const agentErrorResponseSchema = Type.Object(
  {
    protocolVersion: Type.Literal(1),
    requestId: Type.String(),
    serverId: Type.String(),
    kind: Type.String(),
    ok: Type.Literal(false),
    error: Type.Object(
      {
        code: Type.String(),
        message: Type.String(),
      },
      closedObjectOptions,
    ),
  },
  closedObjectOptions,
);

const nonStatusOperationKindSchema = Type.Union([
  Type.Literal("start"),
  Type.Literal("stop"),
  Type.Literal("restart"),
  Type.Literal("backup"),
  Type.Literal("mods.list"),
  Type.Literal("mods.add"),
  Type.Literal("mods.remove"),
  Type.Literal("mods.configure"),
  Type.Literal("settings.read"),
  Type.Literal("settings.update"),
  Type.Literal("config.read"),
  Type.Literal("config.update"),
  Type.Literal("world.reset"),
]);

export const agentOperationSuccessResponseSchema = Type.Object(
  {
    protocolVersion: Type.Literal(1),
    requestId: Type.String(),
    serverId: Type.String(),
    kind: nonStatusOperationKindSchema,
    ok: Type.Literal(true),
    data: Type.Unknown(),
  },
  closedObjectOptions,
);

export const agentOperationResponseSchema = Type.Union([
  statusOperationResponseSchema,
  agentOperationSuccessResponseSchema,
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

export const operationTargetStateSchema = Type.Union([
  Type.Literal("online"),
  Type.Literal("offline"),
  Type.Literal("ready"),
  Type.Literal("unknown"),
]);

export const operationCreateRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal("status"), payload: emptyPayloadSchema }, closedObjectOptions),
  Type.Object({ kind: Type.Literal("start"), payload: emptyPayloadSchema }, closedObjectOptions),
  Type.Object({ kind: Type.Literal("stop"), payload: emptyPayloadSchema }, closedObjectOptions),
  Type.Object({ kind: Type.Literal("restart"), payload: emptyPayloadSchema }, closedObjectOptions),
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
          modIds: Type.Array(Type.String({ pattern: "^[A-Za-z0-9_.-]+$", maxLength: 128 }), {
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
      kind: Type.Literal("mods.configure"),
      payload: modsConfigurePayloadSchema,
    },
    closedObjectOptions,
  ),
  Type.Object(
    {
      kind: Type.Literal("settings.update"),
      payload: Type.Object(
        {
          public: Type.Optional(Type.Boolean()),
          publicName: Type.Optional(
            Type.String({ minLength: 1, maxLength: 128, pattern: "^[^\\r\\n]*$" }),
          ),
          password: Type.Optional(Type.String({ maxLength: 128, pattern: "^[^\\r\\n]*$" })),
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
      kind: Type.Literal("config.update"),
      payload: configUpdatePayloadSchema,
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
  targetState: Type.Optional(Type.Union([operationTargetStateSchema, Type.Null()])),
  progressMessage: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  progressUpdatedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  result: Type.Optional(Type.Unknown()),
});

export type OperationRecord = Static<typeof operationRecordSchema>;

export const operationEventTypeSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("claimed"),
  Type.Literal("progress"),
  Type.Literal("log"),
  Type.Literal("completed"),
  Type.Literal("recovered"),
]);

export const operationEventSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  serverId: Type.String({ minLength: 1 }),
  operationId: Type.String({ minLength: 1 }),
  type: operationEventTypeSchema,
  data: Type.Unknown(),
  createdAt: Type.String({ minLength: 1 }),
});

export type OperationEvent = Static<typeof operationEventSchema>;

export const operationListResponseSchema = Type.Object({
  operations: Type.Array(operationRecordSchema, { maxItems: 100 }),
});

export const operationEventListResponseSchema = Type.Object({
  events: Type.Array(operationEventSchema, { maxItems: 500 }),
  cursor: Type.Integer({ minimum: 0 }),
});

export const consoleLogEntrySchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  serverId: Type.String({ minLength: 1 }),
  line: Type.String({ maxLength: 2048 }),
  createdAt: Type.String({ minLength: 1 }),
});

export type ConsoleLogEntry = Static<typeof consoleLogEntrySchema>;

export const consoleLogListResponseSchema = Type.Object({
  logs: Type.Array(consoleLogEntrySchema, { maxItems: 500 }),
  cursor: Type.Integer({ minimum: 0 }),
});

export const agentJobProgressRequestSchema = Type.Object(
  {
    message: Type.String({ minLength: 1, maxLength: 512 }),
  },
  closedObjectOptions,
);

export const agentJobLogRequestSchema = Type.Object(
  {
    cursor: Type.Integer({ minimum: 0 }),
    lines: Type.Array(Type.String({ maxLength: 2048 }), { minItems: 1, maxItems: 200 }),
  },
  closedObjectOptions,
);

export const agentConsoleLogRequestSchema = Type.Object(
  {
    serverId: Type.String({ minLength: 1, maxLength: 128 }),
    cursor: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    resync: Type.Optional(Type.Boolean()),
    resyncId: Type.Optional(Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]+$" })),
    lines: Type.Array(Type.String({ maxLength: 2048 }), { minItems: 1, maxItems: 200 }),
  },
  closedObjectOptions,
);

export const agentConsoleLogResponseSchema = Type.Object({
  ok: Type.Literal(true),
  cursor: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
});

export const agentJobSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  request: agentOperationRequestSchema,
});

export type AgentJob = Static<typeof agentJobSchema>;

export const agentJobResponseSchema = Type.Object({
  job: Type.Union([Type.Null(), agentJobSchema]),
});

const succeededJobCompleteRequestSchema = Type.Object(
  {
    status: Type.Literal("succeeded"),
    result: Type.Unknown(),
  },
  closedObjectOptions,
);

const failedJobCompleteRequestSchema = Type.Object(
  {
    status: Type.Literal("failed"),
    error: Type.String({ minLength: 1, maxLength: 1000 }),
  },
  closedObjectOptions,
);

export const agentJobCompleteRequestSchema = Type.Union([
  succeededJobCompleteRequestSchema,
  failedJobCompleteRequestSchema,
]);

export type AgentJobCompleteRequest = Static<typeof agentJobCompleteRequestSchema>;

export const agentJobCompleteResponseSchema = Type.Object({
  ok: Type.Literal(true),
});

export const queuedOperationResponseSchema = Type.Object({
  operationId: Type.String({ minLength: 1 }),
  status: Type.Literal("queued"),
});

export type QueuedOperationResponse = Static<typeof queuedOperationResponseSchema>;
