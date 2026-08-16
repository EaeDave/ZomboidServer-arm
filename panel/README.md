# Zomboid control plane

Initial control-plane workspace for the ZomboidServer-arm project.

## Local development

Requires Bun 1.4+ and PostgreSQL for database-backed work. The foundation slice exposes health endpoints, a typed fake-agent status endpoint and the first
Drizzle/PostgreSQL migration. Run `bun run db:migrate` only with a configured `DATABASE_URL`; real
production access still waits for the host agent and authentication layers.

```bash
cp .env.example .env
bun install
bun run check
bun run db:generate # only when the schema changes
bun run dev:api
# in another terminal
bun run dev:web
```

- API: <http://127.0.0.1:3000/api/health>
- Fake server status: <http://127.0.0.1:3000/api/servers/production/status>
- OpenAPI: <http://127.0.0.1:3000/docs>
- Frontend: <http://127.0.0.1:5173>

## Deployment model

Coolify builds the control-plane image from the repository. The image must not contain the PZ
server, FEX RootFS, worlds or saves. A future host `pz-agent` will provide the narrow, allowlisted operations over a private
authenticated transport. See [`docs/deployment-coolify.md`](../docs/deployment-coolify.md) for
Coolify configuration and the safe rollout sequence.
