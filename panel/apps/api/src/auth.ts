import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { auditEvents, sessions, users } from "@zomboid/db";
import { createDatabase, type Database } from "@zomboid/db/client";

export const SESSION_COOKIE_NAME = "zomboid_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type AuthRole = "admin" | "operator" | "viewer";

const roleRank: Record<AuthRole, number> = { viewer: 0, operator: 1, admin: 2 };

export function roleAtLeast(role: AuthRole, required: AuthRole): boolean {
  return roleRank[role] >= roleRank[required];
}

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export interface AuthService {
  login(email: string, password: string): Promise<AuthSession | null>;
  currentUser(token: string): Promise<AuthUser | null>;
  logout(token: string): Promise<void>;
}

export class AuthUnavailableError extends Error {
  constructor() {
    super("authentication storage is not configured");
    this.name = "AuthUnavailableError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashSessionToken(token: string): string {
  const secret = process.env.SESSION_SECRET ?? "development-only-session-secret";
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    return decodeURIComponent(entry.slice(separator + 1).trim()) || null;
  }

  return null;
}

export function serializeSessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  const publicUrl = process.env.PUBLIC_URL ?? "";
  const secure = process.env.NODE_ENV === "production" || publicUrl.startsWith("https://");
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function serializeClearedSessionCookie(): string {
  return serializeSessionCookie("", 0);
}

export class DatabaseAuthService implements AuthService {
  constructor(
    private readonly getDatabase: () => Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(email: string, password: string): Promise<AuthSession | null> {
    const database = this.getDatabase();
    const [user] = await database
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .limit(1);

    if (!user || !(await Bun.password.verify(password, user.passwordHash))) return null;

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_SECONDS * 1000);
    await database.insert(sessions).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
    await database.insert(auditEvents).values({
      actorUserId: user.id,
      action: "auth.login",
      metadata: { method: "password" },
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  async currentUser(token: string): Promise<AuthUser | null> {
    const [row] = await this.getDatabase()
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, this.now())),
      )
      .limit(1);

    return row ?? null;
  }

  async logout(token: string): Promise<void> {
    await this.getDatabase()
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(token)));
  }
}

export function createDatabaseAuthService(): AuthService {
  let database: Database | undefined;

  return new DatabaseAuthService(() => {
    if (!process.env.DATABASE_URL) throw new AuthUnavailableError();
    if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
      throw new AuthUnavailableError();
    }
    database ??= createDatabase().db;
    return database;
  });
}
