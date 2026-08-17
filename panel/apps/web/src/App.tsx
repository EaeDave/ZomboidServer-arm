import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentSettingsReveal,
  AgentStatus,
  AuditEvent,
  AuthUser,
  ConfigUpdatePayload,
  HealthResponse,
  OperationCreateRequest,
  OperationEvent,
  OperationRecord,
} from "@zomboid/contracts";
import { useEffect, useRef, useState } from "react";
import { ServerConsole } from "./ServerConsole";
import { ServerConfiguration } from "./ServerConfiguration";
import { ModManager } from "./ModManager";
import { throwApiError } from "./api-error";

const SERVER_ID = import.meta.env.VITE_SERVER_ID || "zomboid-b42";

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

async function revealServerSettings(serverId: string): Promise<AgentSettingsReveal> {
  const response = await fetch(`/api/servers/${serverId}/settings/reveal`, {
    credentials: "same-origin",
  });
  if (!response.ok) throwApiError(response, `Settings request failed: ${response.status}`);
  return response.json() as Promise<AgentSettingsReveal>;
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

async function getOperations(serverId: string): Promise<OperationRecord[]> {
  const response = await fetch(`/api/servers/${serverId}/operations`, {
    credentials: "same-origin",
  });
  if (!response.ok) throwApiError(response, `Operations request failed: ${response.status}`);
  const body = (await response.json()) as { operations: OperationRecord[] };
  return body.operations;
}

async function getEvents(serverId: string): Promise<OperationEvent[]> {
  const response = await fetch(`/api/servers/${serverId}/events?after=0`, {
    credentials: "same-origin",
  });
  if (!response.ok) throwApiError(response, `Events request failed: ${response.status}`);
  const body = (await response.json()) as { events: OperationEvent[] };
  return body.events;
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
      setOperationMessage("Queued for the host agent.");
      void queryClient.invalidateQueries({ queryKey: ["server-status", SERVER_ID] });
      void queryClient.invalidateQueries({ queryKey: ["operations", SERVER_ID] });
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
  const operations = useQuery({
    queryKey: ["operations", SERVER_ID],
    queryFn: () => getOperations(SERVER_ID),
    enabled: Boolean(user),
    refetchInterval: 10_000,
  });
  const events = useQuery({
    queryKey: ["operation-events", SERVER_ID],
    queryFn: () => getEvents(SERVER_ID),
    enabled: Boolean(user),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [operationMessage, setOperationMessage] = useState<string>();
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const canAdmin = user?.role === "admin";
  const activeOperation = operations.data?.find(
    (operation) => operation.status === "queued" || operation.status === "running",
  );
  useEffect(() => {
    const handleAuthExpired = () => queryClient.setQueryData(["auth", "me"], null);
    window.addEventListener("zomboid-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("zomboid-auth-expired", handleAuthExpired);
  }, [queryClient]);
  useEffect(() => {
    if (!operations.data?.length) return;
    const tracked = operations.data.find((operation) => operation.operationId === lastOperationId);
    const terminal =
      tracked?.status === "succeeded" ||
      tracked?.status === "failed" ||
      tracked?.status === "cancelled";
    if (lastOperationId && !terminal) return;
    const preferred =
      operations.data.find((operation) => operation.status === "running") ?? operations.data[0];
    if (preferred && preferred.operationId !== lastOperationId)
      setLastOperationId(preferred.operationId);
  }, [lastOperationId, operations.data]);
  useEffect(() => {
    if (!user || !events.isFetched) return;
    const stream = new EventSource(`/api/servers/${SERVER_ID}/events/stream?after=0`);
    stream.addEventListener("status", (event) => {
      try {
        queryClient.setQueryData(["server-status", SERVER_ID], JSON.parse(event.data));
      } catch {
        // The next status event or polling refresh reconciles transient parse failures.
      }
    });
    stream.addEventListener("operation", (event) => {
      try {
        const operationEvent = JSON.parse((event as MessageEvent<string>).data) as OperationEvent;
        queryClient.setQueryData<OperationEvent[]>(["operation-events", SERVER_ID], (previous) => {
          const byId = new Map((previous ?? []).map((item) => [item.id, item]));
          byId.set(operationEvent.id, operationEvent);
          return [...byId.values()].sort((left, right) => left.id - right.id).slice(-500);
        });
        if (operationEvent.type !== "log") {
          void queryClient.invalidateQueries({ queryKey: ["operations", SERVER_ID] });
        }
        if (operationEvent.type === "progress" && typeof operationEvent.data === "object") {
          const message = (operationEvent.data as { message?: unknown }).message;
          if (typeof message === "string") setOperationMessage(message);
        }
        if (operationEvent.type === "completed") {
          setOperationMessage(undefined);
          void queryClient.invalidateQueries({
            queryKey: ["operation", operationEvent.operationId],
          });
        }
      } catch {
        // The next persisted event or polling refresh reconciles transient parse failures.
      }
    });
    return () => stream.close();
  }, [events.isFetched, queryClient, user]);
  const [workshopId, setWorkshopId] = useState("");
  const [publicName, setPublicName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [serverPublic, setServerPublic] = useState(true);
  const [revealedPassword, setRevealedPassword] = useState<string>();
  const [resetBackup, setResetBackup] = useState(true);
  const settingsHydratedRef = useRef(false);
  const settingsReveal = useMutation({
    mutationFn: () => revealServerSettings(SERVER_ID),
    onSuccess: (settings) => {
      setRevealedPassword(settings.password);
      window.setTimeout(() => setRevealedPassword(undefined), 30_000);
    },
  });
  useEffect(() => {
    const settings = server.data?.settings;
    if (!settings || settingsHydratedRef.current) return;
    settingsHydratedRef.current = true;
    setPublicName(settings.publicName ?? "");
    setServerPublic(settings.public);
  }, [server.data?.settings]);

  const serverAccessPanel = (
    <section className="mt-8 rounded-2xl border border-emerald-400/20 bg-zinc-900/80 p-6 shadow-2xl shadow-black/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Server access</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Connection details and the settings players use to find and join the server.
          </p>
        </div>
        <StatusPill online={server.data?.state === "active"} />
      </div>
      <form
        className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr_auto] lg:items-start"
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
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Current server details</p>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400">
            <p>
              Public name:{" "}
              <strong className="font-medium text-zinc-200">
                {server.data?.settings?.publicName ?? "Not set"}
              </strong>
            </p>
            <p className="mt-2">
              Join password:{" "}
              <strong className="font-medium text-zinc-200">
                {revealedPassword ??
                  (server.data?.settings?.passwordConfigured ? "Configured" : "Not configured")}
              </strong>
            </p>
            {canAdmin && server.data?.settings?.passwordConfigured ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-emerald-400"
                  disabled={settingsReveal.isPending || Boolean(activeOperation)}
                  onClick={() => {
                    if (revealedPassword) setRevealedPassword(undefined);
                    else if (
                      window.confirm("Reveal the server join password? This action is audited.")
                    )
                      settingsReveal.mutate();
                  }}
                  type="button"
                >
                  {settingsReveal.isPending
                    ? "Reading..."
                    : revealedPassword
                      ? "Hide password"
                      : "Reveal password"}
                </button>
                {revealedPassword ? (
                  <button
                    className="rounded-lg border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-emerald-400"
                    onClick={() => void navigator.clipboard?.writeText(revealedPassword)}
                    type="button"
                  >
                    Copy
                  </button>
                ) : null}
              </div>
            ) : null}
            {settingsReveal.error instanceof Error ? (
              <p className="mt-2 text-rose-300">{settingsReveal.error.message}</p>
            ) : null}
          </div>
          {canAdmin && server.data?.settings?.publicAddress ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400">
              <p className="text-zinc-500">Server address</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="text-zinc-200">
                  {server.data.settings.publicAddress}:{server.data.settings.defaultPort}
                </code>
                <button
                  className="rounded-lg border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-emerald-400"
                  onClick={() =>
                    void navigator.clipboard?.writeText(
                      `${server.data?.settings?.publicAddress}:${server.data?.settings?.defaultPort}`,
                    )
                  }
                  type="button"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">Change settings</p>
          <input
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-emerald-400 focus:ring-2"
            id="public-name"
            name="publicName"
            aria-label="New public name (optional)"
            placeholder="New public name (optional)"
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
        </div>
        <div className="flex flex-col gap-3 lg:min-w-44">
          <p className="text-sm text-zinc-400">Apply</p>
          <p className="text-xs leading-5 text-zinc-500">
            Changes are saved to the server configuration. Restart the server to ensure they take
            effect.
          </p>
          <button
            className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canOperate || Boolean(activeOperation) || operationMutation.isPending}
            type="submit"
          >
            Save settings
          </button>
        </div>
      </form>
    </section>
  );

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

        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          <a
            className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-300 hover:border-emerald-400"
            href="#overview"
          >
            Overview
          </a>
          <a
            className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-300 hover:border-emerald-400"
            href="#configuration"
          >
            Configuration
          </a>
          <a
            className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-300 hover:border-emerald-400"
            href="#server-tools"
          >
            Mods and world
          </a>
        </nav>

        <div id="overview">{serverAccessPanel}</div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <details className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
              <h2 className="text-lg font-medium">Control plane</h2>
              <StatusPill online={health.isSuccess} />
            </summary>
            <pre className="mt-5 overflow-x-auto rounded-xl bg-black/30 p-4 text-sm text-zinc-300">
              {health.isSuccess
                ? JSON.stringify(health.data, null, 2)
                : health.error instanceof Error
                  ? health.error.message
                  : "Checking API..."}
            </pre>
          </details>

          <details className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                  production
                </p>
                <h2 className="mt-1 text-lg font-medium">Project Zomboid</h2>
              </div>
              <StatusPill online={server.data?.state === "active"} />
            </summary>

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
                <div className="col-span-2">
                  <dt className="text-zinc-500">Online players</dt>
                  <dd className="mt-2 flex flex-wrap gap-2">
                    {server.data.onlinePlayers?.length ? (
                      server.data.onlinePlayers.map((player) => (
                        <span
                          className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200"
                          key={player}
                        >
                          {player}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-zinc-400">
                        {server.data.rconAvailable !== true || server.data.playerCount < 0
                          ? "RCON unavailable"
                          : server.data.playerCount > 0
                            ? `${server.data.playerCount} player(s) connected; names unavailable`
                            : "No players connected"}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Socket</dt>
                  <dd className="mt-1 font-medium">
                    {server.data.listening ? "listening" : "not listening"}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-zinc-500">Steam Relay telemetry</dt>
                  <dd className="mt-1 font-medium">
                    {server.data.steamSession
                      ? `${server.data.steamSession.evidence.replace("_", " ")} (${server.data.steamSession.mode})`
                      : "not reported by this agent"}
                  </dd>
                  {server.data.steamSession?.message ? (
                    <p className="mt-1 text-xs font-normal text-zinc-500">
                      {server.data.steamSession.message}
                    </p>
                  ) : null}
                  {server.data.steamSession?.checkedAt ? (
                    <time
                      className="mt-1 block text-xs font-normal text-zinc-500"
                      dateTime={server.data.steamSession.checkedAt}
                    >
                      Last sampled: {new Date(server.data.steamSession.checkedAt).toLocaleString()}
                    </time>
                  ) : null}
                </div>
              </dl>
            ) : (
              <p className="mt-6 text-sm text-zinc-400">
                {server.error instanceof Error ? server.error.message : "Checking server agent..."}
              </p>
            )}
          </details>
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
            <button
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!user || server.isFetching}
              onClick={() => void server.refetch()}
              type="button"
            >
              {server.isFetching ? "Refreshing status..." : "Refresh status"}
            </button>
            {[
              ["start", "Start"],
              ["stop", "Stop"],
              ["restart", "Restart"],
              ["backup", "Backup"],
            ].map(([kind, label]) => {
              const disabled =
                operationMutation.isPending || Boolean(activeOperation) || !canOperate;
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
          {activeOperation ? (
            <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-amber-200">
                  {activeOperation.kind} in progress
                </span>
                <span className="text-xs uppercase tracking-[0.15em] text-amber-300/70">
                  target: {activeOperation.targetState ?? "unknown"}
                </span>
              </div>
              <p className="mt-2 text-zinc-400">
                {operationMessage ??
                  activeOperation.progressMessage ??
                  "Waiting for the host agent..."}
              </p>
              {activeOperation.startedAt ? (
                <time
                  className="mt-2 block text-xs text-zinc-600"
                  dateTime={activeOperation.startedAt}
                >
                  Started {new Date(activeOperation.startedAt).toLocaleString()}
                </time>
              ) : null}
            </div>
          ) : null}
          {operations.isSuccess ? (
            <ul className="mt-5 space-y-2 text-sm text-zinc-400">
              {operations.data.slice(0, 5).map((operation) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2"
                  key={operation.operationId}
                >
                  <span>{operation.kind}</span>
                  <span className="font-medium text-zinc-200">{operation.status}</span>
                  <time className="text-xs text-zinc-500" dateTime={operation.createdAt}>
                    {new Date(operation.createdAt).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <ServerConfiguration
          busy={Boolean(activeOperation) || operationMutation.isPending}
          onQueue={(payload: ConfigUpdatePayload) =>
            operationMutation.mutateAsync({ kind: "config.update", payload })
          }
          serverId={SERVER_ID}
          user={user}
        />

        <ServerConsole serverId={SERVER_ID} enabled={Boolean(user)} />

        <section
          className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20"
          id="server-tools"
        >
          <h2 className="text-lg font-medium">Server tools</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
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
                  !canOperate ||
                  Boolean(activeOperation) ||
                  !/^[0-9]{6,20}$/.test(workshopId) ||
                  operationMutation.isPending
                }
                type="submit"
              >
                Add mod
              </button>
            </form>

            <div className="space-y-3">
              <p className="text-sm text-zinc-400">Configured mods</p>
              {server.data?.mods ? (
                <div className="space-y-3 text-xs">
                  <div>
                    <p className="mb-1 text-zinc-500">Collections</p>
                    <div className="flex flex-wrap gap-2">
                      {(server.data.mods.collections ?? []).length ? (
                        (server.data.mods.collections ?? []).map((collection) => (
                          <a
                            className="rounded-lg border border-zinc-700 px-2 py-1 text-emerald-300 hover:border-emerald-400"
                            href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${collection.id}`}
                            key={collection.id}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {collection.title}
                          </a>
                        ))
                      ) : (
                        <span className="text-zinc-600">No collection source recorded</span>
                      )}
                    </div>
                  </div>
                  <details className="rounded-lg border border-zinc-800 p-3">
                    <summary className="cursor-pointer text-zinc-300">
                      {(server.data.mods.configuredItems ?? []).length} configured Workshop mods
                    </summary>
                    <div className="mt-3 grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
                      {(server.data.mods.configuredItems ?? []).map((item) => (
                        <a
                          className="rounded-md bg-zinc-950 px-2 py-1.5 text-zinc-300 hover:text-emerald-300"
                          href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.workshopId}`}
                          key={item.workshopId}
                          rel="noreferrer"
                          target="_blank"
                          title={item.modIds.join(", ")}
                        >
                          {item.title}
                        </a>
                      ))}
                    </div>
                  </details>
                  {server.data.mods.inactiveModIds.length ? (
                    <div>
                      <p className="mb-1 text-zinc-500">Inactive</p>
                      <p className="break-words text-zinc-400">
                        {server.data.mods.inactiveModIds.join(", ")}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">Waiting for the agent mod snapshot…</p>
              )}
            </div>
          </div>
          <div className="mt-5 border-t border-zinc-800 pt-5">
            <ModManager
              busy={Boolean(activeOperation) || operationMutation.isPending}
              canOperate={Boolean(canOperate)}
              mods={server.data?.mods}
              onQueue={(request) => operationMutation.mutateAsync(request)}
            />
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
              disabled={!canAdmin || Boolean(activeOperation) || operationMutation.isPending}
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
