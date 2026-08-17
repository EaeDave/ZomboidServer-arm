import { useQuery } from "@tanstack/react-query";
import type {
  AgentStatus,
  OperationCreateRequest,
  OperationRecord,
  RconCommand,
} from "@zomboid/contracts";
import { useState } from "react";
import { throwApiError } from "./api-error";

type CommandArgument = {
  label: string;
  placeholder: string;
  help: string;
};

type CommandDefinition = {
  command: RconCommand;
  title: string;
  summary: string;
  description: string;
  tone: "read" | "safe" | "player";
  arguments: CommandArgument[];
};

const commandDefinitions: CommandDefinition[] = [
  {
    command: "players",
    title: "List players",
    summary: "See who is connected",
    description: "Read-only player count and names reported by the game server.",
    tone: "read",
    arguments: [],
  },
  {
    command: "help",
    title: "Show game help",
    summary: "Ask the server for its command list",
    description: "Returns the commands currently exposed by this Project Zomboid build.",
    tone: "read",
    arguments: [],
  },
  {
    command: "servermsg",
    title: "Broadcast message",
    summary: "Send a message to everyone",
    description: "Displays a server announcement to all connected players.",
    tone: "safe",
    arguments: [
      {
        label: "Message",
        placeholder: "The server will restart after the next save",
        help: "Keep it short and actionable. Maximum 500 characters.",
      },
    ],
  },
  {
    command: "kickuser",
    title: "Kick player",
    summary: "Remove one player with a reason",
    description: "Disconnects a player and records the reason in the game response.",
    tone: "player",
    arguments: [
      {
        label: "Username",
        placeholder: "PlayerName",
        help: "Use the exact name returned by List players.",
      },
      {
        label: "Reason",
        placeholder: "Maintenance",
        help: "The player sees this reason when disconnected.",
      },
    ],
  },
  {
    command: "save",
    title: "Save world",
    summary: "Flush the current world to disk",
    description: "Runs the same safe save command used by lifecycle and backup flows.",
    tone: "safe",
    arguments: [],
  },
];

async function getOperation(operationId: string): Promise<OperationRecord> {
  const response = await fetch(`/api/operations/${operationId}`, { credentials: "same-origin" });
  if (!response.ok) throwApiError(response, `Operation request failed: ${response.status}`);
  return response.json() as Promise<OperationRecord>;
}

function statusLabel(operation?: OperationRecord) {
  if (!operation) return "Ready";
  if (operation.status === "queued") return "Queued";
  if (operation.status === "running") return "Running";
  if (operation.status === "succeeded") return "Completed";
  if (operation.status === "cancelled") return "Cancelled";
  return "Failed";
}

function statusTone(operation?: OperationRecord) {
  if (!operation || operation.status === "queued" || operation.status === "running") {
    return "text-amber-200";
  }
  if (operation.status === "succeeded") return "text-emerald-300";
  return "text-rose-300";
}

function operationOutput(operation?: OperationRecord) {
  if (!operation?.result || typeof operation.result !== "object") return undefined;
  const result = operation.result as { output?: unknown };
  return typeof result.output === "string" ? result.output : undefined;
}

export function RconConsole({
  server,
  canAdmin,
  busy,
  onQueue,
}: {
  server?: AgentStatus;
  canAdmin: boolean;
  busy: boolean;
  onQueue: (request: OperationCreateRequest) => Promise<OperationRecord>;
}) {
  const [selectedCommand, setSelectedCommand] = useState<RconCommand>("players");
  const [firstArgument, setFirstArgument] = useState("");
  const [secondArgument, setSecondArgument] = useState("");
  const [operationId, setOperationId] = useState<string>();
  const [sentCommand, setSentCommand] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const selected =
    commandDefinitions.find((definition) => definition.command === selectedCommand) ??
    commandDefinitions[0]!;
  const operation = useQuery({
    queryKey: ["rcon-operation", operationId],
    queryFn: () => getOperation(operationId as string),
    enabled: Boolean(operationId),
    refetchInterval: (query) => {
      const state = query.state.data?.status;
      return state === "queued" || state === "running" ? 1_000 : false;
    },
  });
  const rconReady = server?.rconAvailable === true;
  const output = operationOutput(operation.data);

  const selectCommand = (command: RconCommand) => {
    setSelectedCommand(command);
    setFirstArgument("");
    setSecondArgument("");
    setFormError(undefined);
  };

  const submit = async () => {
    if (!canAdmin) {
      setFormError("Administrator role required to send RCON commands.");
      return;
    }
    if (!rconReady) {
      setFormError("RCON is not ready. Wait for the server to finish starting, then refresh.");
      return;
    }
    const args =
      selected.arguments.length === 0
        ? []
        : selected.arguments.length === 1
          ? [firstArgument.trim()]
          : [firstArgument.trim(), secondArgument.trim()];
    if (args.some((value) => !value)) {
      setFormError("Fill in every command field before sending it.");
      return;
    }
    if (selectedCommand === "kickuser" && !window.confirm(`Kick ${args[0]} from the server?`)) {
      return;
    }
    setFormError(undefined);
    setSentCommand(
      [selectedCommand, ...args.map((value) => (value.includes(" ") ? `"${value}"` : value))].join(
        " ",
      ),
    );
    try {
      const queued = await onQueue({
        kind: "rcon.command",
        payload: { command: selectedCommand, args },
      });
      setOperationId(queued.operationId);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not send the RCON command.");
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl shadow-black/10 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Administration
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-zinc-100">Admin console</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Run documented Project Zomboid commands through the host&apos;s local RCON socket.
              Restart remains in Overview; this console does not expose a shell or the quit command.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              rconReady
                ? "bg-emerald-400/10 text-emerald-300"
                : server?.rconAvailable === false
                  ? "bg-rose-400/10 text-rose-300"
                  : "bg-amber-400/10 text-amber-200"
            }`}
          >
            {rconReady
              ? "RCON ready"
              : server?.rconAvailable === false
                ? "RCON unavailable"
                : "RCON checking"}
          </span>
        </div>
        {!canAdmin ? (
          <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
            The command catalog is visible for reference, but sending RCON commands requires an
            administrator account.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Command catalog
            </p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">Choose an action</h2>
          </div>
          <p className="text-xs text-zinc-500">Only documented commands can be sent.</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {commandDefinitions.map((definition) => (
            <button
              aria-pressed={selectedCommand === definition.command}
              className={`rounded-xl border p-4 text-left transition ${
                selectedCommand === definition.command
                  ? "border-emerald-400/60 bg-emerald-400/10"
                  : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-600"
              }`}
              key={definition.command}
              onClick={() => selectCommand(definition.command)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <code className="text-sm font-semibold text-emerald-300">{definition.command}</code>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    definition.tone === "read"
                      ? "bg-sky-400/10 text-sky-300"
                      : definition.tone === "player"
                        ? "bg-rose-400/10 text-rose-300"
                        : "bg-amber-400/10 text-amber-200"
                  }`}
                >
                  {definition.tone === "read"
                    ? "Read-only"
                    : definition.tone === "player"
                      ? "Player action"
                      : "Server action"}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-200">{definition.title}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{definition.summary}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Selected command
            </p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">
              <code className="text-emerald-300">{selected.command}</code>
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">{selected.description}</p>
          </div>
          <div className={`text-sm font-medium ${statusTone(operation.data)}`}>
            {statusLabel(operation.data)}
          </div>
        </div>

        {selected.arguments.length ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {selected.arguments.map((argument, index) => (
              <label
                className="block text-sm text-zinc-300"
                htmlFor={`rcon-argument-${index}`}
                key={argument.label}
              >
                {argument.label}
                <input
                  aria-describedby={`rcon-help-${index}`}
                  className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-emerald-400 focus:ring-2 disabled:opacity-50"
                  disabled={busy || !canAdmin || !rconReady}
                  id={`rcon-argument-${index}`}
                  maxLength={index === 0 && selected.command === "servermsg" ? 500 : 500}
                  placeholder={argument.placeholder}
                  value={index === 0 ? firstArgument : secondArgument}
                  onChange={(event) =>
                    index === 0
                      ? setFirstArgument(event.target.value)
                      : setSecondArgument(event.target.value)
                  }
                />
                <span className="mt-1 block text-xs text-zinc-600" id={`rcon-help-${index}`}>
                  {argument.help}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-500">
            This command does not require parameters.
          </p>
        )}

        {formError ? <p className="mt-4 text-sm text-rose-300">{formError}</p> : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || !canAdmin || !rconReady}
            onClick={() => void submit()}
            type="button"
          >
            Send command
          </button>
          {sentCommand ? (
            <code className="rounded-lg bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
              {sentCommand}
            </code>
          ) : null}
        </div>

        {operation.isError ? (
          <p className="mt-5 text-sm text-rose-300">
            {operation.error instanceof Error
              ? operation.error.message
              : "Could not read command result."}
          </p>
        ) : null}
        {operation.data?.status === "running" || operation.data?.status === "queued" ? (
          <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
            {operation.data.progressMessage ?? "The host agent is sending the command…"}
          </p>
        ) : null}
        {operation.data?.status === "failed" ? (
          <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">
            {operation.data.error ?? "The RCON command failed."}
          </p>
        ) : null}
        {output !== undefined ? (
          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Server response
            </p>
            <pre
              className="mt-2 max-h-72 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-4 font-mono text-xs leading-5 text-zinc-300"
              role="log"
            >
              {output || "(ok)"}
            </pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
