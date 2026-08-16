import { describe, expect, it } from "bun:test";
import { FakeAgentAdapter } from "./agent";
import { createApp } from "./index";

describe("control-plane API", () => {
  const app = createApp(new FakeAgentAdapter(() => new Date("2026-08-15T22:00:00.000Z")));

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

  it("returns typed status from the agent adapter", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/servers/production/status"),
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
