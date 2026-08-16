import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import type {
  AgentEnrollmentRequest,
  AgentJob,
  AgentJobCompleteRequest,
  AgentOperationRequest,
  AgentStatus,
  OperationCreateRequest,
  OperationRecord,
} from "@zomboid/contracts";
import { agents, auditEvents, operations, serverInstances } from "@zomboid/db";
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
  claimNext(agentId: string, accessToken: string): Promise<AgentJob | null>;
  completeJob(
    agentId: string,
    accessToken: string,
    operationId: string,
    result: AgentJobCompleteRequest,
  ): Promise<void>;
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

export class DatabaseAgentService implements AgentService {
  constructor(
    private readonly getDatabase: () => Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
      .select({ id: serverInstances.id, serviceName: serverInstances.serviceName })
      .from(serverInstances)
      .where(eq(serverInstances.serviceName, serverId))
      .limit(1);

    if (!server) throw new ServerNotFoundError();

    return database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(operations)
        .values({
          serverId: server.id,
          actorUserId,
          kind: request.kind,
          payload: request.payload,
        })
        .returning({
          operationId: operations.id,
          status: operations.status,
          createdAt: operations.createdAt,
          startedAt: operations.startedAt,
          finishedAt: operations.finishedAt,
          error: operations.error,
        });

      if (!created) throw new Error("operation was not created");

      const record = operationRecord({
        ...created,
        serverId: server.serviceName,
        kind: request.kind,
      });
      await transaction.insert(auditEvents).values({
        actorUserId,
        action: "operation.queued",
        metadata: { operationId: record.operationId, serverId, kind: record.kind },
      });
      return record;
    });
  }

  async enqueueStatus(serverId: string, actorUserId: string): Promise<OperationRecord> {
    return this.enqueueOperation(serverId, actorUserId, { kind: "status", payload: {} });
  }

  async getOperation(operationId: string): Promise<OperationRecord> {
    const [row] = await this.getDatabase()
      .select({
        operationId: operations.id,
        serverId: serverInstances.serviceName,
        kind: operations.kind,
        status: operations.status,
        createdAt: operations.createdAt,
        startedAt: operations.startedAt,
        finishedAt: operations.finishedAt,
        error: operations.error,
        result: operations.result,
      })
      .from(operations)
      .innerJoin(serverInstances, eq(operations.serverId, serverInstances.id))
      .where(eq(operations.id, operationId))
      .limit(1);

    if (!row) throw new OperationNotFoundError();
    return operationRecord(row);
  }

  async claimNext(agentId: string, accessToken: string): Promise<AgentJob | null> {
    const database = this.getDatabase();
    const agent = await this.authorizeAgent(agentId, accessToken);
    const [candidate] = await database
      .select({
        operationId: operations.id,
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

    const [claimed] = await database
      .update(operations)
      .set({ status: "running", startedAt: this.now() })
      .where(and(eq(operations.id, candidate.operationId), eq(operations.status, "queued")))
      .returning({ id: operations.id });

    if (!claimed) return null;

    return {
      operationId: claimed.id,
      request: operationRequest(claimed.id, candidate.serverId, candidate.kind, candidate.payload),
    };
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
      .select({ id: operations.id })
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
        })
        .where(and(eq(operations.id, operation.id), eq(operations.status, "running")))
        .returning({ id: operations.id });
      if (!completed) throw new OperationNotFoundError();

      await transaction.insert(auditEvents).values({
        agentId: agent.id,
        action: "operation.completed",
        metadata: { operationId, status: result.status },
      });
    });
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
