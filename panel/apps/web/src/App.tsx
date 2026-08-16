import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentStatus, AuthUser, HealthResponse } from "@zomboid/contracts";

async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error(`Health request failed: ${response.status}`);
  return response.json() as Promise<HealthResponse>;
}

async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Authentication service is unavailable");
  const body = (await response.json()) as { user: AuthUser };
  return body.user;
}

async function login(email: string, password: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { user?: AuthUser; error?: { message?: string } };
  if (!response.ok || !body.user) {
    throw new Error(body.error?.message ?? "Login failed");
  }
  return body.user;
}

async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Logout failed");
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

function LoginScreen({
  error,
  isPending,
  onSubmit,
}: {
  error: string | null;
  isPending: boolean;
  onSubmit: (email: string, password: string) => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12 text-zinc-100">
      <form
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 shadow-2xl shadow-black/20"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSubmit(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        }}
      >
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-emerald-400">
          Zomboid Control Plane
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Use an account provisioned by the control plane administrator.
        </p>

        <label className="mt-8 block text-sm text-zinc-300" htmlFor="email">
          Email
        </label>
        <input
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none ring-emerald-400 focus:ring-2"
          id="email"
          name="email"
          required
          type="email"
          autoComplete="username"
        />

        <label className="mt-5 block text-sm text-zinc-300" htmlFor="password">
          Password
        </label>
        <input
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none ring-emerald-400 focus:ring-2"
          id="password"
          name="password"
          required
          type="password"
          autoComplete="current-password"
        />

        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        <button
          className="mt-6 w-full rounded-xl bg-emerald-400 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const server = useQuery({
    queryKey: ["server-status", "production"],
    queryFn: () => getServerStatus("production"),
    refetchInterval: 15_000,
  });

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <section className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-[0.3em] text-emerald-400">
              Zomboid Control Plane
            </p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Host control, without host shell access.
            </h1>
          </div>
          {user && onLogout ? (
            <button
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
              onClick={onLogout}
              type="button"
            >
              Sign out
            </button>
          ) : null}
        </div>
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

export default function App() {
  const queryClient = useQueryClient();
  const authEnabled = !import.meta.env.DEV;
  const currentUser = useQuery({
    queryKey: ["auth", "me"],
    queryFn: getCurrentUser,
    enabled: authEnabled,
    retry: false,
  });
  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: (user) => {
      queryClient.setQueryData(["auth", "me"], user);
    },
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], null);
    },
  });

  if (authEnabled && currentUser.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Checking session...
      </main>
    );
  }

  if (authEnabled && !currentUser.data) {
    return (
      <LoginScreen
        error={
          loginMutation.error instanceof Error
            ? loginMutation.error.message
            : currentUser.error instanceof Error
              ? currentUser.error.message
              : null
        }
        isPending={loginMutation.isPending}
        onSubmit={(email, password) => loginMutation.mutate({ email, password })}
      />
    );
  }

  return (
    <Dashboard
      user={currentUser.data ?? undefined}
      onLogout={authEnabled ? () => logoutMutation.mutate() : undefined}
    />
  );
}
