import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { swagger } from "@elysiajs/swagger";
import { Type } from "@sinclair/typebox";
import { Elysia } from "elysia";
import {
  agentStatusSchema,
  databaseHealthResponseSchema,
  healthResponseSchema,
} from "@zomboid/contracts";
import { checkDatabase } from "@zomboid/db/client";
import { FakeAgentAdapter, type AgentAdapter } from "./agent";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const version = process.env.npm_package_version ?? "0.1.0";
type DatabaseCheck = () => Promise<void>;

export function createApp(
  agent: AgentAdapter = new FakeAgentAdapter(),
  databaseCheck: DatabaseCheck = () => checkDatabase(),
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
    .get("/api/servers/:serverId/status", ({ params }) => agent.getStatus(params.serverId), {
      params: Type.Object({
        serverId: Type.String({ minLength: 1 }),
      }),
      response: agentStatusSchema,
    });

  if (process.env.NODE_ENV === "production") {
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
