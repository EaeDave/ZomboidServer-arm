import type {
  AgentSettingsReveal,
  AgentStatus,
  OperationKind,
  OperationRecord,
} from "@zomboid/contracts";
import { useEffect, useState, type FormEvent } from "react";

export type AccessUpdate = {
  public: boolean;
  publicName?: string;
  password?: string;
};

type Tone = "success" | "warning" | "danger" | "neutral";

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const classes = {
    success: "bg-emerald-400/10 text-emerald-300",
    warning: "bg-amber-400/10 text-amber-200",
    danger: "bg-rose-400/10 text-rose-300",
    neutral: "bg-zinc-800 text-zinc-300",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${classes[tone]}`}>
      <span className="mr-1.5" aria-hidden="true">
        ●
      </span>
      {label}
    </span>
  );
}

function formatUptime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function playerSummary(server?: AgentStatus) {
  if (!server || server.playerCount < 0) return "Unknown";
  return `${server.playerCount} ${server.playerCount === 1 ? "player" : "players"}`;
}

function operationLabel(kind: OperationKind) {
  const labels: Partial<Record<OperationKind, string>> = {
    start: "Start server",
    stop: "Stop server",
    restart: "Restart server",
    "build.update": "Update game build",
    backup: "Create backup",
    "world.save": "Save world",
    "rcon.command": "RCON command",
  };
  return labels[kind] ?? kind;
}

function operationDetail(operation: OperationRecord) {
  if (operation.error) return operation.error;
  if (!operation.result || typeof operation.result !== "object") return undefined;
  const result = operation.result as {
    message?: unknown;
    previousVersion?: unknown;
    installedVersion?: unknown;
    backupCreated?: unknown;
    saved?: unknown;
  };
  if (typeof result.message === "string") return result.message;
  if (operation.kind === "world.save" && result.saved === true) {
    return "World saved through the local RCON connection.";
  }
  if (operation.kind !== "build.update") return undefined;
  const previous = typeof result.previousVersion === "string" ? result.previousVersion : undefined;
  const installed =
    typeof result.installedVersion === "string" ? result.installedVersion : undefined;
  if (!previous && !installed) return undefined;
  return `Build ${previous ?? "—"} → ${installed ?? "—"}${
    result.backupCreated === true ? " · world backup created" : ""
  }`;
}

function AccessEditor({
  settings,
  canAdmin,
  busy,
  onClose,
  onReveal,
  onSave,
}: {
  settings?: NonNullable<AgentStatus["settings"]>;
  canAdmin: boolean;
  busy: boolean;
  onClose: () => void;
  onReveal: () => Promise<AgentSettingsReveal>;
  onSave: (update: AccessUpdate) => Promise<void>;
}) {
  const [publicName, setPublicName] = useState(settings?.publicName ?? "");
  const [joinPassword, setJoinPassword] = useState("");
  const [isPublic, setIsPublic] = useState(settings?.public ?? true);
  const [revealedPassword, setRevealedPassword] = useState<string>();
  const [revealError, setRevealError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPublicName(settings?.publicName ?? "");
    setJoinPassword("");
    setIsPublic(settings?.public ?? true);
  }, [settings]);

  useEffect(() => {
    if (!revealedPassword) return;
    const timer = window.setTimeout(() => setRevealedPassword(undefined), 30_000);
    return () => window.clearTimeout(timer);
  }, [revealedPassword]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(undefined);
    setSaving(true);
    try {
      await onSave({
        public: isPublic,
        ...(publicName.trim() ? { publicName: publicName.trim() } : {}),
        ...(joinPassword ? { password: joinPassword } : {}),
      });
      onClose();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save server access");
    } finally {
      setSaving(false);
    }
  };

  const reveal = async () => {
    setRevealError(undefined);
    try {
      const result = await onReveal();
      setRevealedPassword(result.password);
    } catch (cause) {
      setRevealError(cause instanceof Error ? cause.message : "Could not reveal password");
    }
  };

  return (
    <div
      aria-labelledby="access-editor-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <form
        className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
        onSubmit={(event) => void submit(event)}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Server access
            </p>
            <h3 id="access-editor-title" className="mt-1 text-xl font-semibold text-zinc-100">
              Edit player-facing settings
            </h3>
          </div>
          <button
            aria-label="Close editor"
            className="rounded-lg px-2 py-1 text-xl text-zinc-500 hover:bg-zinc-800 hover:text-white"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          These changes are written safely to the host and take effect after the next restart.
        </p>

        <label className="mt-6 block text-sm text-zinc-300" htmlFor="access-public-name">
          Public server name
        </label>
        <input
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-emerald-400 focus:ring-2"
          id="access-public-name"
          maxLength={128}
          value={publicName}
          onChange={(event) => setPublicName(event.target.value)}
        />

        <label className="mt-5 flex items-center gap-3 text-sm text-zinc-300">
          <input
            checked={isPublic}
            className="size-4 accent-emerald-400"
            onChange={(event) => setIsPublic(event.target.checked)}
            type="checkbox"
          />
          List this server publicly
        </label>

        <label className="mt-5 block text-sm text-zinc-300" htmlFor="access-new-password">
          New join password
        </label>
        <input
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-emerald-400 focus:ring-2"
          id="access-new-password"
          autoComplete="new-password"
          placeholder="Leave blank to keep the current password"
          type="password"
          value={joinPassword}
          onChange={(event) => setJoinPassword(event.target.value)}
        />

        {canAdmin && settings?.passwordConfigured ? (
          <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-zinc-400">Current password</span>
              <button
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-amber-300 hover:text-amber-200"
                disabled={busy}
                onClick={() => void reveal()}
                type="button"
              >
                {revealedPassword ? "Hide password" : "Reveal for 30 seconds"}
              </button>
            </div>
            {revealedPassword ? (
              <code className="mt-2 block break-all text-amber-100">{revealedPassword}</code>
            ) : null}
            {revealError ? <p className="mt-2 text-xs text-rose-300">{revealError}</p> : null}
          </div>
        ) : null}

        {saveError ? <p className="mt-4 text-sm text-rose-300">{saveError}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
            disabled={busy || saving}
            type="submit"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function OverviewPage({
  server,
  serverError,
  serverFetching,
  panelHealthy,
  canAdmin,
  canOperate,
  activeOperation,
  operations,
  operationMessage,
  operationPending,
  onRefresh,
  onQueue,
  onRevealSettings,
  onUpdateSettings,
}: {
  server?: AgentStatus;
  serverError?: string;
  serverFetching: boolean;
  panelHealthy: boolean;
  canAdmin: boolean;
  canOperate: boolean;
  activeOperation?: OperationRecord;
  operations?: OperationRecord[];
  operationMessage?: string;
  operationPending: boolean;
  onRefresh: () => void;
  onQueue: (
    kind: Extract<
      OperationKind,
      "start" | "stop" | "restart" | "build.update" | "backup" | "world.save"
    >,
  ) => void;
  onRevealSettings: () => Promise<AgentSettingsReveal>;
  onUpdateSettings: (update: AccessUpdate) => Promise<void>;
}) {
  const [editingAccess, setEditingAccess] = useState(false);
  const running = server?.state === "active";
  const busy = operationPending || Boolean(activeOperation);
  const statusLabel = running ? (server?.listening ? "Running" : "Starting") : "Stopped";
  const statusTone: Tone = running ? (server?.listening ? "success" : "warning") : "danger";
  const recentOperations =
    operations?.filter((operation) => operation.kind !== "status").slice(0, 3) ?? [];

  const queue = (
    kind: Extract<
      OperationKind,
      "start" | "stop" | "restart" | "build.update" | "backup" | "world.save"
    >,
  ) => {
    if (
      (kind === "stop" || kind === "restart" || kind === "build.update") &&
      !window.confirm(
        kind === "build.update"
          ? "Download and install the latest public Project Zomboid build, then restart the production server?"
          : `${kind} the production server?`,
      )
    )
      return;
    onQueue(kind);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl shadow-black/10 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Production
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-zinc-100">Project Zomboid</h2>
              <StatusBadge label={statusLabel} tone={statusTone} />
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              {server?.checkedAt
                ? `Last checked ${new Date(server.checkedAt).toLocaleTimeString()}`
                : (serverError ?? "Waiting for the host agent…")}
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${panelHealthy ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}
          >
            {panelHealthy ? "Panel healthy" : "Panel checking"}
          </span>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-zinc-800 py-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-zinc-500">Players</dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-100">{playerSummary(server)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Game build</dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-100">
              {server?.gameVersion ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Uptime</dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-100">
              {formatUptime(server?.uptimeSeconds)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Socket</dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-100">
              {server ? (server.listening ? "Ready" : "Not ready") : "—"}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-xl border border-zinc-700 px-3.5 py-2 text-sm text-zinc-200 hover:border-emerald-400 hover:text-emerald-300 disabled:opacity-40"
            disabled={serverFetching || busy}
            onClick={onRefresh}
            type="button"
          >
            {serverFetching ? "Refreshing…" : "Refresh"}
          </button>
          {running ? (
            <button
              className="rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
              disabled={!canOperate || busy}
              onClick={() => queue("restart")}
              type="button"
            >
              Restart server
            </button>
          ) : (
            <button
              className="rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
              disabled={!canOperate || busy}
              onClick={() => queue("start")}
              type="button"
            >
              Start server
            </button>
          )}
          <button
            className="rounded-xl border border-amber-400/30 px-3.5 py-2 text-sm text-amber-200 hover:border-amber-300 hover:text-amber-100 disabled:opacity-40"
            disabled={!canOperate || busy}
            onClick={() => queue("build.update")}
            title="Downloads the configured public branch, creates a world backup, and restarts safely."
            type="button"
          >
            Update game build
          </button>
          <button
            className="rounded-xl border border-zinc-700 px-3.5 py-2 text-sm text-zinc-200 hover:border-emerald-400 hover:text-emerald-300 disabled:opacity-40"
            disabled={!canOperate || busy}
            onClick={() => queue("backup")}
            type="button"
          >
            Backup
          </button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-xl border border-zinc-700 px-3.5 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-white">
              More actions
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-48 rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-2xl">
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-40"
                disabled={!canOperate || busy || !running || server?.rconAvailable === false}
                onClick={() => queue("world.save")}
                title={
                  server?.rconAvailable === false
                    ? "RCON is not available; the world cannot be saved safely."
                    : "Send the save command through the local RCON connection."
                }
                type="button"
              >
                Save world
              </button>
              {running ? (
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-400/10 disabled:opacity-40"
                  disabled={!canOperate || busy}
                  onClick={() => queue("stop")}
                  type="button"
                >
                  Stop server
                </button>
              ) : null}
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                disabled={!canOperate || busy}
                onClick={() => queue(running ? "restart" : "start")}
                type="button"
              >
                {running ? "Restart again" : "Start server"}
              </button>
            </div>
          </details>
        </div>
        {activeOperation ? (
          <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium text-amber-200">
                {operationLabel(activeOperation.kind)} in progress
              </p>
              <span className="text-xs uppercase tracking-[0.15em] text-amber-300/70">
                {activeOperation.targetState ?? "working"}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              {operationMessage ?? activeOperation.progressMessage ?? "Waiting for the host agent…"}
            </p>
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Server access
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">
                {server?.settings?.publicName ?? "Name not set"}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {server?.settings?.public ? "Public server" : "Private server"} ·{" "}
                {server?.settings?.passwordConfigured ? "Password configured" : "No password"}
              </p>
            </div>
            <button
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-emerald-400 hover:text-emerald-300 disabled:opacity-40"
              disabled={!server?.settings || busy}
              onClick={() => setEditingAccess(true)}
              type="button"
            >
              Edit access
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <div>
              <p className="text-xs text-zinc-500">Server address</p>
              <code className="mt-1 block text-sm text-zinc-200">
                {server?.settings?.publicAddress
                  ? `${server.settings.publicAddress}:${server.settings.defaultPort}`
                  : "Unavailable"}
              </code>
            </div>
            <button
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-400 hover:text-emerald-300 disabled:opacity-40"
              disabled={!server?.settings?.publicAddress}
              onClick={() => {
                if (!server?.settings?.publicAddress) return;
                void navigator.clipboard?.writeText(
                  `${server.settings.publicAddress}:${server.settings.defaultPort}`,
                );
              }}
              type="button"
            >
              Copy address
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Players
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">Currently online</h2>
            </div>
            <span className="text-2xl font-semibold text-emerald-300">
              {server?.playerCount !== undefined && server.playerCount >= 0
                ? server.playerCount
                : "—"}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {server?.onlinePlayers?.length ? (
              server.onlinePlayers.map((player) => (
                <span
                  className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200"
                  key={player}
                >
                  {player}
                </span>
              ))
            ) : (
              <p className="text-sm text-zinc-500">
                {server?.rconAvailable === false
                  ? "Player telemetry unavailable"
                  : "No players connected"}
              </p>
            )}
          </div>
        </section>
      </div>

      {recentOperations.length ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Recent activity
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">Latest operations</h2>
            </div>
            <span className="text-xs text-zinc-500">{recentOperations.length} recent</span>
          </div>
          <ul className="mt-4 divide-y divide-zinc-800">
            {recentOperations.map((operation) => {
              const detail = operationDetail(operation);
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  key={operation.operationId}
                >
                  <div className="min-w-0">
                    <span className="text-zinc-300">{operationLabel(operation.kind)}</span>
                    {detail ? (
                      <p className="mt-1 max-w-xl text-xs text-zinc-500">{detail}</p>
                    ) : null}
                  </div>
                  <span
                    className={
                      operation.status === "succeeded"
                        ? "text-emerald-300"
                        : operation.status === "failed"
                          ? "text-rose-300"
                          : "text-zinc-400"
                    }
                  >
                    {operation.status}
                  </span>
                  <time className="text-xs text-zinc-500" dateTime={operation.createdAt}>
                    {new Date(operation.createdAt).toLocaleString()}
                  </time>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {editingAccess && server?.settings ? (
        <AccessEditor
          busy={busy}
          canAdmin={canAdmin}
          onClose={() => setEditingAccess(false)}
          onReveal={onRevealSettings}
          onSave={onUpdateSettings}
          settings={server.settings}
        />
      ) : null}
    </div>
  );
}
