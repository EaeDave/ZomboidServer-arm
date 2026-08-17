import { isIP } from "node:net";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { swagger } from "@elysiajs/swagger";
import { Type } from "@sinclair/typebox";
import { Elysia } from "elysia";
import {
  agentEnrollmentRequestSchema,
  agentEnrollmentResponseSchema,
  agentConsoleLogRequestSchema,
  agentConsoleLogResponseSchema,
  agentHeartbeatRequestSchema,
  agentHeartbeatResponseSchema,
  agentJobCompleteRequestSchema,
  agentJobCompleteResponseSchema,
  agentJobLogRequestSchema,
  agentJobProgressRequestSchema,
  agentJobResponseSchema,
  agentOperationErrorResponseSchema,
  agentStatusSchema,
  agentSettingsRevealSchema,
  auditListResponseSchema,
  authErrorResponseSchema,
  authLoginRequestSchema,
  authLogoutResponseSchema,
  authMeResponseSchema,
  authSessionResponseSchema,
  consoleLogListResponseSchema,
  databaseHealthResponseSchema,
  healthResponseSchema,
  operationCreateRequestSchema,
  operationEventListResponseSchema,
  operationListResponseSchema,
  operationRecordSchema,
} from "@zomboid/contracts";
import { checkDatabase } from "@zomboid/db/client";
import {
  AuthRateLimitError,
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
  AgentAlreadyEnrolledError,
  AgentCursorMismatchError,
  AgentPayloadError,
  AgentStatusMismatchError,
  AgentUnauthorizedError,
  AgentUnavailableError,
  createDatabaseAgentService,
  OperationConflictError,
  OperationNotFoundError,
  ServerNotFoundError,
  type AgentService,
} from "./agent-service";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const version = process.env.npm_package_version ?? "0.1.0";
const webDist = `${import.meta.dir}/../../web/dist`;
// These operations are routed through the root-owned pz-agent-priv allowlist on the VPS.
const supportedOperationKinds = new Set([
  "status",
  "start",
  "stop",
  "restart",
  "backup",
  "mods.list",
  "mods.add",
  "mods.remove",
  "settings.update",
  "world.reset",
]);
type DatabaseCheck = () => Promise<void>;
type AppOptions = { serveFrontend?: boolean };

const corsOrigin =
  process.env.PUBLIC_URL ??
  (process.env.NODE_ENV === "development"
    ? ["http://127.0.0.1:5173", "http://localhost:5173"]
    : false);

function createDefaultAgentAdapter(): AgentAdapter {
  const useFakeAgent = process.env.NODE_ENV !== "production" && process.env.PZ_FAKE_AGENT === "1";
  return useFakeAgent ? new FakeAgentAdapter() : createDatabaseAgentService();
}

function bearerToken(request: Request): string | null {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

interface SseEvent {
  event: string;
  data: unknown;
  id?: number;
}

function streamCursor(request: Request) {
  const streamUrl = new URL(request.url);
  const lastEventId = request.headers.get("last-event-id");
  const headerCursor = lastEventId === null ? Number.NaN : Number(lastEventId);
  const queryCursor = Number(streamUrl.searchParams.get("after") ?? "");
  const cursor = Number.isInteger(headerCursor) && headerCursor >= 0 ? headerCursor : queryCursor;
  return Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
}

function pollingSseResponse(
  request: Request,
  initialCursor: number,
  warningMessage: string,
  poll: (cursor: number) => Promise<{ cursor: number; events: SseEvent[] }>,
) {
  const encoder = new TextEncoder();
  const write = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
    id?: number,
  ) => {
    const prefix = id === undefined ? "" : `id: ${id}\n`;
    try {
      controller.enqueue(
        encoder.encode(`${prefix}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
      return true;
    } catch {
      return false;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cursor = initialCursor;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may have already closed the response.
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      if (!write(controller, "ready", { cursor })) return close();
      while (!closed) {
        try {
          const update = await poll(cursor);
          cursor = update.cursor;
          for (const item of update.events) {
            if (!write(controller, item.event, item.data, item.id)) return close();
          }
          if (!write(controller, "heartbeat", { cursor })) return close();
        } catch {
          if (!closed && !write(controller, "warning", { message: warningMessage })) return close();
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
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
    .use(cors({ origin: corsOrigin, credentials: true }))
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
          if (error instanceof AgentAlreadyEnrolledError) {
            set.status = 409;
            return { error: { code: "already_enrolled", message: "Server is already enrolled" } };
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
          409: agentOperationErrorResponseSchema,
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
          if (error instanceof AgentStatusMismatchError) {
            set.status = 400;
            return {
              error: {
                code: "invalid_status",
                message: "Status identity does not match the agent",
              },
            };
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
          400: agentOperationErrorResponseSchema,
          401: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/auth/login",
      async ({ body, request, server, set }) => {
        try {
          const peerIp = server?.requestIP(request)?.address;
          const trustedProxyIps = new Set(
            (process.env.TRUSTED_PROXY_IPS ?? "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          );
          const forwardedIp = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
          // Forwarded headers are accepted only from explicitly configured proxy peers.
          const clientIp =
            peerIp && trustedProxyIps.has(peerIp) && forwardedIp && isIP(forwardedIp)
              ? forwardedIp
              : peerIp;
          const session = await auth.login(body.email, body.password, { clientIp });
          if (!session) {
            set.status = 401;
            return {
              error: { code: "invalid_credentials", message: "Invalid email or password" },
            };
          }

          set.headers["set-cookie"] = serializeSessionCookie(session.token);
          return { user: session.user, expiresAt: session.expiresAt };
        } catch (error) {
          if (error instanceof AuthRateLimitError) {
            set.status = 429;
            return { error: { code: "rate_limited", message: "Too many login attempts" } };
          }
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
          429: authErrorResponseSchema,
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
    .get(
      "/api/audit",
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
          if (!roleAtLeast(user.role, "admin")) {
            set.status = 403;
            return { error: { code: "forbidden", message: "Administrator role required" } };
          }
          return { events: await audit.list(100) };
        } catch (error) {
          set.status =
            error instanceof AuthUnavailableError || error instanceof AuditUnavailableError
              ? 503
              : 500;
          return {
            error: {
              code:
                error instanceof AuditUnavailableError || error instanceof AuthUnavailableError
                  ? "audit_unavailable"
                  : "audit_error",
              message: "Audit history is temporarily unavailable",
            },
          };
        }
      },
      {
        response: {
          200: auditListResponseSchema,
          401: agentOperationErrorResponseSchema,
          403: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
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
          body.kind === "status" || body.kind === "mods.list"
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
          if (error instanceof ServerNotFoundError) {
            set.status = 404;
            return { error: { code: "server_not_found", message: "Server was not found" } };
          }
          if (error instanceof OperationConflictError) {
            set.status = 409;
            return {
              error: {
                code: "operation_conflict",
                message: "Another operation is already queued or running for this server",
              },
            };
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
          409: agentOperationErrorResponseSchema,
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
    .get(
      "/api/servers/:serverId/operations",
      async ({ params, query, request, set }) => {
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
          const parsed = Number(query.limit ?? 50);
          const limit = Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 100)) : 50;
          return { operations: await agentService.listOperations(params.serverId, limit) };
        } catch (error) {
          set.status = error instanceof AuthUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AuthUnavailableError ? "auth_unavailable" : "operation_error",
              message: "Operation history could not be read",
            },
          };
        }
      },
      {
        params: Type.Object({ serverId: Type.String({ minLength: 1 }) }),
        query: Type.Object({ limit: Type.Optional(Type.String()) }),
        response: {
          200: operationListResponseSchema,
          401: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .get(
      "/api/servers/:serverId/events",
      async ({ params, query, request, set }) => {
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
          const parsed = Number(query.after ?? 0);
          const after = Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
          const events = await agentService.listEvents(params.serverId, after);
          return { events, cursor: events.at(-1)?.id ?? after };
        } catch (error) {
          set.status = error instanceof AuthUnavailableError ? 503 : 500;
          return {
            error: {
              code: error instanceof AuthUnavailableError ? "auth_unavailable" : "operation_error",
              message: "Operation events could not be read",
            },
          };
        }
      },
      {
        params: Type.Object({ serverId: Type.String({ minLength: 1 }) }),
        query: Type.Object({ after: Type.Optional(Type.String()) }),
        response: {
          200: operationEventListResponseSchema,
          401: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .get(
      "/api/servers/:serverId/console",
      async ({ params, query, request, set }) => {
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
          const parsed = Number(query.after ?? 0);
          const after = Number.isInteger(parsed) ? Math.max(0, parsed) : 0;
          const logs = await agentService.listConsoleLogs(params.serverId, after);
          return { logs, cursor: logs.at(-1)?.id ?? after };
        } catch (error) {
          if (error instanceof ServerNotFoundError) {
            set.status = 404;
            return { error: { code: "server_not_found", message: "Server was not found" } };
          }
          if (error instanceof AuthUnavailableError) {
            set.status = 503;
            return {
              error: {
                code: "auth_unavailable",
                message: "Authentication is temporarily unavailable",
              },
            };
          }
          const unavailable = error instanceof AgentUnavailableError;
          set.status = unavailable ? 503 : 500;
          return {
            error: {
              code: unavailable ? "agent_unavailable" : "console_error",
              message: "Server console could not be read",
            },
          };
        }
      },
      {
        params: Type.Object({ serverId: Type.String({ minLength: 1 }) }),
        query: Type.Object({ after: Type.Optional(Type.String()) }),
        response: {
          200: consoleLogListResponseSchema,
          401: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .get("/api/servers/:serverId/events/stream", async ({ params, request, set }) => {
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
      } catch (error) {
        set.status = error instanceof AuthUnavailableError ? 503 : 500;
        return {
          error: {
            code: error instanceof AuthUnavailableError ? "auth_unavailable" : "auth_error",
            message: "Event stream is temporarily unavailable",
          },
        };
      }

      let lastStatusAt = 0;
      return pollingSseResponse(
        request,
        streamCursor(request),
        "Realtime update temporarily unavailable",
        async (cursor) => {
          const events = await agentService.listEvents(params.serverId, cursor);
          const streamEvents: SseEvent[] = events.map((event) => ({
            event: "operation",
            data: event,
            id: event.id,
          }));
          const nextCursor = events.at(-1)?.id ?? cursor;
          if (Date.now() - lastStatusAt >= 5_000) {
            try {
              streamEvents.push({ event: "status", data: await agent.getStatus(params.serverId) });
            } catch {
              streamEvents.push({
                event: "warning",
                data: { message: "Server status is temporarily unavailable" },
              });
            }
            lastStatusAt = Date.now();
          }
          return { cursor: nextCursor, events: streamEvents };
        },
      );
    })
    .get("/api/servers/:serverId/console/stream", async ({ params, request, set }) => {
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
      } catch (error) {
        set.status = error instanceof AuthUnavailableError ? 503 : 500;
        return {
          error: {
            code: error instanceof AuthUnavailableError ? "auth_unavailable" : "auth_error",
            message: "Console stream is temporarily unavailable",
          },
        };
      }

      try {
        // Reject unknown/deleted servers before creating an unbounded polling stream.
        await agentService.listConsoleLogs(params.serverId, 0);
      } catch (error) {
        if (error instanceof ServerNotFoundError) {
          set.status = 404;
          return { error: { code: "server_not_found", message: "Server was not found" } };
        }
        const unavailable =
          error instanceof AuthUnavailableError || error instanceof AgentUnavailableError;
        set.status = unavailable ? 503 : 500;
        return {
          error: {
            code: unavailable ? "agent_unavailable" : "console_error",
            message: "Console stream is temporarily unavailable",
          },
        };
      }

      return pollingSseResponse(
        request,
        streamCursor(request),
        "Console update temporarily unavailable",
        async (cursor) => {
          const logs = await agentService.listConsoleLogs(params.serverId, cursor);
          return {
            cursor: logs.at(-1)?.id ?? cursor,
            events: logs.map((log) => ({ event: "console", data: log, id: log.id })),
          };
        },
      );
    })
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
    .post(
      "/api/agents/:agentId/jobs/:operationId/progress",
      async ({ body, params, request, set }) => {
        const token = bearerToken(request);
        if (!token) {
          set.status = 401;
          return { error: { code: "missing_agent_token", message: "Bearer token required" } };
        }
        try {
          await agentService.progressJob(params.agentId, token, params.operationId, body.message);
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
          if (error instanceof AgentUnavailableError) {
            set.status = 503;
            return {
              error: { code: "agent_unavailable", message: "Operation progress was not accepted" },
            };
          }
          set.status = 500;
          return { error: { code: "agent_error", message: "Operation progress was not accepted" } };
        }
      },
      {
        params: Type.Object({
          agentId: Type.String({ minLength: 1 }),
          operationId: Type.String({ minLength: 1 }),
        }),
        body: agentJobProgressRequestSchema,
        response: {
          200: agentJobCompleteResponseSchema,
          401: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/agents/:agentId/jobs/:operationId/logs",
      async ({ body, params, request, set }) => {
        const token = bearerToken(request);
        if (!token) {
          set.status = 401;
          return { error: { code: "missing_agent_token", message: "Bearer token required" } };
        }
        try {
          await agentService.appendJobLogs(
            params.agentId,
            token,
            params.operationId,
            body.cursor,
            body.lines,
          );
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
          if (error instanceof AgentPayloadError) {
            set.status = 400;
            return { error: { code: "invalid_agent_payload", message: error.message } };
          }
          if (error instanceof AgentUnavailableError) {
            set.status = 503;
            return {
              error: { code: "agent_unavailable", message: "Operation logs were not accepted" },
            };
          }
          set.status = 500;
          return { error: { code: "agent_error", message: "Operation logs were not accepted" } };
        }
      },
      {
        params: Type.Object({
          agentId: Type.String({ minLength: 1 }),
          operationId: Type.String({ minLength: 1 }),
        }),
        body: agentJobLogRequestSchema,
        response: {
          200: agentJobCompleteResponseSchema,
          400: agentOperationErrorResponseSchema,
          401: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .post(
      "/api/agents/:agentId/console",
      async ({ body, params, request, set }) => {
        const token = bearerToken(request);
        if (!token) {
          set.status = 401;
          return { error: { code: "missing_agent_token", message: "Bearer token required" } };
        }
        try {
          const cursor = await agentService.appendConsoleLogs(
            params.agentId,
            token,
            body.serverId,
            body.cursor,
            body.lines,
            body.resync ?? false,
            body.resyncId,
          );
          return { ok: true as const, cursor };
        } catch (error) {
          if (error instanceof AgentUnauthorizedError) {
            set.status = 401;
            return { error: { code: "invalid_agent_token", message: "Invalid agent token" } };
          }
          if (error instanceof ServerNotFoundError) {
            set.status = 404;
            return { error: { code: "server_not_found", message: "Server was not found" } };
          }
          if (error instanceof AgentPayloadError) {
            set.status = 400;
            return { error: { code: "invalid_agent_payload", message: error.message } };
          }
          if (error instanceof AgentCursorMismatchError) {
            set.status = 409;
            return { error: { code: "console_cursor_mismatch", message: error.message } };
          }
          if (error instanceof AgentUnavailableError) {
            set.status = 503;
            return {
              error: { code: "agent_unavailable", message: "Console logs were not accepted" },
            };
          }
          set.status = 500;
          return { error: { code: "agent_error", message: "Console logs were not accepted" } };
        }
      },
      {
        params: Type.Object({ agentId: Type.String({ minLength: 1 }) }),
        body: agentConsoleLogRequestSchema,
        response: {
          200: agentConsoleLogResponseSchema,
          400: agentOperationErrorResponseSchema,
          401: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          409: agentOperationErrorResponseSchema,
          500: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .get(
      "/api/servers/:serverId/settings/reveal",
      async ({ params, request, set }) => {
        set.headers["cache-control"] = "no-store";
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
          return { error: { code: "auth_unavailable", message: "Authentication is unavailable" } };
        }
        if (!user) {
          set.status = 401;
          return { error: { code: "unauthenticated", message: "Login required" } };
        }
        if (user.role !== "admin") {
          set.status = 403;
          return { error: { code: "forbidden", message: "Admin role required" } };
        }
        if (!agentService.readSettings) {
          set.status = 503;
          return { error: { code: "agent_unavailable", message: "Settings are unavailable" } };
        }
        try {
          const settings = await agentService.readSettings(params.serverId, user.id);
          await audit.record({
            action: "server.settings.revealed",
            actorUserId: user.id,
            metadata: { serverId: params.serverId },
          });
          return settings;
        } catch (error) {
          if (error instanceof ServerNotFoundError) {
            set.status = 404;
            return { error: { code: "server_not_found", message: "Server was not found" } };
          }
          if (error instanceof OperationConflictError) {
            set.status = 409;
            return { error: { code: "operation_conflict", message: error.message } };
          }
          set.status = 503;
          return { error: { code: "agent_unavailable", message: "Settings are unavailable" } };
        }
      },
      {
        params: Type.Object({ serverId: Type.String({ minLength: 1 }) }),
        response: {
          200: agentSettingsRevealSchema,
          401: agentOperationErrorResponseSchema,
          403: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          409: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    )
    .get(
      "/api/servers/:serverId/status",
      async ({ params, request, set }) => {
        let actorUserId: string | undefined;
        let actorRole: "admin" | "operator" | "viewer" | undefined;
        const devAuthBypass =
          process.env.NODE_ENV === "development" && process.env.PZ_DEV_AUTH_BYPASS === "1";
        if (!devAuthBypass) {
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
            actorRole = user.role;
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

        let status: Awaited<ReturnType<AgentAdapter["getStatus"]>>;
        try {
          status = await agent.getStatus(params.serverId);
        } catch (error) {
          if (error instanceof ServerNotFoundError) {
            set.status = 404;
            return { error: { code: "server_not_found", message: "Server was not found" } };
          }
          set.status = 503;
          return {
            error: { code: "agent_unavailable", message: "Host agent status is unavailable" },
          };
        }

        if (actorUserId) {
          try {
            await audit.record({
              action: "server.status",
              actorUserId,
              metadata: { serverId: params.serverId },
            });
          } catch (error) {
            console.error("failed to record server.status audit event", error);
          }
        }
        if (actorRole !== "admin" && status.settings?.publicAddress) {
          status = {
            ...status,
            settings: { ...status.settings, publicAddress: null },
          };
        }
        return status;
      },
      {
        params: Type.Object({
          serverId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: agentStatusSchema,
          401: agentOperationErrorResponseSchema,
          404: agentOperationErrorResponseSchema,
          503: agentOperationErrorResponseSchema,
        },
      },
    );

  const serveFrontend =
    options.serveFrontend ??
    (process.env.NODE_ENV === "production" || process.env.PZ_SERVE_FRONTEND === "1");
  if (serveFrontend) {
    app.get("/", () => Bun.file(`${webDist}/index.html`));
    app.use(staticPlugin({ assets: webDist, prefix: "/", indexHTML: true }));
  }

  return app;
}

export const app = createApp();

if (import.meta.main) {
  app.listen({ hostname: host, port });
  console.log(`Zomboid control plane listening on http://${host}:${port}`);
}
