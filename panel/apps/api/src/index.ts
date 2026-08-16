import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { swagger } from "@elysiajs/swagger";
import { Type } from "@sinclair/typebox";
import { Elysia } from "elysia";
import {
  agentEnrollmentRequestSchema,
  agentEnrollmentResponseSchema,
  agentHeartbeatRequestSchema,
  agentHeartbeatResponseSchema,
  agentJobCompleteRequestSchema,
  agentJobCompleteResponseSchema,
  agentJobResponseSchema,
  agentOperationErrorResponseSchema,
  agentStatusSchema,
  authErrorResponseSchema,
  authLoginRequestSchema,
  authLogoutResponseSchema,
  authMeResponseSchema,
  authSessionResponseSchema,
  databaseHealthResponseSchema,
  healthResponseSchema,
  operationCreateRequestSchema,
  operationRecordSchema,
} from "@zomboid/contracts";
import { checkDatabase } from "@zomboid/db/client";
import {
  AuthUnavailableError,
  createDatabaseAuthService,
  readSessionToken,
  serializeClearedSessionCookie,
  roleAtLeast,
  serializeSessionCookie,
  type AuthService,
} from "./auth";
import { AuditUnavailableError, createDatabaseAuditService, type AuditService } from "./audit";
import { FakeAgentAdapter, type AgentAdapter } from "./agent";
import {
  AgentUnauthorizedError,
  AgentUnavailableError,
  createDatabaseAgentService,
  OperationNotFoundError,
  type AgentService,
} from "./agent-service";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const version = process.env.npm_package_version ?? "0.1.0";
// These operations are routed through the root-owned pz-agent-priv allowlist on the VPS.
const supportedOperationKinds = new Set([
  "status",
  "start",
  "stop",
  "restart",
  "logs",
  "backup",
  "mods.list",
  "mods.add",
  "mods.remove",
  "settings.update",
  "world.reset",
]);
type DatabaseCheck = () => Promise<void>;
type AppOptions = { serveFrontend?: boolean };

function createDefaultAgentAdapter(): AgentAdapter {
  return process.env.NODE_ENV === "production"
    ? createDatabaseAgentService()
    : new FakeAgentAdapter();
}

function bearerToken(request: Request): string | null {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function createApp(
  agent: AgentAdapter = createDefaultAgentAdapter(),
  databaseCheck: DatabaseCheck = () => checkDatabase(),
  auth: AuthService = createDatabaseAuthService(),
  agentService: AgentService = createDatabaseAgentService(),
  audit: AuditService = createDatabaseAuditService(),
  options: AppOptions = {},
) {
  const app = new Elysia({ name: "zomboid-control-plane" })
    .use(cors())
    .use(
      swagger({
        path: "/docs",
        documentation: {
          info: {
            title: "Zomboid Control Plane API",
            version,
          },
        },
      }),
    )
    .get(
      "/api/health",
      () => ({
        status: "ok" as const,
        service: "zomboid-control-plane" as const,
        version,
      }),
      { response: healthResponseSchema },
    )
    .get(
      "/api/health/database",
      async () => {
        if (!process.env.DATABASE_URL) {
          return { status: "not_configured" as const, service: "postgresql" as const };
        }

        try {
          await databaseCheck();
          return { status: "ok" as const, service: "postgresql" as const };
        } catch {
          return { status: "error" as const, service: "postgresql" as const };
        }
      },
      { response: databaseHealthResponseSchema },
    )
    .post(
      "/api/agents/enroll",
      async ({ body, set }) => {
        try {
          return await agentService.enroll(body);
        } catch (error) {
          if (error instanceof AgentUnauthorizedError) {
            set.status = 401;
            return { error: { code: "invalid_enrollment", message: "Invalid enrollment token" } };
          }
          set.status = error instanceof AgentUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AgentUnavailableError ? "agent_unavailable" : "agent_error",
              message: "Agent enrollment is temporarily unavailable",
            },
          };
        }
      },
      {
        body: agentEnrollmentRequestSchema,
        response: {
          200: agentEnrollmentResponseSchema,
          401: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/agents/:agentId/heartbeat",
      async ({ body, params, request, set }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const match = authorization.match(/^Bearer\s+(.+)$/i);
        if (!match?.[1]) {
          set.status = 401;
          return { error: { code: "missing_agent_token", message: "Bearer token required" } };
        }

        try {
          await agentService.heartbeat(params.agentId, match[1], body.status);
          return { ok: true as const };
        } catch (error) {
          if (error instanceof AgentUnauthorizedError) {
            set.status = 401;
            return { error: { code: "invalid_agent_token", message: "Invalid agent token" } };
          }
          set.status = error instanceof AgentUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AgentUnavailableError ? "agent_unavailable" : "agent_error",
              message: "Agent heartbeat is temporarily unavailable",
            },
          };
        }
      },
      {
        params: Type.Object({ agentId: Type.String({ minLength: 1 }) }),
        body: agentHeartbeatRequestSchema,
        response: {
          200: agentHeartbeatResponseSchema,
          401: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/auth/login",
      async ({ body, set }) => {
        try {
          const session = await auth.login(body.email, body.password);
          if (!session) {
            set.status = 401;
            return {
              error: { code: "invalid_credentials", message: "Invalid email or password" },
            };
          }

          set.headers["set-cookie"] = serializeSessionCookie(session.token);
          return { user: session.user, expiresAt: session.expiresAt };
        } catch (error) {
          set.status = error instanceof AuthUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AuthUnavailableError ? "auth_unavailable" : "auth_error",
              message: "Authentication is temporarily unavailable",
            },
          };
        }
      },
      {
        body: authLoginRequestSchema,
        response: {
          200: authSessionResponseSchema,
          401: authErrorResponseSchema,
          500: authErrorResponseSchema,
          503: authErrorResponseSchema,
        },
      },
    )
    .get(
      "/api/auth/me",
      async ({ request, set }) => {
        const token = readSessionToken(request.headers.get("cookie"));
        if (!token) {
          set.status = 401;
          return { error: { code: "unauthenticated", message: "Login required" } };
        }

        try {
          const user = await auth.currentUser(token);
          if (!user) {
            set.status = 401;
            return { error: { code: "unauthenticated", message: "Login required" } };
          }
          return { user };
        } catch (error) {
          set.status = error instanceof AuthUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AuthUnavailableError ? "auth_unavailable" : "auth_error",
              message: "Authentication is temporarily unavailable",
            },
          };
        }
      },
      {
        response: {
          200: authMeResponseSchema,
          401: authErrorResponseSchema,
          500: authErrorResponseSchema,
          503: authErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/auth/logout",
      async ({ request, set }) => {
        const token = readSessionToken(request.headers.get("cookie"));
        try {
          if (token) await auth.logout(token);
          set.headers["set-cookie"] = serializeClearedSessionCookie();
          return { ok: true as const };
        } catch (error) {
          set.status = error instanceof AuthUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AuthUnavailableError ? "auth_unavailable" : "auth_error",
              message: "Authentication is temporarily unavailable",
            },
          };
        }
      },
      {
        response: {
          200: authLogoutResponseSchema,
          500: authErrorResponseSchema,
          503: authErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/servers/:serverId/operations",
      async ({ body, params, request, set }) => {
        const token = readSessionToken(request.headers.get("cookie"));
        if (!token) {
          set.status = 401;
          return { error: { code: "unauthenticated", message: "Login required" } };
        }

        let user;
        try {
          user = await auth.currentUser(token);
        } catch {
          set.status = 503;
          return {
            error: {
              code: "auth_unavailable",
              message: "Authentication is temporarily unavailable",
            },
          };
        }
        if (!user) {
          set.status = 401;
          return { error: { code: "unauthenticated", message: "Login required" } };
        }
        if (!supportedOperationKinds.has(body.kind)) {
          set.status = 400;
          return {
            error: { code: "operation_disabled", message: "This operation is not enabled yet" },
          };
        }
        const requiredRole =
          body.kind === "status" || body.kind === "logs" || body.kind === "mods.list"
            ? "viewer"
            : body.kind === "world.reset"
              ? "admin"
              : "operator";
        if (!roleAtLeast(user.role, requiredRole)) {
          set.status = 403;
          return { error: { code: "forbidden", message: "Insufficient role for this operation" } };
        }

        try {
          const operation = await agentService.enqueueOperation(params.serverId, user.id, body);
          set.status = 202;
          return operation;
        } catch (error) {
          if (error instanceof OperationNotFoundError) {
            set.status = 404;
            return { error: { code: "operation_not_found", message: "Server was not found" } };
          }
          set.status = error instanceof AgentUnavailableError ? 503 : 500;
          return {
            error: {
              code:
                error instanceof AgentUnavailableError ? "agent_unavailable" : "operation_error",
              message: "Operation could not be queued",
            },
          };
        }
      },
      {
        params: Type.Object({ serverId: Type.String({ minLength: 1 }) }),
        body: operationCreateRequestSchema,
        response: {
          202: operationRecordSchema,
          400: agentOperationErrorResponseSchema,
          401: agentOperationErrorResponseSchema,
          403: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .get(
      "/api/operations/:operationId",
      async ({ params, request, set }) => {
        const token = readSessionToken(request.headers.get("cookie"));
        if (!token) {
          set.status = 401;
          return { error: { code: "unauthenticated", message: "Login required" } };
        }

        try {
          if (!(await auth.currentUser(token))) {
            set.status = 401;
            return { error: { code: "unauthenticated", message: "Login required" } };
          }
          return await agentService.getOperation(params.operationId);
        } catch (error) {
          if (error instanceof OperationNotFoundError) {
            set.status = 404;
            return { error: { code: "operation_not_found", message: "Operation was not found" } };
          }
          set.status = error instanceof AuthUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AuthUnavailableError ? "auth_unavailable" : "operation_error",
              message: "Operation could not be read",
            },
          };
        }
      },
      {
        params: Type.Object({ operationId: Type.String({ minLength: 1 }) }),
        response: {
          200: operationRecordSchema,
          401: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/agents/:agentId/jobs/claim",
      async ({ params, request, set }) => {
        const token = bearerToken(request);
        if (!token) {
          set.status = 401;
          return { error: { code: "missing_agent_token", message: "Bearer token required" } };
        }

        try {
          return { job: await agentService.claimNext(params.agentId, token) };
        } catch (error) {
          if (error instanceof AgentUnauthorizedError) {
            set.status = 401;
            return { error: { code: "invalid_agent_token", message: "Invalid agent token" } };
          }
          set.status = error instanceof AgentUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AgentUnavailableError ? "agent_unavailable" : "agent_error",
              message: "Agent job queue is temporarily unavailable",
            },
          };
        }
      },
      {
        params: Type.Object({ agentId: Type.String({ minLength: 1 }) }),
        response: {
          200: agentJobResponseSchema,
          401: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/agents/:agentId/jobs/:operationId/complete",
      async ({ body, params, request, set }) => {
        const token = bearerToken(request);
        if (!token) {
          set.status = 401;
          return { error: { code: "missing_agent_token", message: "Bearer token required" } };
        }

        try {
          await agentService.completeJob(params.agentId, token, params.operationId, body);
          return { ok: true as const };
        } catch (error) {
          if (error instanceof AgentUnauthorizedError) {
            set.status = 401;
            return { error: { code: "invalid_agent_token", message: "Invalid agent token" } };
          }
          if (error instanceof OperationNotFoundError) {
            set.status = 404;
            return { error: { code: "operation_not_found", message: "Operation was not found" } };
          }
          set.status = error instanceof AgentUnavailableError ? 503 : 400;
          return {
            error: {
              code: error instanceof AgentUnavailableError ? "agent_unavailable" : "invalid_result",
              message: "Operation result was not accepted",
            },
          };
        }
      },
      {
        params: Type.Object({
          agentId: Type.String({ minLength: 1 }),
          operationId: Type.String({ minLength: 1 }),
        }),
        body: agentJobCompleteRequestSchema,
        response: {
          200: agentJobCompleteResponseSchema,
          400: agentOperationErrorResponseSchema,
          401: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .get(
      "/api/servers/:serverId/status",
      async ({ params, request, set }) => {
        let actorUserId: string | undefined;
        if (process.env.NODE_ENV === "production") {
          const token = readSessionToken(request.headers.get("cookie"));
          if (!token) {
            set.status = 401;
            return { error: { code: "unauthenticated", message: "Login required" } };
          }

          try {
            const user = await auth.currentUser(token);
            if (!user) {
              set.status = 401;
              return { error: { code: "unauthenticated", message: "Login required" } };
            }
            actorUserId = user.id;
          } catch {
            set.status = 503;
            return {
              error: {
                code: "auth_unavailable",
                message: "Authentication is temporarily unavailable",
              },
            };
          }
        }

        try {
          const status = await agent.getStatus(params.serverId);
          if (actorUserId) {
            await audit.record({
              action: "server.status",
              actorUserId,
              metadata: { serverId: params.serverId },
            });
          }
          return status;
        } catch (error) {
          set.status = 503;
          return {
            error: {
              code:
                error instanceof AuditUnavailableError ? "audit_unavailable" : "agent_unavailable",
              message: "Host agent status is unavailable",
            },
          };
        }
      },
      {
        params: Type.Object({
          serverId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: agentStatusSchema,
          401: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    );

  if (options.serveFrontend ?? process.env.NODE_ENV === "production") {
    app.get("/", () => Bun.file("apps/web/dist/index.html"));
    app.use(staticPlugin({ assets: "apps/web/dist", prefix: "/", indexHTML: true }));
  }

  return app;
}

export const app = createApp();

if (import.meta.main) {
  app.listen({ hostname: host, port });
  console.log(`Zomboid control plane listening on http://${host}:${port}`);
}
