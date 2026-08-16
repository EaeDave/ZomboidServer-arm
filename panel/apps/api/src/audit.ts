import { desc } from "drizzle-orm";
import type { AuditEvent } from "@zomboid/contracts";
import { auditEvents } from "@zomboid/db";
import { createDatabase, type Database } from "@zomboid/db/client";

export interface AuditRecord {
  action: string;
  actorUserId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditService {
  record(event: AuditRecord): Promise<void>;
  list(limit: number): Promise<AuditEvent[]>;
}

export class AuditUnavailableError extends Error {
  constructor() {
    super("audit storage is not configured");
    this.name = "AuditUnavailableError";
  }
}

export class DatabaseAuditService implements AuditService {
  constructor(private readonly getDatabase: () => Database) {}

  async record(event: AuditRecord): Promise<void> {
    await this.getDatabase().insert(auditEvents).values({
      action: event.action,
      actorUserId: event.actorUserId,
      agentId: event.agentId,
      metadata: event.metadata,
    });
  }

  async list(limit: number): Promise<AuditEvent[]> {
    const rows = await this.getDatabase()
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        actorUserId: auditEvents.actorUserId,
        agentId: auditEvents.agentId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

export function createDatabaseAuditService(): AuditService {
  let database: Database | undefined;

  return new DatabaseAuditService(() => {
    if (!process.env.DATABASE_URL) throw new AuditUnavailableError();
    database ??= createDatabase().db;
    return database;
  });
}
