import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  client: Sql;
  db: Database;
}

export function createDatabase(connectionString = process.env.DATABASE_URL): DatabaseHandle {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT ?? 5),
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
