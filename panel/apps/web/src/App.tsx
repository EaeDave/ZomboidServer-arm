import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentStatus,
  AuditEvent,
  AuthUser,
  HealthResponse,
  OperationCreateRequest,
  OperationEvent,
  OperationRecord,
} from "@zomboid/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

const SERVER_ID = import.meta.env.VITE_SERVER_ID || "zomboid-b42";

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

function eventLines(event: OperationEvent): string[] {
  if (event.type !== "log" || typeof event.data !== "object" || event.data === null) return [];
  const lines = (event.data as { lines?: unknown }).lines;
  return Array.isArray(lines)
    ? lines.filter((line): line is string => typeof line === "string")
    : [];
}

function highlightLine(line: string, query: string) {
  if (!query) return line;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = line.split(new RegExp(`(${escaped})`, "ig"));
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark className="rounded bg-amber-300/30 px-0.5 text-amber-100" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
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
      setSelectedOperationId(operation.operationId);
      setLogLines([]);
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
  const [selectedOperationId, setSelectedOperationId] = useState<string>();
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logSearch, setLogSearch] = useState("");
  const [logsPaused, setLogsPaused] = useState(false);
  const [operationMessage, setOperationMessage] = useState<string>();
  const [streamState, setStreamState] = useState<"connecting" | "live" | "reconnecting">(
    "connecting",
  );
  const logEndRef = useRef<HTMLDivElement>(null);
  const selectedOperationRef = useRef<string | undefined>(undefined);
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const canAdmin = user?.role === "admin";
  const activeOperation = operations.data?.find(
    (operation) => operation.status === "queued" || operation.status === "running",
  );
  const visibleLogLines = useMemo(() => {
    const query = logSearch.trim().toLowerCase();
    if (!query) return logLines;
    return logLines.filter((line) => line.toLowerCase().includes(query));
  }, [logLines, logSearch]);
  useEffect(() => {
    selectedOperationRef.current = selectedOperationId;
  }, [selectedOperationId]);
  useEffect(() => {
    const handleAuthExpired = () => queryClient.setQueryData(["auth", "me"], null);
    window.addEventListener("zomboid-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("zomboid-auth-expired", handleAuthExpired);
  }, [queryClient]);
  useEffect(() => {
    if (!operations.data?.length) return;
    const preferred =
      operations.data.find((operation) => operation.status === "running") ?? operations.data[0];
    if (!preferred || selectedOperationId) return;
    setSelectedOperationId(preferred.operationId);
    setLastOperationId(preferred.operationId);
  }, [operations.data, selectedOperationId]);
  useEffect(() => {
    if (!selectedOperationId || !events.data) return;
    const lines = events.data
      .filter((event) => event.operationId === selectedOperationId)
      .flatMap(eventLines)
      .slice(-2_000);
    setLogLines(lines);
  }, [events.data, selectedOperationId]);
  useEffect(() => {
    if (!user) return;
    setStreamState("connecting");
    const stream = new EventSource(`/api/servers/${SERVER_ID}/events/stream?after=0`);
    const setLive = () => setStreamState("live");
    stream.onopen = setLive;
    stream.onerror = () => setStreamState("reconnecting");
    stream.addEventListener("ready", setLive);
    stream.addEventListener("heartbeat", setLive);
    stream.addEventListener("status", (event) => {
      try {
        queryClient.setQueryData(["server-status", SERVER_ID], JSON.parse(event.data));
        setLive();
      } catch {
        setStreamState("reconnecting");
      }
    });
    stream.addEventListener("warning", () => setStreamState("reconnecting"));
    stream.addEventListener("operation", (event) => {
      try {
        const operationEvent = JSON.parse((event as MessageEvent<string>).data) as OperationEvent;
        queryClient.setQueryData<OperationEvent[]>(["operation-events", SERVER_ID], (previous) =>
          [...(previous ?? []), operationEvent].slice(-500),
        );
        void queryClient.invalidateQueries({ queryKey: ["operations", SERVER_ID] });
        if (operationEvent.operationId === selectedOperationRef.current) {
          const lines = eventLines(operationEvent);
          if (lines.length) setLogLines((previous) => [...previous, ...lines].slice(-2_000));
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
        }
        setLive();
      } catch {
        setStreamState("reconnecting");
      }
    });
    return () => stream.close();
  }, [queryClient, user]);
  useEffect(() => {
    if (!logsPaused) logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logLines.length, logsPaused]);
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
              const disabled =
                operationMutation.isPending ||
                Boolean(activeOperation) ||
                (isReadOnly ? !user : !canOperate);
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
                <li key={operation.operationId}>
                  <button
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-zinc-800/70 ${selectedOperationId === operation.operationId ? "bg-zinc-800/80" : ""}`}
                    onClick={() => {
                      setSelectedOperationId(operation.operationId);
                      setLastOperationId(operation.operationId);
                      setOperationMessage(undefined);
                    }}
                    type="button"
                  >
                    <span>{operation.kind}</span>
                    <span className="font-medium text-zinc-200">{operation.status}</span>
                    <time className="text-xs text-zinc-500" dateTime={operation.createdAt}>
                      {new Date(operation.createdAt).toLocaleTimeString()}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Live host log</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Bounded operation output, streamed through the authenticated control plane.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                streamState === "live"
                  ? "bg-emerald-400/10 text-emerald-300"
                  : "bg-amber-400/10 text-amber-300"
              }`}
            >
              {streamState === "live"
                ? "live"
                : streamState === "connecting"
                  ? "connecting"
                  : "reconnecting"}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <select
              aria-label="Operation log source"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none ring-emerald-400 focus:ring-2"
              value={selectedOperationId ?? ""}
              onChange={(event) => {
                setSelectedOperationId(event.target.value || undefined);
                setOperationMessage(undefined);
              }}
            >
              <option value="">Select operation</option>
              {(operations.data ?? []).slice(0, 20).map((operation) => (
                <option key={operation.operationId} value={operation.operationId}>
                  {operation.kind} · {operation.status} ·{" "}
                  {new Date(operation.createdAt).toLocaleTimeString()}
                </option>
              ))}
            </select>
            <input
              aria-label="Search log"
              className="min-w-52 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none ring-emerald-400 focus:ring-2"
              placeholder="Search log lines..."
              value={logSearch}
              onChange={(event) => setLogSearch(event.target.value)}
            />
            <button
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-400"
              onClick={() => setLogsPaused((paused) => !paused)}
              type="button"
            >
              {logsPaused ? "Resume" : "Pause"}
            </button>
            <button
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              onClick={() => setLogLines([])}
              type="button"
            >
              Clear view
            </button>
          </div>
          {operationMessage ? (
            <p className="mt-3 text-sm text-emerald-300">{operationMessage}</p>
          ) : null}
          <div
            className="mt-4 h-80 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-4 font-mono text-xs leading-5 text-zinc-300"
            role="log"
            aria-live="polite"
          >
            {visibleLogLines.length ? (
              visibleLogLines.map((line, index) => (
                <div className="whitespace-pre-wrap break-words" key={`${index}-${line}`}>
                  <span className="mr-3 select-none text-zinc-700">
                    {String(index + 1).padStart(4, "0")}
                  </span>
                  {highlightLine(line, logSearch.trim())}
                </div>
              ))
            ) : (
              <p className="text-zinc-600">No log lines for this operation yet.</p>
            )}
            <div ref={logEndRef} />
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Showing {visibleLogLines.length} matching lines · client buffer capped at 2,000 lines
          </p>
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
              <p className="text-sm text-zinc-400">Mods</p>
              <button
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!user || Boolean(activeOperation) || operationMutation.isPending}
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
                disabled={!canOperate || Boolean(activeOperation) || operationMutation.isPending}
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
