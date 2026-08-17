import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AgentCapability,
  AgentStatus,
  AuthUser,
  DirectCommandRequest,
  DirectCommandResponse,
} from "@zomboid/contracts";
import { useMemo, useState } from "react";
import { executeDirectCommand, getAgentCapabilities } from "./direct-command";
import type { PanelPage } from "./PanelNav";

const roleRank = { viewer: 0, operator: 1, admin: 2 } as const;

function canRun(role: AuthUser["role"] | undefined, capability: AgentCapability) {
  return role !== undefined && roleRank[role] >= roleRank[capability.role];
}

function areaFor(capability: AgentCapability): PanelPage {
  if (capability.category === "Mods") return "mods";
  if (capability.category === "Settings") return "settings";
  if (capability.category === "Diagnostics") return "logs";
  return "overview";
}

function commandOutput(response?: DirectCommandResponse) {
  if (response === undefined) return undefined;
  const result = response.result;
  if (result && typeof result === "object" && "output" in result) {
    const output = result.output;
    if (typeof output === "string") return output || "(ok)";
  }
  return JSON.stringify(result, null, 2);
}
function validateArguments(
  capability: AgentCapability,
  input: Record<string, string | boolean>,
): string | undefined {
  for (const argument of capability.arguments) {
    const value = input[argument.name];
    if (argument.type === "boolean") continue;
    if (argument.type === "string-list") {
      const entries = String(value ?? "")
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (argument.required && entries.length === 0) return `${argument.label} is required.`;
      const maxLength = argument.maxLength;
      if (maxLength !== undefined && entries.some((entry) => [...entry].length > maxLength)) {
        return `${argument.label} contains a value longer than ${maxLength} characters.`;
      }
      continue;
    }
    const text = String(value ?? "").trim();
    if (argument.required && text === "") return `${argument.label} is required.`;
    if (text === "") continue;
    if (argument.type === "integer") {
      const number = Number(text);
      if (!Number.isInteger(number)) return `${argument.label} must be an integer.`;
      if (argument.minimum !== undefined && number < argument.minimum) {
        return `${argument.label} must be at least ${argument.minimum}.`;
      }
      if (argument.maximum !== undefined && number > argument.maximum) {
        return `${argument.label} must be at most ${argument.maximum}.`;
      }
    } else if (argument.maxLength !== undefined && [...text].length > argument.maxLength) {
      return `${argument.label} must be at most ${argument.maxLength} characters.`;
    }
  }
  return undefined;
}

export function RconConsole({
  serverId,
  server,
  role,
  onNavigate,
}: {
  serverId: string;
  server?: AgentStatus;
  role?: AuthUser["role"];
  onNavigate: (page: PanelPage) => void;
}) {
  const capabilities = useQuery({
    queryKey: ["agent-capabilities", serverId],
    queryFn: () => getAgentCapabilities(serverId),
    enabled: role !== undefined,
    refetchInterval: 5_000,
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [input, setInput] = useState<Record<string, string | boolean>>({});
  const [validationError, setValidationError] = useState<string>();
  const command = useMutation({
    mutationFn: (request: DirectCommandRequest) => executeDirectCommand(serverId, request),
  });
  const directCapabilities =
    capabilities.data?.capabilities.filter((item) => item.mode === "direct") ?? [];
  const selected =
    directCapabilities.find((capability) => capability.id === selectedId) ?? directCapabilities[0];
  const grouped = useMemo(() => {
    const groups = new Map<string, AgentCapability[]>();
    for (const capability of capabilities.data?.capabilities ?? []) {
      const group = groups.get(capability.category) ?? [];
      group.push(capability);
      groups.set(capability.category, group);
    }
    return [...groups.entries()];
  }, [capabilities.data?.capabilities]);
  const output = commandOutput(command.data);
  const realtimeConnected = capabilities.data?.connected === true;

  const select = (capability: AgentCapability) => {
    if (capability.mode !== "direct") {
      onNavigate(areaFor(capability));
      return;
    }
    setSelectedId(capability.id);
    setInput({});
    setValidationError(undefined);
    command.reset();
  };

  const submit = () => {
    if (!selected) return;
    const error = validateArguments(selected, input);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(undefined);
    const payload: Record<string, unknown> = {};
    for (const argument of selected.arguments) {
      const value = input[argument.name];
      if (argument.type === "boolean") {
        payload[argument.name] = value === true;
      } else if (argument.type === "integer") {
        if (value !== undefined && value !== "") payload[argument.name] = Number(value);
      } else if (argument.type === "string-list") {
        payload[argument.name] = String(value ?? "")
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (value !== undefined) {
        payload[argument.name] = String(value).trim();
      }
    }
    if (selected.effects.includes("player-action") && !window.confirm(`Run ${selected.title}?`))
      return;
    command.mutate({ capabilityId: selected.id, input: payload });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-xl shadow-black/10 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Host control
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-zinc-100">Realtime control channel</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Fast commands bypass the durable job queue and return over the outbound host
              connection. Long operations remain recoverable jobs and link to their dedicated
              screen.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${realtimeConnected ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300"}`}
            >
              {realtimeConnected ? "Agent realtime" : "Agent disconnected"}
            </span>
            <span className="text-xs text-zinc-600">
              {server?.rconAvailable === true ? "RCON ready" : "RCON not ready"}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Host capabilities
            </p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">
              Everything advertised by pzctl-core
            </h2>
          </div>
          <span className="text-xs text-zinc-500">
            {capabilities.data?.capabilities.length ?? 0} capabilities · direct + durable jobs
          </span>
        </div>
        {capabilities.isError ? (
          <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">
            {capabilities.error instanceof Error
              ? capabilities.error.message
              : "Capabilities are unavailable."}
          </p>
        ) : null}
        <div className="mt-5 space-y-6">
          {grouped.map(([category, items]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {category}
              </h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((capability) => (
                  <button
                    aria-pressed={capability.mode === "direct" && selected?.id === capability.id}
                    className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${capability.mode === "direct" && selected?.id === capability.id ? "border-emerald-400/60 bg-emerald-400/10" : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-600"}`}
                    disabled={
                      capability.mode === "direct" &&
                      capability.id.startsWith("rcon.") &&
                      server?.rconAvailable !== true
                    }
                    key={capability.id}
                    onClick={() => select(capability)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <code className="text-xs font-semibold text-emerald-300">
                        {capability.id}
                      </code>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${capability.mode === "direct" ? "bg-sky-400/10 text-sky-300" : "bg-amber-400/10 text-amber-200"}`}
                      >
                        {capability.mode === "direct" ? "Realtime" : "Job"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium text-zinc-200">{capability.title}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{capability.description}</p>
                    {capability.mode === "job" ? (
                      <p className="mt-3 text-xs text-amber-200/70">Open {areaFor(capability)}</p>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Realtime command
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">{selected.title}</h2>
              <p className="mt-2 text-sm text-zinc-400">{selected.description}</p>
            </div>
            <code className="rounded-lg bg-zinc-950 px-3 py-2 text-xs text-emerald-300">
              {selected.id}
            </code>
          </div>
          {selected.arguments.length ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {selected.arguments.map((argument) => (
                <label className="block text-sm text-zinc-300" key={argument.name}>
                  {argument.label}
                  {argument.type === "boolean" ? (
                    <input
                      checked={input[argument.name] === true}
                      className="ml-3 accent-emerald-400"
                      onChange={(event) =>
                        setInput((current) => ({
                          ...current,
                          [argument.name]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                  ) : argument.type === "string-list" ? (
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-emerald-400 focus:ring-2"
                      onChange={(event) =>
                        setInput((current) => ({ ...current, [argument.name]: event.target.value }))
                      }
                      placeholder={argument.placeholder}
                      required={argument.required}
                      value={String(input[argument.name] ?? "")}
                    />
                  ) : (
                    <input
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-emerald-400 focus:ring-2"
                      max={argument.maximum}
                      maxLength={argument.maxLength}
                      min={argument.minimum}
                      onChange={(event) =>
                        setInput((current) => ({ ...current, [argument.name]: event.target.value }))
                      }
                      placeholder={argument.placeholder}
                      required={argument.required}
                      type={argument.type === "integer" ? "number" : "text"}
                      value={String(input[argument.name] ?? "")}
                    />
                  )}
                  <span className="mt-1 block text-xs text-zinc-600">{argument.description}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-500">
              No parameters required.
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={
                !realtimeConnected ||
                !canRun(role, selected) ||
                command.isPending ||
                (selected.id.startsWith("rcon.") && server?.rconAvailable !== true)
              }
              onClick={submit}
              type="button"
            >
              {command.isPending ? "Running…" : "Run now"}
            </button>
            {!canRun(role, selected) ? (
              <span className="text-xs text-amber-200">Requires {selected.role}</span>
            ) : null}
            {command.data ? (
              <span className="text-xs text-emerald-300">
                Completed in {command.data.durationMs} ms
              </span>
            ) : null}
          </div>
          {validationError ? (
            <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
              {validationError}
            </p>
          ) : null}
          {command.error instanceof Error ? (
            <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">
              {command.error.message}
            </p>
          ) : null}
          {output !== undefined ? (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Host response
              </p>
              <pre
                className="mt-2 max-h-80 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-4 font-mono text-xs leading-5 text-zinc-300"
                role="log"
              >
                {output}
              </pre>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
