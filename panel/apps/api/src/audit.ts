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
}

export function createDatabaseAuditService(): AuditService {
  let database: Database | undefined;

  return new DatabaseAuditService(() => {
    if (!process.env.DATABASE_URL) throw new AuditUnavailableError();
    database ??= createDatabase().db;
    return database;
  });
}
