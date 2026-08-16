import { describe, expect, it } from "bun:test";
import type { AuthService } from "./auth";
import type { AuditService } from "./audit";
import { AgentUnauthorizedError, type AgentService } from "./agent-service";
import { FakeAgentAdapter } from "./agent";
import { createApp } from "./index";

describe("control-plane API", () => {
  const appAuth: AuthService = {
    async login() {
      return null;
    },
    async currentUser(token) {
      return token === "session-token"
        ? { id: "user-1", email: "admin@example.com", role: "admin" }
        : null;
    },
    async logout() {},
  };
  const appAudit: AuditService = {
    async record() {},
    async list() {
      return [];
    },
  };
  const app = createApp(
    new FakeAgentAdapter(() => new Date("2026-08-15T22:00:00.000Z")),
    undefined,
    appAuth,
    undefined,
    appAudit,
  );

  it("reports control-plane health", async () => {
    const response = await app.handle(new Request("http://localhost/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "zomboid-control-plane",
      version: "0.1.0",
    });
  });

  it("reports database configuration and connectivity without leaking errors", async () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://test/database";

    try {
      const healthyApp = createApp(undefined, async () => undefined);
      const healthyResponse = await healthyApp.handle(
        new Request("http://localhost/api/health/database"),
      );
      expect(await healthyResponse.json()).toEqual({
        status: "ok",
        service: "postgresql",
      });

      const failingApp = createApp(undefined, async () => {
        throw new Error("database password must not leave the server");
      });
      const failingResponse = await failingApp.handle(
        new Request("http://localhost/api/health/database"),
      );
      expect(await failingResponse.json()).toEqual({
        status: "error",
        service: "postgresql",
      });
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });

  it("enrolls an agent and accepts authenticated heartbeats", async () => {
    const agentService: AgentService = {
      async enroll(input) {
        if (input.enrollmentToken !== "enroll-token") throw new AgentUnauthorizedError();
        return { agentId: "agent-1", accessToken: "agent-access" };
      },
      async heartbeat(agentId, accessToken) {
        if (agentId !== "agent-1" || accessToken !== "agent-access") {
          throw new AgentUnauthorizedError();
        }
      },
      async getStatus() {
        throw new Error("not used in enrollment test");
      },
      async enqueueOperation() {
        throw new Error("not used in enrollment test");
      },
      async enqueueStatus() {
        throw new Error("not used in enrollment test");
      },
      async getOperation() {
        throw new Error("not used in enrollment test");
      },
      async claimNext() {
        throw new Error("not used in enrollment test");
      },
      async completeJob() {
        throw new Error("not used in enrollment test");
      },
    };
    const agentApp = createApp(undefined, undefined, undefined, agentService);
    const enrollment = await agentApp.handle(
      new Request("http://localhost/api/agents/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "production-vps",
          enrollmentToken: "enroll-token",
          server: {
            displayName: "Production",
            serviceName: "zomboid-b42",
            port: 16261,
            runtime: "fex",
            dataDir: "/home/ubuntu/Zomboid",
          },
        }),
      }),
    );
    expect(enrollment.status).toBe(200);
    expect(await enrollment.json()).toEqual({
      agentId: "agent-1",
      accessToken: "agent-access",
    });

    const heartbeat = await agentApp.handle(
      new Request("http://localhost/api/agents/agent-1/heartbeat", {
        method: "POST",
        headers: {
          authorization: "Bearer agent-access",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: {
            protocolVersion: 1,
            serverId: "production",
            serviceName: "zomboid-b42",
            state: "active",
            substate: "running",
            listening: true,
            runtime: "fex",
            gameVersion: "42.20.2",
            uptimeSeconds: 60,
            playerCount: 0,
            checkedAt: "2026-08-16T00:00:00Z",
          },
        }),
      }),
    );
    expect(heartbeat.status).toBe(200);
    expect(await heartbeat.json()).toEqual({ ok: true });

    const missingToken = await agentApp.handle(
      new Request("http://localhost/api/agents/agent-1/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: {
            protocolVersion: 1,
            serverId: "production",
            serviceName: "zomboid-b42",
            state: "active",
            substate: "running",
            listening: true,
            runtime: "fex",
            gameVersion: "42.20.2",
            uptimeSeconds: 60,
            playerCount: 0,
            checkedAt: "2026-08-16T00:00:00Z",
          },
        }),
      }),
    );
    expect(missingToken.status).toBe(401);
  });

  it("queues a status operation and completes it through the agent job boundary", async () => {
    const operation = {
      operationId: "operation-1",
      serverId: "production",
      kind: "status",
      status: "queued",
      createdAt: "2026-08-16T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      error: null,
    } as const;
    const job = {
      operationId: operation.operationId,
      request: {
        protocolVersion: 1 as const,
        requestId: operation.operationId,
        serverId: "production",
        kind: "status" as const,
        payload: {},
      },
    };
    const auth: AuthService = {
      async login() {
        return null;
      },
      async currentUser(token) {
        return token === "session-token"
          ? { id: "user-1", email: "admin@example.com", role: "operator" }
          : null;
      },
      async logout() {},
    };
    let completed = false;
    const agentService: AgentService = {
      async enroll() {
        throw new Error("not used in operation test");
      },
      async heartbeat() {},
      async getStatus() {
        throw new Error("not used in operation test");
      },
      async enqueueOperation() {
        return operation;
      },
      async enqueueStatus() {
        return operation;
      },
      async getOperation() {
        return operation;
      },
      async claimNext(agentId, accessToken) {
        if (agentId !== "agent-1" || accessToken !== "agent-access") {
          throw new AgentUnauthorizedError();
        }
        return job;
      },
      async completeJob(agentId, accessToken) {
        if (agentId !== "agent-1" || accessToken !== "agent-access") {
          throw new AgentUnauthorizedError();
        }
        completed = true;
      },
    };
    const operationApp = createApp(undefined, undefined, auth, agentService);
    const operationRequest = {
      method: "POST",
      headers: {
        cookie: "zomboid_session=session-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ kind: "status", payload: {} }),
    };

    const queued = await operationApp.handle(
      new Request("http://localhost/api/servers/production/operations", operationRequest),
    );
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual(operation);

    const read = await operationApp.handle(
      new Request("http://localhost/api/operations/operation-1", {
        headers: { cookie: "zomboid_session=session-token" },
      }),
    );
    expect(read.status).toBe(200);

    const claimed = await operationApp.handle(
      new Request("http://localhost/api/agents/agent-1/jobs/claim", {
        method: "POST",
        headers: { authorization: "Bearer agent-access" },
      }),
    );
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ job });

    const finished = await operationApp.handle(
      new Request("http://localhost/api/agents/agent-1/jobs/operation-1/complete", {
        method: "POST",
        headers: { authorization: "Bearer agent-access", "content-type": "application/json" },
        body: JSON.stringify({
          status: "succeeded",
          result: {
            protocolVersion: 1,
            serverId: "production",
            serviceName: "zomboid-b42",
            state: "active",
            substate: "running",
            listening: true,
            runtime: "fex",
            gameVersion: "42.20.2",
            uptimeSeconds: 60,
            playerCount: 0,
            checkedAt: "2026-08-16T00:00:00Z",
          },
        }),
      }),
    );
    expect(finished.status).toBe(200);
    expect(completed).toBe(true);

    const viewerAuth: AuthService = {
      async login() {
        return null;
      },
      async currentUser() {
        return { id: "viewer-1", email: "viewer@example.com", role: "viewer" };
      },
      async logout() {},
    };
    const viewerApp = createApp(undefined, undefined, viewerAuth, agentService);
    const forbidden = await viewerApp.handle(
      new Request("http://localhost/api/servers/production/operations", {
        method: "POST",
        headers: {
          cookie: "zomboid_session=session-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "backup", payload: {} }),
      }),
    );
    expect(forbidden.status).toBe(403);
  });

  it("protects sessions with an HttpOnly cookie", async () => {
    const user = {
      id: "user-1",
      email: "admin@example.com",
      role: "admin" as const,
    };
    const auth: AuthService = {
      async login(_email, password) {
        if (password !== "correct-password") return null;
        return {
          token: "session-token",
          expiresAt: "2026-08-22T00:00:00.000Z",
          user,
        };
      },
      async currentUser(token) {
        return token === "session-token" ? user : null;
      },
      async logout() {},
    };
    const authApp = createApp(undefined, undefined, auth);

    const loginResponse = await authApp.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, password: "correct-password" }),
      }),
    );
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await loginResponse.json()).toEqual({
      user,
      expiresAt: "2026-08-22T00:00:00.000Z",
    });

    const meResponse = await authApp.handle(
      new Request("http://localhost/api/auth/me", {
        headers: { cookie: "zomboid_session=session-token" },
      }),
    );
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toEqual({ user });

    const invalidResponse = await authApp.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, password: "wrong" }),
      }),
    );
    expect(invalidResponse.status).toBe(401);
    expect(await invalidResponse.json()).toEqual({
      error: { code: "invalid_credentials", message: "Invalid email or password" },
    });

    const logoutResponse = await authApp.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: "zomboid_session=session-token" },
      }),
    );
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not trust forwarded login IP headers", async () => {
    let observedClientIp: string | undefined = "unset";
    const auth: AuthService = {
      async login(_email, _password, context) {
        observedClientIp = context?.clientIp;
        return {
          token: "session-token",
          expiresAt: "2026-08-22T00:00:00.000Z",
          user: { id: "user-1", email: "admin@example.com", role: "admin" },
        };
      },
      async currentUser() {
        return null;
      },
      async logout() {},
    };
    const loginApp = createApp(undefined, undefined, auth);
    const response = await loginApp.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.10",
        },
        body: JSON.stringify({ email: "admin@example.com", password: "password" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(observedClientIp).toBeUndefined();
  });

  it("requires a session and audits production status reads", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const auditEvents: string[] = [];
    const auth: AuthService = {
      async login() {
        return null;
      },
      async currentUser(token) {
        return token === "session-token"
          ? { id: "user-1", email: "admin@example.com", role: "admin" }
          : null;
      },
      async logout() {},
    };
    const audit: AuditService = {
      async record(event) {
        auditEvents.push(event.action);
      },
      async list() {
        return [];
      },
    };

    try {
      const productionApp = createApp(
        new FakeAgentAdapter(() => new Date("2026-08-15T22:00:00.000Z")),
        undefined,
        auth,
        undefined,
        audit,
        { serveFrontend: false },
      );
      const unauthorized = await productionApp.handle(
        new Request("http://localhost/api/servers/production/status"),
      );
      expect(unauthorized.status).toBe(401);

      const authorized = await productionApp.handle(
        new Request("http://localhost/api/servers/production/status", {
          headers: { cookie: "zomboid_session=session-token" },
        }),
      );
      expect(authorized.status).toBe(200);
      expect(auditEvents).toEqual(["server.status"]);

      const auditResponse = await productionApp.handle(
        new Request("http://localhost/api/audit", {
          headers: { cookie: "zomboid_session=session-token" },
        }),
      );
      expect(auditResponse.status).toBe(200);
      expect(await auditResponse.json()).toEqual({ events: [] });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("requires auth for status outside an explicit development bypass", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBypass = process.env.PZ_DEV_AUTH_BYPASS;
    process.env.NODE_ENV = "production";
    delete process.env.PZ_DEV_AUTH_BYPASS;
    try {
      const unauthorized = await app.handle(
        new Request("http://localhost/api/servers/production/status"),
      );
      expect(unauthorized.status).toBe(401);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousBypass === undefined) delete process.env.PZ_DEV_AUTH_BYPASS;
      else process.env.PZ_DEV_AUTH_BYPASS = previousBypass;
    }
  });

  it("returns typed status from the agent adapter", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/servers/production/status", {
        headers: { cookie: "zomboid_session=session-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      protocolVersion: 1,
      serverId: "production",
      serviceName: "zomboid-b42",
      state: "active",
      substate: "running",
      listening: true,
      runtime: "fex",
      gameVersion: "42.20.2",
      uptimeSeconds: 3600,
      playerCount: 0,
      checkedAt: "2026-08-15T22:00:00.000Z",
    });
  });
});
