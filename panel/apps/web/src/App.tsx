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
import { useEffect, useState, type ReactNode } from "react";
import { ActivityPage } from "./ActivityPage";
import { throwApiError } from "./api-error";
import { ModsPage } from "./ModsPage";
import { OverviewPage, type AccessUpdate } from "./OverviewPage";
import { PageHeading, PanelHeader, usePanelPage } from "./PanelNav";
import { ServerConfiguration } from "./ServerConfiguration";
import { ServerConsole } from "./ServerConsole";

const SERVER_ID = import.meta.env.VITE_SERVER_ID || "zomboid-b42";

type LifecycleOperation = Extract<
  OperationCreateRequest["kind"],
  "start" | "stop" | "restart" | "backup"
>;

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
  if (!response.ok || !body.user) throw new Error(body.error?.message ?? "Login failed");
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
  const body = (await response.json()) as {
    error?: { message?: string };
  } & Partial<OperationRecord>;
  if (!response.ok) throwApiError(response, body.error?.message ?? "Operation could not be queued");
  return body as OperationRecord;
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
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ user, onLogout }: { user?: AuthUser; onLogout?: () => void }) {
  const queryClient = useQueryClient();
  const { page, navigate } = usePanelPage();
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 30_000 });
  const server = useQuery({
    queryKey: ["server-status", SERVER_ID],
    queryFn: () => getServerStatus(SERVER_ID),
    refetchInterval: 15_000,
  });
  const operationMutation = useMutation({
    mutationFn: queueOperation,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["server-status", SERVER_ID] });
      void queryClient.invalidateQueries({ queryKey: ["operations", SERVER_ID] });
    },
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
  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: getAudit,
    enabled: user?.role === "admin",
    refetchInterval: 15_000,
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
    if (!user || !events.isFetched) return;
    const stream = new EventSource(`/api/servers/${SERVER_ID}/events/stream?after=0`);
    stream.addEventListener("status", (event) => {
      try {
        queryClient.setQueryData(["server-status", SERVER_ID], JSON.parse(event.data));
      } catch {
        // Polling reconciles transient event parse failures.
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
          void queryClient.invalidateQueries({ queryKey: ["operations", SERVER_ID] });
          void queryClient.invalidateQueries({ queryKey: ["server-status", SERVER_ID] });
        }
      } catch {
        // Polling reconciles transient event parse failures.
      }
    });
    return () => stream.close();
  }, [events.isFetched, queryClient, user]);

  const queueLifecycle = (kind: LifecycleOperation) => {
    operationMutation.mutate({ kind, payload: {} } as OperationCreateRequest);
  };
  const updateAccess = async (update: AccessUpdate) => {
    await operationMutation.mutateAsync({
      kind: "settings.update",
      payload: update,
    } as OperationCreateRequest);
  };
  const queueOperationRequest = (request: OperationCreateRequest) =>
    operationMutation.mutateAsync(request);
  const busy = Boolean(activeOperation) || operationMutation.isPending;

  let content: ReactNode;
  if (page === "overview") {
    content = (
      <OverviewPage
        activeOperation={activeOperation}
        canAdmin={Boolean(canAdmin)}
        canOperate={Boolean(canOperate)}
        onQueue={queueLifecycle}
        onRefresh={() => void server.refetch()}
        onRevealSettings={() => revealServerSettings(SERVER_ID)}
        onUpdateSettings={updateAccess}
        operationMessage={operationMessage}
        operationPending={operationMutation.isPending}
        panelHealthy={health.isSuccess}
        server={server.data}
        serverError={server.error instanceof Error ? server.error.message : undefined}
        serverFetching={server.isFetching}
        operations={operations.data}
      />
    );
  } else if (page === "settings") {
    content = (
      <div className="space-y-5">
        <PageHeading
          eyebrow="Configuration"
          title="Settings"
          description="Start with common gameplay controls or search the full server and Sandbox configuration when you need advanced options."
        />
        <ServerConfiguration
          busy={busy}
          onQueue={(payload: ConfigUpdatePayload) =>
            operationMutation.mutateAsync({ kind: "config.update", payload })
          }
          serverId={SERVER_ID}
          user={user}
        />
      </div>
    );
  } else if (page === "mods") {
    content = (
      <ModsPage
        busy={busy}
        canAdmin={Boolean(canAdmin)}
        canOperate={Boolean(canOperate)}
        mods={server.data?.mods}
        onQueue={queueOperationRequest}
      />
    );
  } else if (page === "logs") {
    content = (
      <div className="space-y-5">
        <PageHeading
          eyebrow="Observability"
          title="Logs"
          description="Follow bounded server output when you need to troubleshoot a warning or verify a restart."
        />
        <ServerConsole serverId={SERVER_ID} enabled={Boolean(user)} />
      </div>
    );
  } else {
    content = (
      <ActivityPage
        audit={audit.data}
        auditError={audit.error instanceof Error ? audit.error.message : undefined}
        auditLoading={audit.isPending}
        canAdmin={Boolean(canAdmin)}
        health={health.data}
        operations={operations.data}
        server={server.data}
      />
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <PanelHeader onLogout={onLogout} onNavigate={navigate} page={page} user={user} />
        {operationMutation.error instanceof Error ? (
          <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">
            {operationMutation.error.message}
          </p>
        ) : null}
        <div className="mt-6">{content}</div>
      </div>
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
    onSuccess: (user) => queryClient.setQueryData(["auth", "me"], user),
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
        Checking session…
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
      onLogout={authEnabled ? () => logoutMutation.mutate() : undefined}
      user={currentUser.data ?? undefined}
    />
  );
}
