import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  client: Sql;
  db: Database;
}

function positiveSetting(name: string, fallback: number, integer = false): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a positive${integer ? " integer" : " number"}`);
  }
  return value;
}

export function createDatabase(connectionString = process.env.DATABASE_URL): DatabaseHandle {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(connectionString, {
    max: positiveSetting("DATABASE_POOL_MAX", 10, true),
    connect_timeout: positiveSetting("DATABASE_CONNECT_TIMEOUT", 5, true),
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export async function checkDatabase(connectionString = process.env.DATABASE_URL): Promise<void> {
  const { client } = createDatabase(connectionString);

  try {
    await client`select 1`;
  } finally {
    await client.end({ timeout: 5 });
  }
}
