import { useQuery } from "@tanstack/react-query";
import type { ConsoleLogEntry } from "@zomboid/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { throwApiError } from "./api-error";

interface ConsoleHistory {
  logs: ConsoleLogEntry[];
  cursor: number;
}

type StreamState = "connecting" | "live" | "reconnecting" | "degraded";
type LogLevel = "all" | "warn" | "error";

async function getConsole(serverId: string): Promise<ConsoleHistory> {
  const response = await fetch(`/api/servers/${serverId}/console?after=0`, {
    credentials: "same-origin",
  });
  if (!response.ok) throwApiError(response, `Console request failed: ${response.status}`);
  return response.json() as Promise<ConsoleHistory>;
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

function matchesLevel(line: string, level: LogLevel) {
  if (level === "all") return true;
  if (level === "warn") return /\bwarn(?:ing)?\b/i.test(line);
  return /\b(error|fatal|exception)\b/i.test(line);
}

function mergeLogs(existing: ConsoleLogEntry[], incoming: ConsoleLogEntry[]) {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort((left, right) => left.id - right.id).slice(-2_000);
}

export function ServerConsole({ serverId, enabled }: { serverId: string; enabled: boolean }) {
  const history = useQuery({
    queryKey: ["server-console", serverId],
    queryFn: () => getConsole(serverId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [entries, setEntries] = useState<ConsoleLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LogLevel>("all");
  const [paused, setPaused] = useState(false);
  const [clearBoundary, setClearBoundary] = useState<number | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const [streamWarning, setStreamWarning] = useState<string>();
  const initializedRef = useRef(false);
  const cursorRef = useRef(0);
  const clearBoundaryRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        matchesLevel(entry.line, level) && (!query || entry.line.toLowerCase().includes(query)),
    );
  }, [entries, level, search]);

  useEffect(() => {
    clearBoundaryRef.current = clearBoundary;
  }, [clearBoundary]);

  useEffect(() => {
    if (!history.data || initializedRef.current) return;
    initializedRef.current = true;
    cursorRef.current = history.data.cursor;
    setEntries(history.data.logs);
  }, [history.data]);

  useEffect(() => {
    if (!enabled || !history.isFetched) return;
    setStreamState("connecting");
    setStreamWarning(undefined);
    const stream = new EventSource(
      `/api/servers/${serverId}/console/stream?after=${cursorRef.current}`,
    );
    const setLive = () => {
      setStreamState("live");
      setStreamWarning(undefined);
    };
    stream.onopen = setLive;
    stream.onerror = () => setStreamState("reconnecting");
    stream.addEventListener("ready", setLive);
    stream.addEventListener("heartbeat", setLive);
    stream.addEventListener("console", (event) => {
      try {
        const entry = JSON.parse((event as MessageEvent<string>).data) as ConsoleLogEntry;
        if (!Number.isInteger(entry.id) || typeof entry.line !== "string")
          throw new Error("invalid");
        cursorRef.current = Math.max(cursorRef.current, entry.id);
        if (clearBoundaryRef.current === null || entry.id > clearBoundaryRef.current) {
          setEntries((previous) => mergeLogs(previous, [entry]));
        }
        setLive();
      } catch {
        setStreamState("degraded");
        setStreamWarning("The control plane received an invalid console event.");
      }
    });
    stream.addEventListener("warning", (event) => {
      setStreamState("degraded");
      try {
        const message = JSON.parse((event as MessageEvent<string>).data) as { message?: unknown };
        setStreamWarning(
          typeof message.message === "string" ? message.message : "Console delayed.",
        );
      } catch {
        setStreamWarning("Console delayed.");
      }
    });
    return () => stream.close();
  }, [enabled, history.isFetched, serverId]);

  useEffect(() => {
    if (!paused) logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length, paused]);

  const stateLabel =
    streamState === "live"
      ? "live"
      : streamState === "connecting"
        ? "connecting"
        : streamState === "reconnecting"
          ? "reconnecting"
          : "degraded";
  const lastEntry = entries.at(-1);

  return (
    <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Server console</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Incremental output from the host, streamed through the authenticated control plane.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            streamState === "live"
              ? "bg-emerald-400/10 text-emerald-300"
              : streamState === "degraded"
                ? "bg-rose-400/10 text-rose-300"
                : "bg-amber-400/10 text-amber-300"
          }`}
        >
          {stateLabel}
        </span>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <input
          aria-label="Search server console"
          className="min-w-52 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none ring-emerald-400 focus:ring-2"
          placeholder="Search console lines..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Console level filter"
          className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none ring-emerald-400 focus:ring-2"
          value={level}
          onChange={(event) => setLevel(event.target.value as LogLevel)}
        >
          <option value="all">All levels</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
        </select>
        <button
          className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-400"
          onClick={() => setPaused((current) => !current)}
          type="button"
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!history.isFetched}
          onClick={() => {
            if (!history.isFetched) return;
            setClearBoundary(cursorRef.current);
            setEntries([]);
          }}
          type="button"
        >
          Clear view
        </button>
      </div>
      {streamWarning ? <p className="mt-3 text-sm text-rose-300">{streamWarning}</p> : null}
      <div
        className="mt-4 h-80 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-4 font-mono text-xs leading-5 text-zinc-300"
        role="log"
        aria-live="polite"
      >
        {visibleEntries.length ? (
          visibleEntries.map((entry, index) => (
            <div className="whitespace-pre-wrap break-words" key={entry.id}>
              <span className="mr-3 select-none text-zinc-700">
                {String(index + 1).padStart(4, "0")}
              </span>
              {highlightLine(entry.line, search.trim())}
            </div>
          ))
        ) : (
          <p className="text-zinc-600">
            {history.isError
              ? "Console history is temporarily unavailable."
              : "Waiting for server console output..."}
          </p>
        )}
        <div ref={logEndRef} />
      </div>
      <p className="mt-2 text-xs text-zinc-600">
        Showing {visibleEntries.length} matching lines · client and server history capped at 2,000
        lines
        {lastEntry ? ` · last line ${new Date(lastEntry.createdAt).toLocaleTimeString()}` : ""}
      </p>
    </section>
  );
}
