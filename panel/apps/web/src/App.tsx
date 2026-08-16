import { useQuery } from "@tanstack/react-query";
import type { AgentStatus, HealthResponse } from "@zomboid/contracts";

async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error(`Health request failed: ${response.status}`);
  return response.json() as Promise<HealthResponse>;
}

async function getServerStatus(serverId: string): Promise<AgentStatus> {
  const response = await fetch(`/api/servers/${serverId}/status`);
  if (!response.ok) throw new Error(`Server status request failed: ${response.status}`);
  return response.json() as Promise<AgentStatus>;
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        online ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"
      }`}
    >
      {online ? "online" : "offline"}
    </span>
  );
}

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const server = useQuery({
    queryKey: ["server-status", "production"],
    queryFn: () => getServerStatus("production"),
    refetchInterval: 15_000,
  });

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <section className="mx-auto max-w-5xl">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.3em] text-emerald-400">
          Zomboid Control Plane
        </p>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Host control, without host shell access.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-zinc-400">
          A typed control plane keeps the web interface separate from the FEX-powered Project
          Zomboid host.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-medium">Control plane</h2>
              <StatusPill online={health.isSuccess} />
            </div>
            <pre className="mt-5 overflow-x-auto rounded-xl bg-black/30 p-4 text-sm text-zinc-300">
              {health.isSuccess
                ? JSON.stringify(health.data, null, 2)
                : health.error instanceof Error
                  ? health.error.message
                  : "Checking API..."}
            </pre>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                  production
                </p>
                <h2 className="mt-1 text-lg font-medium">Project Zomboid</h2>
              </div>
              <StatusPill online={server.data?.state === "active"} />
            </div>

            {server.isSuccess ? (
              <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-zinc-500">Runtime</dt>
                  <dd className="mt-1 font-medium uppercase">{server.data.runtime}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Build</dt>
                  <dd className="mt-1 font-medium">{server.data.gameVersion ?? "unknown"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Players</dt>
                  <dd className="mt-1 font-medium">
                    {server.data.playerCount < 0 ? "unknown" : server.data.playerCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Socket</dt>
                  <dd className="mt-1 font-medium">
                    {server.data.listening ? "listening" : "not listening"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-6 text-sm text-zinc-400">
                {server.error instanceof Error ? server.error.message : "Checking server agent..."}
              </p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
