import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, lt, ne } from "drizzle-orm";
import type {
  AgentEnrollmentRequest,
  AgentJob,
  AgentJobCompleteRequest,
  AgentOperationRequest,
  AgentStatus,
  ConsoleLogEntry,
  OperationCreateRequest,
  OperationRecord,
} from "@zomboid/contracts";
import {
  agents,
  auditEvents,
  consoleLogEntries,
  operationEvents,
  operations,
  serverInstances,
} from "@zomboid/db";
import { createDatabase, type Database } from "@zomboid/db/client";

export interface AgentEnrollmentResult {
  agentId: string;
  accessToken: string;
}

export interface AgentService {
  enroll(input: AgentEnrollmentRequest): Promise<AgentEnrollmentResult>;
  heartbeat(agentId: string, accessToken: string, status: AgentStatus): Promise<void>;
  getStatus(serverId: string): Promise<AgentStatus>;
  enqueueOperation(
    serverId: string,
    actorUserId: string,
    request: OperationCreateRequest,
  ): Promise<OperationRecord>;
  enqueueStatus(serverId: string, actorUserId: string): Promise<OperationRecord>;
  getOperation(operationId: string): Promise<OperationRecord>;
  listOperations(serverId: string, limit?: number): Promise<OperationRecord[]>;
  listEvents(serverId: string, after?: number): Promise<OperationEventRecord[]>;
  listConsoleLogs(serverId: string, after?: number): Promise<ConsoleLogEntry[]>;
  claimNext(agentId: string, accessToken: string): Promise<AgentJob | null>;
  progressJob(
    agentId: string,
    accessToken: string,
    operationId: string,
    message: string,
  ): Promise<void>;
  appendJobLogs(
    agentId: string,
    accessToken: string,
    operationId: string,
    cursor: number,
    lines: string[],
  ): Promise<void>;
  appendConsoleLogs(
    agentId: string,
    accessToken: string,
    serverId: string,
    cursor: number,
    lines: string[],
    resync: boolean,
  ): Promise<number>;
  completeJob(
    agentId: string,
    accessToken: string,
    operationId: string,
    result: AgentJobCompleteRequest,
  ): Promise<void>;
}

export interface OperationEventRecord {
  id: number;
  serverId: string;
  operationId: string;
  type: "queued" | "claimed" | "progress" | "log" | "completed" | "recovered";
  data: unknown;
  createdAt: string;
}

export class AgentUnavailableError extends Error {
  constructor() {
    super("agent storage or enrollment is not configured");
    this.name = "AgentUnavailableError";
  }
}

export class AgentUnauthorizedError extends Error {
  constructor() {
    super("agent credentials are invalid");
    this.name = "AgentUnauthorizedError";
  }
}

export class OperationNotFoundError extends Error {
  constructor() {
    super("operation was not found");
    this.name = "OperationNotFoundError";
  }
}

export class ServerNotFoundError extends Error {
  constructor() {
    super("server was not found");
    this.name = "ServerNotFoundError";
  }
}

export class OperationConflictError extends Error {
  constructor() {
    super("another operation is already queued or running for this server");
    this.name = "OperationConflictError";
  }
}

export class AgentPayloadError extends Error {
  constructor() {
    super("agent payload exceeds the bounded operation event limits");
    this.name = "AgentPayloadError";
  }
}

export class AgentCursorMismatchError extends Error {
  constructor() {
    super("console cursor does not continue the persisted stream");
    this.name = "AgentCursorMismatchError";
  }
}

export class AgentStatusMismatchError extends Error {
  constructor() {
    super("agent status does not match the enrolled server");
    this.name = "AgentStatusMismatchError";
  }
}

export class AgentAlreadyEnrolledError extends Error {
  constructor() {
    super("server is already enrolled");
    this.name = "AgentAlreadyEnrolledError";
  }
}

function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function secretsMatch(left: string, right: string): boolean {
  const leftHash = hashSecret(left);
  const rightHash = hashSecret(right);
  return timingSafeEqual(leftHash, rightHash);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function dateString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function operationRecord(row: {
  operationId: string;
  serverId: string;
  kind: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  targetState?: string | null;
  progressMessage?: string | null;
  progressUpdatedAt?: Date | null;
  result?: unknown;
}): OperationRecord {
  const record: OperationRecord = {
    operationId: row.operationId,
    serverId: row.serverId,
    kind: row.kind as OperationRecord["kind"],
    status: row.status as OperationRecord["status"],
    createdAt: row.createdAt.toISOString(),
    startedAt: dateString(row.startedAt),
    finishedAt: dateString(row.finishedAt),
    error: row.error,
  };
  if ("targetState" in row) {
    record.targetState = (row.targetState as OperationRecord["targetState"]) ?? null;
  }
  if ("progressMessage" in row) record.progressMessage = row.progressMessage ?? null;
  if ("progressUpdatedAt" in row) {
    record.progressUpdatedAt = dateString(row.progressUpdatedAt ?? null);
  }
  if ("result" in row) record.result = row.result;
  return record;
}

function operationRequest(
  operationId: string,
  serverId: string,
  kind: string,
  payload: unknown,
): AgentOperationRequest {
  return {
    protocolVersion: 1,
    requestId: operationId,
    serverId,
    kind,
    payload,
  } as AgentOperationRequest;
}

function targetStateFor(kind: string): "online" | "offline" | "ready" | "unknown" {
  if (kind === "start" || kind === "restart") return "online";
  if (kind === "stop") return "offline";
  if (kind === "status") return "unknown";
  return "ready";
}

export class DatabaseAgentService implements AgentService {
  constructor(
    private readonly getDatabase: () => Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private leaseExpiry() {
    return new Date(this.now().getTime() + 90_000);
  }

  private async trimEvents(database: Database, serverId: string) {
    const maxEvents = 5_000;
    const retained = await database
      .select({ id: operationEvents.id })
      .from(operationEvents)
      .where(eq(operationEvents.serverId, serverId))
      .orderBy(desc(operationEvents.id))
      .limit(maxEvents + 1);
    const oldestRetained = retained[maxEvents - 1];
    if (retained.length > maxEvents && oldestRetained) {
      await database
        .delete(operationEvents)
        .where(
          and(eq(operationEvents.serverId, serverId), lt(operationEvents.id, oldestRetained.id)),
        );
    }
  }

  private async trimConsoleLogs(database: Database, serverId: string) {
    const maxLogs = 2_000;
    const retained = await database
      .select({ id: consoleLogEntries.id })
      .from(consoleLogEntries)
      .where(eq(consoleLogEntries.serverId, serverId))
      .orderBy(desc(consoleLogEntries.id))
      .limit(maxLogs + 1);
    const oldestRetained = retained[maxLogs - 1];
    if (retained.length > maxLogs && oldestRetained) {
      await database
        .delete(consoleLogEntries)
        .where(
          and(
            eq(consoleLogEntries.serverId, serverId),
            lt(consoleLogEntries.id, oldestRetained.id),
          ),
        );
    }
  }

  private async recoverExpiredOperations(database: Database, agentId: string) {
    while (true) {
      const expired = await database
        .select({ id: operations.id, serverId: operations.serverId })
        .from(operations)
        .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
        .where(
          and(
            eq(serverInstances.agentId, agentId),
            eq(operations.status, "running"),
            lt(operations.leaseExpiresAt, this.now()),
          ),
        )
        .orderBy(asc(operations.leaseExpiresAt))
        .limit(100);
      if (expired.length === 0) return;

      await database.transaction(async (transaction) => {
        for (const operation of expired) {
          const [recovered] = await transaction
            .update(operations)
            .set({
              status: "failed",
              error: "Agent lease expired before the operation completed.",
              finishedAt: this.now(),
              leaseExpiresAt: null,
              progressMessage: "Recovered as failed after the host agent lease expired.",
              progressUpdatedAt: this.now(),
            })
            .where(
              and(
                eq(operations.id, operation.id),
                eq(operations.status, "running"),
                lt(operations.leaseExpiresAt, this.now()),
              ),
            )
            .returning({ id: operations.id });
          if (recovered) {
            await transaction.insert(operationEvents).values({
              serverId: operation.serverId,
              operationId: operation.id,
              type: "recovered",
              data: { message: "Agent lease expired before the operation completed." },
            });
          }
        }
      });
      for (const operation of expired) await this.trimEvents(database, operation.serverId);
    }
  }

  private async authorizeAgent(agentId: string, accessToken: string) {
    const [agent] = await this.getDatabase()
      .select({ id: agents.id, serviceName: serverInstances.serviceName })
      .from(agents)
      .innerJoin(serverInstances, eq(serverInstances.agentId, agents.id))
      .where(
        and(
          eq(agents.id, agentId),
          ne(agents.status, "revoked"),
          eq(agents.accessTokenHash, hashSecret(accessToken).toString("hex")),
        ),
      )
      .limit(1);

    if (!agent) throw new AgentUnauthorizedError();
    return agent;
  }

  async enroll(input: AgentEnrollmentRequest): Promise<AgentEnrollmentResult> {
    const enrollmentToken = process.env.AGENT_ENROLLMENT_TOKEN;
    if (!enrollmentToken) throw new AgentUnavailableError();
    if (!secretsMatch(enrollmentToken, input.enrollmentToken)) {
      throw new AgentUnauthorizedError();
    }

    const database = this.getDatabase();
    const [existingServer] = await database
      .select({ id: serverInstances.id })
      .from(serverInstances)
      .where(eq(serverInstances.serviceName, input.server.serviceName))
      .limit(1);
    if (existingServer) throw new AgentAlreadyEnrolledError();

    const accessToken = randomBytes(32).toString("base64url");
    try {
      return await database.transaction(async (transaction) => {
        const [agent] = await transaction
          .insert(agents)
          .values({
            name: input.name.trim(),
            enrollmentSecretHash: hashSecret(enrollmentToken).toString("hex"),
            accessTokenHash: hashSecret(accessToken).toString("hex"),
            status: "offline",
          })
          .returning({ id: agents.id });

        if (!agent) throw new Error("agent enrollment did not return an id");

        await transaction.insert(serverInstances).values({
          agentId: agent.id,
          displayName: input.server.displayName,
          serviceName: input.server.serviceName,
          port: input.server.port,
          runtime: input.server.runtime,
          dataDir: input.server.dataDir,
        });
        await transaction.insert(auditEvents).values({
          agentId: agent.id,
          action: "agent.enroll",
          metadata: {
            name: input.name,
            serviceName: input.server.serviceName,
          },
        });

        return { agentId: agent.id, accessToken };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AgentAlreadyEnrolledError();
      throw error;
    }
  }

  async heartbeat(agentId: string, accessToken: string, status: AgentStatus): Promise<void> {
    const database = this.getDatabase();
    const agent = await this.authorizeAgent(agentId, accessToken);
    if (status.serverId !== agent.serviceName || status.serviceName !== agent.serviceName) {
      throw new AgentStatusMismatchError();
    }

    await database
      .update(agents)
      .set({ status: "online", lastStatus: status, lastSeenAt: this.now() })
      .where(eq(agents.id, agent.id));
  }

  async getStatus(serverId: string): Promise<AgentStatus> {
    const [row] = await this.getDatabase()
      .select({
        lastStatus: agents.lastStatus,
        lastSeenAt: agents.lastSeenAt,
        agentStatus: agents.status,
      })
      .from(serverInstances)
      .innerJoin(agents, eq(serverInstances.agentId, agents.id))
      .where(eq(serverInstances.serviceName, serverId))
      .limit(1);

    if (!row) throw new ServerNotFoundError();
    if (row.agentStatus === "revoked") throw new AgentUnavailableError();

    const parsedStaleSeconds = Number(process.env.AGENT_STALE_SECONDS ?? 60);
    const staleSeconds =
      Number.isFinite(parsedStaleSeconds) && parsedStaleSeconds > 0 ? parsedStaleSeconds : 60;
    const lastSeen = row?.lastSeenAt?.getTime() ?? 0;
    if (!row.lastStatus || !lastSeen || this.now().getTime() - lastSeen > staleSeconds * 1000) {
      throw new AgentUnavailableError();
    }
    return row.lastStatus as AgentStatus;
  }

  async enqueueOperation(
    serverId: string,
    actorUserId: string,
    request: OperationCreateRequest,
  ): Promise<OperationRecord> {
    const database = this.getDatabase();
    const [server] = await database
      .select({
        id: serverInstances.id,
        agentId: serverInstances.agentId,
        serviceName: serverInstances.serviceName,
      })
      .from(serverInstances)
      .where(eq(serverInstances.serviceName, serverId))
      .limit(1);

    if (!server) throw new ServerNotFoundError();
    await this.recoverExpiredOperations(database, server.agentId);

    let record: OperationRecord;
    try {
      record = await database.transaction(async (transaction) => {
        const [queuedConflict] = await transaction
          .select({ id: operations.id })
          .from(operations)
          .where(and(eq(operations.serverId, server.id), eq(operations.status, "queued")))
          .limit(1);
        const [runningConflict] = await transaction
          .select({ id: operations.id })
          .from(operations)
          .where(and(eq(operations.serverId, server.id), eq(operations.status, "running")))
          .limit(1);
        if (queuedConflict || runningConflict) throw new OperationConflictError();

        const [created] = await transaction
          .insert(operations)
          .values({
            serverId: server.id,
            actorUserId,
            kind: request.kind,
            payload: request.payload,
            targetState: targetStateFor(request.kind),
            progressMessage: "Queued for the host agent.",
            progressUpdatedAt: this.now(),
          })
          .returning({
            operationId: operations.id,
            status: operations.status,
            createdAt: operations.createdAt,
            startedAt: operations.startedAt,
            finishedAt: operations.finishedAt,
            error: operations.error,
            targetState: operations.targetState,
            progressMessage: operations.progressMessage,
            progressUpdatedAt: operations.progressUpdatedAt,
          });

        if (!created) throw new Error("operation was not created");

        const record = operationRecord({
          ...created,
          serverId: server.serviceName,
          kind: request.kind,
        });
        await transaction.insert(operationEvents).values({
          serverId: server.id,
          operationId: record.operationId,
          type: "queued",
          data: { kind: record.kind, targetState: record.targetState },
        });
        await transaction.insert(auditEvents).values({
          actorUserId,
          action: "operation.queued",
          metadata: { operationId: record.operationId, serverId, kind: record.kind },
        });
        return record;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new OperationConflictError();
      throw error;
    }
    await this.trimEvents(database, server.id);
    return record;
  }

  async enqueueStatus(serverId: string, actorUserId: string): Promise<OperationRecord> {
    return this.enqueueOperation(serverId, actorUserId, { kind: "status", payload: {} });
  }

  async getOperation(operationId: string): Promise<OperationRecord> {
    const [row] = await this.getDatabase()
      .select({
        operationId: operations.id,
        serverInstanceId: operations.serverId,
        serverId: serverInstances.serviceName,
        kind: operations.kind,
        status: operations.status,
        createdAt: operations.createdAt,
        startedAt: operations.startedAt,
        finishedAt: operations.finishedAt,
        error: operations.error,
        targetState: operations.targetState,
        progressMessage: operations.progressMessage,
        progressUpdatedAt: operations.progressUpdatedAt,
        result: operations.result,
      })
      .from(operations)
      .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
      .where(eq(operations.id, operationId))
      .limit(1);

    if (!row) throw new OperationNotFoundError();
    return operationRecord(row);
  }

  async listOperations(serverId: string, limit = 50): Promise<OperationRecord[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const rows = await this.getDatabase()
      .select({
        operationId: operations.id,
        serverId: serverInstances.serviceName,
        kind: operations.kind,
        status: operations.status,
        createdAt: operations.createdAt,
        startedAt: operations.startedAt,
        finishedAt: operations.finishedAt,
        error: operations.error,
        targetState: operations.targetState,
        progressMessage: operations.progressMessage,
        progressUpdatedAt: operations.progressUpdatedAt,
        result: operations.result,
      })
      .from(operations)
      .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
      .where(eq(serverInstances.serviceName, serverId))
      .orderBy(desc(operations.createdAt))
      .limit(boundedLimit);
    return rows.map(operationRecord);
  }

  async listEvents(serverId: string, after = 0): Promise<OperationEventRecord[]> {
    const rows = await this.getDatabase()
      .select({
        id: operationEvents.id,
        serverId: serverInstances.serviceName,
        operationId: operationEvents.operationId,
        type: operationEvents.type,
        data: operationEvents.data,
        createdAt: operationEvents.createdAt,
      })
      .from(operationEvents)
      .innerJoin(serverInstances, eq(operationEvents.serverId, serverInstances.id))
      .where(and(eq(serverInstances.serviceName, serverId), gt(operationEvents.id, after)))
      .orderBy(after === 0 ? desc(operationEvents.id) : asc(operationEvents.id))
      .limit(500);
    const orderedRows = after === 0 ? rows.reverse() : rows;
    return orderedRows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })) as OperationEventRecord[];
  }

  async listConsoleLogs(serverId: string, after = 0): Promise<ConsoleLogEntry[]> {
    const rows = await this.getDatabase()
      .select({
        id: consoleLogEntries.id,
        serverId: serverInstances.serviceName,
        line: consoleLogEntries.line,
        createdAt: consoleLogEntries.createdAt,
      })
      .from(consoleLogEntries)
      .innerJoin(serverInstances, eq(consoleLogEntries.serverId, serverInstances.id))
      .where(and(eq(serverInstances.serviceName, serverId), gt(consoleLogEntries.id, after)))
      .orderBy(after === 0 ? desc(consoleLogEntries.id) : asc(consoleLogEntries.id))
      .limit(500);
    const orderedRows = after === 0 ? rows.reverse() : rows;
    if (after === 0 && orderedRows.length === 0) {
      const [server] = await this.getDatabase()
        .select({ id: serverInstances.id })
        .from(serverInstances)
        .where(eq(serverInstances.serviceName, serverId))
        .limit(1);
      if (!server) throw new ServerNotFoundError();
    }
    return orderedRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async claimNext(agentId: string, accessToken: string): Promise<AgentJob | null> {
    const database = this.getDatabase();
    const agent = await this.authorizeAgent(agentId, accessToken);
    await this.recoverExpiredOperations(database, agent.id);
    const [running] = await database
      .select({ id: operations.id })
      .from(operations)
      .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
      .where(and(eq(serverInstances.agentId, agent.id), eq(operations.status, "running")))
      .limit(1);
    if (running) return null;
    const [candidate] = await database
      .select({
        operationId: operations.id,
        serverInstanceId: operations.serverId,
        serverId: serverInstances.serviceName,
        kind: operations.kind,
        payload: operations.payload,
      })
      .from(operations)
      .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
      .where(and(eq(serverInstances.agentId, agent.id), eq(operations.status, "queued")))
      .orderBy(asc(operations.createdAt))
      .limit(1);

    if (!candidate) return null;

    const claimed = await database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(operations)
        .set({
          status: "running",
          startedAt: this.now(),
          leaseExpiresAt: this.leaseExpiry(),
          progressMessage: "Claimed by the host agent.",
          progressUpdatedAt: this.now(),
        })
        .where(and(eq(operations.id, candidate.operationId), eq(operations.status, "queued")))
        .returning({ id: operations.id });
      if (!updated) return null;
      await transaction.insert(operationEvents).values({
        serverId: candidate.serverInstanceId,
        operationId: updated.id,
        type: "claimed",
        data: { message: "Agent claimed operation." },
      });
      return updated;
    });

    if (!claimed) return null;
    await this.trimEvents(database, candidate.serverInstanceId);

    return {
      operationId: claimed.id,
      request: operationRequest(claimed.id, candidate.serverId, candidate.kind, candidate.payload),
    };
  }

  private async activeOperation(agentId: string, accessToken: string, operationId: string) {
    const agent = await this.authorizeAgent(agentId, accessToken);
    const [operation] = await this.getDatabase()
      .select({ id: operations.id, serverId: operations.serverId, logCursor: operations.logCursor })
      .from(operations)
      .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
      .where(
        and(
          eq(operations.id, operationId),
          eq(serverInstances.agentId, agent.id),
          eq(operations.status, "running"),
        ),
      )
      .limit(1);
    if (!operation) throw new OperationNotFoundError();
    return operation;
  }

  async progressJob(agentId: string, accessToken: string, operationId: string, message: string) {
    const operation = await this.activeOperation(agentId, accessToken, operationId);
    const database = this.getDatabase();
    await database.transaction(async (transaction) => {
      const [renewed] = await transaction
        .update(operations)
        .set({
          leaseExpiresAt: this.leaseExpiry(),
          progressMessage: message,
          progressUpdatedAt: this.now(),
        })
        .where(and(eq(operations.id, operation.id), eq(operations.status, "running")))
        .returning({ id: operations.id });
      if (!renewed) throw new OperationNotFoundError();
      await transaction.insert(operationEvents).values({
        serverId: operation.serverId,
        operationId: operation.id,
        type: "progress",
        data: { message },
      });
    });
    await this.trimEvents(database, operation.serverId);
  }

  async appendJobLogs(
    agentId: string,
    accessToken: string,
    operationId: string,
    cursor: number,
    lines: string[],
  ) {
    const encodedBytes = Buffer.byteLength(JSON.stringify(lines), "utf8");
    if (
      lines.length === 0 ||
      lines.length > 200 ||
      encodedBytes > 64 * 1024 ||
      lines.some((line) => line.length > 2048)
    ) {
      throw new AgentPayloadError();
    }
    const operation = await this.activeOperation(agentId, accessToken, operationId);
    const database = this.getDatabase();
    await database.transaction(async (transaction) => {
      const [renewed] = await transaction
        .update(operations)
        .set({ leaseExpiresAt: this.leaseExpiry() })
        .where(and(eq(operations.id, operation.id), eq(operations.status, "running")))
        .returning({ id: operations.id });
      if (!renewed) throw new OperationNotFoundError();
      const [advanced] = await transaction
        .update(operations)
        .set({ logCursor: cursor })
        .where(and(eq(operations.id, operation.id), lt(operations.logCursor, cursor)))
        .returning({ id: operations.id });
      if (!advanced) return;
      await transaction.insert(operationEvents).values({
        serverId: operation.serverId,
        operationId: operation.id,
        type: "log",
        data: { cursor, lines },
      });
    });
    await this.trimEvents(database, operation.serverId);
  }

  async appendConsoleLogs(
    agentId: string,
    accessToken: string,
    serverId: string,
    cursor: number,
    lines: string[],
    resync: boolean,
  ): Promise<number> {
    const encodedBytes = Buffer.byteLength(JSON.stringify(lines), "utf8");
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < lines.length ||
      lines.length === 0 ||
      lines.length > 200 ||
      encodedBytes > 64 * 1024 ||
      lines.some((line) => line.length > 2048)
    ) {
      throw new AgentPayloadError();
    }
    const agent = await this.authorizeAgent(agentId, accessToken);
    const database = this.getDatabase();
    const [server] = await database
      .select({ id: serverInstances.id })
      .from(serverInstances)
      .where(and(eq(serverInstances.agentId, agent.id), eq(serverInstances.serviceName, serverId)))
      .limit(1);
    if (!server) throw new ServerNotFoundError();

    const acceptedCursor = await database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ consoleLogCursor: serverInstances.consoleLogCursor })
        .from(serverInstances)
        .where(eq(serverInstances.id, server.id))
        .for("update");
      if (!current) throw new ServerNotFoundError();

      const storedCursor = current.consoleLogCursor;
      const incomingStart = cursor - lines.length + 1;
      if (!resync && cursor <= storedCursor) return storedCursor;
      if (!resync && incomingStart > storedCursor + 1) throw new AgentCursorMismatchError();

      // A missing or corrupt local state file requests a one-time rebase. Replays otherwise keep
      // their original cursor range, allowing the overlapping prefix to remain idempotent.
      const firstLine = resync ? 0 : Math.max(0, storedCursor - incomingStart + 1);
      const appendedLines = lines.slice(firstLine);
      const nextCursor = resync ? storedCursor + appendedLines.length : cursor;
      if (appendedLines.length === 0) return storedCursor;

      await transaction
        .update(serverInstances)
        .set({ consoleLogCursor: nextCursor })
        .where(
          and(
            eq(serverInstances.id, server.id),
            eq(serverInstances.consoleLogCursor, storedCursor),
          ),
        );
      await transaction.insert(consoleLogEntries).values(
        appendedLines.map((line, index) => ({
          serverId: server.id,
          agentCursor: resync ? storedCursor + index + 1 : incomingStart + firstLine + index,
          line,
        })),
      );
      return nextCursor;
    });
    await this.trimConsoleLogs(database, server.id);
    return acceptedCursor;
  }

  async completeJob(
    agentId: string,
    accessToken: string,
    operationId: string,
    result: AgentJobCompleteRequest,
  ): Promise<void> {
    const database = this.getDatabase();
    const agent = await this.authorizeAgent(agentId, accessToken);
    if (result.status === "succeeded" && result.result === undefined) {
      throw new Error("successful status operation must include a result");
    }
    if (result.status === "failed" && !result.error) {
      throw new Error("failed operation must include an error");
    }

    const [operation] = await database
      .select({ id: operations.id, serverId: operations.serverId })
      .from(operations)
      .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
      .where(
        and(
          eq(operations.id, operationId),
          eq(serverInstances.agentId, agent.id),
          eq(operations.status, "running"),
        ),
      )
      .limit(1);

    if (!operation) throw new OperationNotFoundError();

    await database.transaction(async (transaction) => {
      const [completed] = await transaction
        .update(operations)
        .set({
          status: result.status,
          result: result.status === "succeeded" ? result.result : null,
          error: result.status === "failed" ? result.error : null,
          finishedAt: this.now(),
          leaseExpiresAt: null,
          progressMessage: result.status === "succeeded" ? "Completed successfully." : result.error,
          progressUpdatedAt: this.now(),
        })
        .where(and(eq(operations.id, operation.id), eq(operations.status, "running")))
        .returning({ id: operations.id });
      if (!completed) throw new OperationNotFoundError();

      await transaction.insert(auditEvents).values({
        agentId: agent.id,
        action: "operation.completed",
        metadata: { operationId, status: result.status },
      });
      await transaction.insert(operationEvents).values({
        serverId: operation.serverId,
        operationId,
        type: "completed",
        data: {
          status: result.status,
          error: result.status === "failed" ? result.error : undefined,
        },
      });
    });
    await this.trimEvents(database, operation.serverId);
  }
}

export function createDatabaseAgentService(): AgentService {
  let database: Database | undefined;

  return new DatabaseAgentService(() => {
    if (!process.env.DATABASE_URL) throw new AgentUnavailableError();
    database ??= createDatabase().db;
    return database;
  });
}
