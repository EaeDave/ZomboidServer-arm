import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentStatus,
  AuditEvent,
  AuthUser,
  HealthResponse,
  OperationCreateRequest,
  OperationRecord,
} from "@zomboid/contracts";
import { useEffect, useState } from "react";

const SERVER_ID = "zomboid-b42";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function throwApiError(response: Response, message: string): never {
  if (response.status === 401) window.dispatchEvent(new Event("zomboid-auth-expired"));
  throw new ApiError(message, response.status);
}

async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) throwApiError(response, `Health request failed: ${response.status}`);
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
  if (!response.ok) throwApiError(response, `Server status request failed: ${response.status}`);
  return response.json() as Promise<AgentStatus>;
}

async function queueOperation(requestBody: OperationCreateRequest): Promise<OperationRecord> {
  const response = await fetch(`/api/servers/${SERVER_ID}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(requestBody),
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) throwApiError(response, body.error?.message ?? "Operation could not be queued");
  return body as OperationRecord;
}

async function getOperation(operationId: string): Promise<OperationRecord> {
  const response = await fetch(`/api/operations/${operationId}`, { credentials: "same-origin" });
  if (!response.ok) throwApiError(response, `Operation request failed: ${response.status}`);
  return response.json() as Promise<OperationRecord>;
}

async function getAudit(): Promise<AuditEvent[]> {
  const response = await fetch("/api/audit", { credentials: "same-origin" });
  if (!response.ok) throwApiError(response, `Audit request failed: ${response.status}`);
  const body = (await response.json()) as { events: AuditEvent[] };
  return body.events;
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
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const server = useQuery({
    queryKey: ["server-status", SERVER_ID],
    queryFn: () => getServerStatus(SERVER_ID),
    refetchInterval: 15_000,
  });
  const [lastOperationId, setLastOperationId] = useState<string>();
  const operationMutation = useMutation({
    mutationFn: queueOperation,
    onSuccess: (operation) => {
      setLastOperationId(operation.operationId);
      void queryClient.invalidateQueries({ queryKey: ["server-status", SERVER_ID] });
    },
  });
  const lastOperation = useQuery({
    queryKey: ["operation", lastOperationId],
    queryFn: () => getOperation(lastOperationId!),
    enabled: Boolean(lastOperationId),
    refetchInterval: (query) => {
      if (!lastOperationId) return false;
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" || status === "cancelled"
        ? false
        : 2_000;
    },
  });
  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: getAudit,
    enabled: user?.role === "admin",
    refetchInterval: 15_000,
  });
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const canAdmin = user?.role === "admin";
  useEffect(() => {
    const handleAuthExpired = () => queryClient.setQueryData(["auth", "me"], null);
    window.addEventListener("zomboid-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("zomboid-auth-expired", handleAuthExpired);
  }, [queryClient]);
  const [workshopId, setWorkshopId] = useState("");
  const [publicName, setPublicName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [serverPublic, setServerPublic] = useState(true);
  const [resetBackup, setResetBackup] = useState(true);

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

        <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Operations</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Jobs are queued for the outbound host agent; the browser never calls systemd
                directly.
              </p>
            </div>
            {user ? (
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">{user.role}</span>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {[
              ["status", "Queue status"],
              ["start", "Start"],
              ["stop", "Stop"],
              ["restart", "Restart"],
              ["backup", "Backup"],
              ["logs", "Fetch logs"],
            ].map(([kind, label]) => {
              const isReadOnly = kind === "status" || kind === "logs";
              const disabled = operationMutation.isPending || (isReadOnly ? !user : !canOperate);
              return (
                <button
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={disabled}
                  key={kind}
                  onClick={() => {
                    if (
                      (kind === "stop" || kind === "restart") &&
                      !window.confirm(`${label} production server?`)
                    )
                      return;
                    operationMutation.mutate({
                      kind: kind as OperationCreateRequest["kind"],
                      payload: {},
                    } as OperationCreateRequest);
                  }}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
          {operationMutation.error instanceof Error ? (
            <p className="mt-4 text-sm text-rose-300">{operationMutation.error.message}</p>
          ) : null}
          {lastOperation.isSuccess ? (
            <p className="mt-4 text-sm text-zinc-400">
              Last operation:{" "}
              <span className="font-medium text-zinc-200">{lastOperation.data.kind}</span>{" "}
              <span className="text-emerald-300">{lastOperation.data.status}</span>
            </p>
          ) : null}
        </section>

        <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
          <h2 className="text-lg font-medium">Server tools</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                operationMutation.mutate({
                  kind: "mods.add",
                  payload: { workshopId },
                } as OperationCreateRequest);
              }}
            >
              <label className="block text-sm text-zinc-400" htmlFor="workshop-id">
                Add Workshop mod
              </label>
              <input
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-emerald-400 focus:ring-2"
                id="workshop-id"
                inputMode="numeric"
                pattern="[0-9]{6,20}"
                placeholder="Workshop ID"
                value={workshopId}
                onChange={(event) => setWorkshopId(event.target.value)}
              />
              <button
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={
                  !canOperate || !/^[0-9]{6,20}$/.test(workshopId) || operationMutation.isPending
                }
                type="submit"
              >
                Add mod
              </button>
            </form>

            <div className="space-y-3">
              <p className="text-sm text-zinc-400">Mods</p>
              <button
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!user || operationMutation.isPending}
                onClick={() => operationMutation.mutate({ kind: "mods.list", payload: {} })}
                type="button"
              >
                Refresh mod list
              </button>
            </div>

            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const payload = {
                  public: serverPublic,
                  ...(publicName ? { publicName } : {}),
                  ...(joinPassword ? { password: joinPassword } : {}),
                };
                operationMutation.mutate({
                  kind: "settings.update",
                  payload,
                } as OperationCreateRequest);
              }}
            >
              <p className="text-sm text-zinc-400">Settings</p>
              <input
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-emerald-400 focus:ring-2"
                id="public-name"
                name="publicName"
                aria-label="Public name (optional)"
                placeholder="Public name (optional)"
                value={publicName}
                onChange={(event) => setPublicName(event.target.value)}
              />
              <input
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-emerald-400 focus:ring-2"
                id="join-password"
                name="joinPassword"
                aria-label="New join password (optional)"
                autoComplete="new-password"
                placeholder="New join password (optional)"
                type="password"
                value={joinPassword}
                onChange={(event) => setJoinPassword(event.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  checked={serverPublic}
                  onChange={(event) => setServerPublic(event.target.checked)}
                  type="checkbox"
                />
                Public server
              </label>
              <button
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!canOperate || operationMutation.isPending}
                type="submit"
              >
                Queue settings
              </button>
            </form>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-zinc-800 pt-5">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                checked={resetBackup}
                onChange={(event) => setResetBackup(event.target.checked)}
                type="checkbox"
              />
              Backup before reset
            </label>
            <button
              className="rounded-xl border border-rose-500/50 px-3 py-2 text-sm text-rose-300 hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canAdmin || operationMutation.isPending}
              onClick={() => {
                if (!window.confirm("This deletes the production world and player data. Continue?"))
                  return;
                operationMutation.mutate({
                  kind: "world.reset",
                  payload: { confirm: true, createBackup: resetBackup },
                } as OperationCreateRequest);
              }}
              type="button"
            >
              Queue world reset
            </button>
          </div>
          {lastOperation.isSuccess && lastOperation.data.result !== undefined ? (
            <pre className="mt-5 overflow-x-auto rounded-xl bg-black/30 p-4 text-xs text-zinc-400">
              {JSON.stringify(lastOperation.data.result, null, 2)}
            </pre>
          ) : null}
        </section>

        {user?.role === "admin" ? (
          <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-medium">Recent audit events</h2>
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">admin</span>
            </div>
            {audit.isSuccess ? (
              <ul className="mt-5 space-y-3 text-sm">
                {audit.data.slice(0, 5).map((event) => (
                  <li
                    className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-3"
                    key={event.id}
                  >
                    <span className="font-medium text-zinc-200">{event.action}</span>
                    <time className="text-zinc-500" dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                  </li>
                ))}
                {audit.data.length === 0 ? <li className="text-zinc-500">No events yet.</li> : null}
              </ul>
            ) : (
              <p className="mt-5 text-sm text-zinc-400">
                {audit.error instanceof Error ? audit.error.message : "Loading audit history..."}
              </p>
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const authEnabled = import.meta.env.PROD || import.meta.env.VITE_DEV_AUTH_BYPASS !== "1";
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
      queryClient.clear();
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
