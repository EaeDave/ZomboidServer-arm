import { sql } from "drizzle-orm";
import {
  index,
  integer,
  bigint,
  bigserial,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "operator", "viewer"]);
export const agentStatus = pgEnum("agent_status", ["pending", "online", "offline", "revoked"]);
export const operationStatus = pgEnum("operation_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const operationEventType = pgEnum("operation_event_type", [
  "queued",
  "claimed",
  "progress",
  "log",
  "completed",
  "recovered",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
  }),
);

export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: agentStatus("status").notNull().default("pending"),
  enrollmentSecretHash: text("enrollment_secret_hash").notNull(),
  accessTokenHash: text("access_token_hash").unique(),
  lastStatus: jsonb("last_status"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const serverInstances = pgTable(
  "server_instances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    serviceName: text("service_name").notNull(),
    port: integer("port").notNull(),
    runtime: text("runtime").notNull(),
    dataDir: text("data_dir").notNull(),
    consoleLogCursor: bigint("console_log_cursor", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serviceNameUnique: uniqueIndex("server_instances_service_name_idx").on(table.serviceName),
    agentIdIdx: index("server_instances_agent_id_idx").on(table.agentId),
  }),
);

export const operations = pgTable(
  "operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => serverInstances.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: operationStatus("status").notNull().default("queued"),
    payload: jsonb("payload"),
    result: jsonb("result"),
    error: text("error"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    logCursor: integer("log_cursor").default(0).notNull(),
    targetState: text("target_state"),
    progressMessage: text("progress_message"),
    progressUpdatedAt: timestamp("progress_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    queueIdx: index("operations_queue_idx").on(table.serverId, table.status, table.createdAt),
    actorIdx: index("operations_actor_user_id_idx").on(table.actorUserId),
    leaseIdx: index("operations_running_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`status = 'running'`),
    activeServerIdx: uniqueIndex("operations_active_server_idx")
      .on(table.serverId)
      .where(sql`status in ('queued', 'running')`),
  }),
);

// A bounded append-only event stream. It is the sole source for browser SSE; the browser never
// reads a host log or talks to the agent directly.
export const operationEvents = pgTable(
  "operation_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => serverInstances.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    type: operationEventType("type").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    operationIdx: index("operation_events_operation_idx").on(table.operationId, table.id),
    serverIdx: index("operation_events_server_idx").on(table.serverId, table.id),
  }),
);

// The server console is deliberately independent of an operation. The bounded history lets a
// newly connected browser receive recent output while the agent only sends incremental deltas.
export const consoleLogEntries = pgTable(
  "console_log_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => serverInstances.id, { onDelete: "cascade" }),
    agentCursor: bigint("agent_cursor", { mode: "number" }).notNull(),
    line: text("line").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    serverIdx: index("console_log_entries_server_idx").on(table.serverId, table.id),
    agentCursorUnique: uniqueIndex("console_log_entries_server_cursor_idx").on(
      table.serverId,
      table.agentCursor,
    ),
  }),
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("audit_events_created_at_idx").on(table.createdAt),
    actorIdx: index("audit_events_actor_user_id_idx").on(table.actorUserId),
    agentIdx: index("audit_events_agent_id_idx").on(table.agentId),
  }),
);
