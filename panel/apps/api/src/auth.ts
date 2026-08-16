import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
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
  login(
    email: string,
    password: string,
    context?: { clientIp?: string },
  ): Promise<AuthSession | null>;
  currentUser(token: string): Promise<AuthUser | null>;
  logout(token: string): Promise<void>;
}

export class AuthUnavailableError extends Error {
  constructor() {
    super("authentication storage is not configured");
    this.name = "AuthUnavailableError";
  }
}

export class AuthRateLimitError extends Error {
  constructor() {
    super("too many login attempts");
    this.name = "AuthRateLimitError";
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
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim()) || null;
    } catch {
      return null;
    }
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

const DUMMY_PASSWORD_HASH = Bun.password.hash("zomboid-control-plane-dummy-password");
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

type LoginAttempt = { failures: number; lockedUntil: number; lastFailureAt: number };

export class DatabaseAuthService implements AuthService {
  private readonly loginAttempts = new Map<string, LoginAttempt>();
  private lastSessionPrune = 0;

  constructor(
    private readonly getDatabase: () => Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async pruneExpiredSessions(database: Database): Promise<void> {
    const now = this.now();
    if (now.getTime() - this.lastSessionPrune < 60_000) return;
    await database.delete(sessions).where(lte(sessions.expiresAt, now));
    this.lastSessionPrune = now.getTime();
  }

  private pruneLoginAttempts(now: number): void {
    for (const [email, attempt] of this.loginAttempts) {
      if (now - attempt.lastFailureAt > LOGIN_LOCKOUT_MS) this.loginAttempts.delete(email);
    }
    if (this.loginAttempts.size <= 10_000) return;
    const oldest = [...this.loginAttempts.entries()]
      .sort(([, left], [, right]) => left.lastFailureAt - right.lastFailureAt)
      .slice(0, this.loginAttempts.size - 10_000);
    for (const [email] of oldest) this.loginAttempts.delete(email);
  }

  private checkLoginRateLimit(email: string): void {
    const now = this.now().getTime();
    this.pruneLoginAttempts(now);
    const attempt = this.loginAttempts.get(email);
    if (attempt && attempt.lockedUntil > now) throw new AuthRateLimitError();
  }

  private recordLoginFailure(email: string): void {
    const now = this.now().getTime();
    const current = this.loginAttempts.get(email) ?? {
      failures: 0,
      lockedUntil: 0,
      lastFailureAt: now,
    };
    current.failures += 1;
    current.lastFailureAt = now;
    if (current.failures >= LOGIN_FAILURE_LIMIT) current.lockedUntil = now + LOGIN_LOCKOUT_MS;
    this.loginAttempts.set(email, current);
  }

  async login(
    email: string,
    password: string,
    context?: { clientIp?: string },
  ): Promise<AuthSession | null> {
    const normalizedEmail = normalizeEmail(email);
    const rateKey = `${normalizedEmail}:${context?.clientIp ?? "unknown"}`;
    this.checkLoginRateLimit(rateKey);
    const database = this.getDatabase();
    await this.pruneExpiredSessions(database);
    const [user] = await database
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    const passwordHash = user?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    let passwordValid = false;
    try {
      passwordValid = await Bun.password.verify(password, passwordHash);
    } catch {
      passwordValid = false;
    }
    if (!user || !passwordValid) {
      this.recordLoginFailure(rateKey);
      return null;
    }
    this.loginAttempts.delete(rateKey);

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_SECONDS * 1000);
    await database.transaction(async (transaction) => {
      await transaction.insert(sessions).values({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
      });
      await transaction.insert(auditEvents).values({
        actorUserId: user.id,
        action: "auth.login",
        metadata: { method: "password" },
      });
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
    const database = this.getDatabase();
    await this.pruneExpiredSessions(database);
    const [row] = await database
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
