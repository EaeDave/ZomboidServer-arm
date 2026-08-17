import { useQuery } from "@tanstack/react-query";
import type { AgentStatus, OperationCreateRequest, OperationRecord } from "@zomboid/contracts";
import { useEffect, useState } from "react";
import { throwApiError } from "./api-error";

type Mods = NonNullable<AgentStatus["mods"]>;

async function readOperation(operationId: string): Promise<OperationRecord> {
  const response = await fetch(`/api/operations/${operationId}`, { credentials: "same-origin" });
  if (!response.ok) throwApiError(response, "Could not track the mod update");
  return response.json() as Promise<OperationRecord>;
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function ModManager({
  mods,
  canOperate,
  busy,
  onQueue,
}: {
  mods?: Mods;
  canOperate: boolean;
  busy: boolean;
  onQueue: (request: OperationCreateRequest) => Promise<OperationRecord>;
}) {
  const [active, setActive] = useState<string[]>([]);
  const [inactive, setInactive] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<{
    operationId: string;
    activeModIds: string[];
    inactiveModIds: string[];
  }>();
  const pendingOperation = useQuery({
    queryKey: ["mods-operation", pending?.operationId],
    queryFn: () => readOperation(pending!.operationId),
    enabled: Boolean(pending),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" || status === "cancelled"
        ? false
        : 1_500;
    },
  });
  useEffect(() => {
    if (!mods) return;
    if (pending) {
      if (
        sameIds(mods.activeModIds ?? [], pending.activeModIds) &&
        sameIds(mods.inactiveModIds, pending.inactiveModIds)
      ) {
        setPending(undefined);
        setDirty(false);
      }
      return;
    }
    if (dirty) return;
    setActive(mods.activeModIds ?? []);
    setInactive(mods.inactiveModIds);
  }, [dirty, mods, pending]);
  useEffect(() => {
    const operation = pendingOperation.data;
    if (!pending || !operation) return;
    if (operation.status === "failed" || operation.status === "cancelled") {
      setError(operation.error ?? "The mod update did not complete");
      setPending(undefined);
    }
  }, [pending, pendingOperation.data]);
  if (!mods) return <p className="text-xs text-zinc-600">Waiting for the agent inventory…</p>;
  const locked = busy || Boolean(pending);

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= active.length) return;
    const next = [...active];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setActive(next);
    setDirty(true);
  };
  const disable = (id: string) => {
    setActive((items) => items.filter((item) => item !== id));
    setInactive((items) => [...items, id]);
    setDirty(true);
  };
  const enable = (id: string) => {
    setInactive((items) => items.filter((item) => item !== id));
    setActive((items) => [...items, id]);
    setDirty(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Load order</p>
          <p className="text-xs text-zinc-500">Later mods can override earlier ones.</p>
        </div>
        {dirty ? (
          <span className="rounded-full bg-amber-400/10 px-2 py-1 text-xs text-amber-200">
            unsaved
          </span>
        ) : null}
      </div>
      <ol className="max-h-80 space-y-2 overflow-auto pr-1">
        {active.map((id, index) => (
          <li
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs"
            key={id}
          >
            <span className="w-6 text-center text-zinc-600">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-300" title={id}>
              {id}
            </span>
            <button
              aria-label={`Move ${id} up`}
              className="px-2 py-1 text-zinc-400 hover:text-white disabled:opacity-20"
              disabled={index === 0 || locked}
              onClick={() => move(index, -1)}
              type="button"
            >
              ↑
            </button>
            <button
              aria-label={`Move ${id} down`}
              className="px-2 py-1 text-zinc-400 hover:text-white disabled:opacity-20"
              disabled={index === active.length - 1 || locked}
              onClick={() => move(index, 1)}
              type="button"
            >
              ↓
            </button>
            <button
              className="rounded border border-zinc-700 px-2 py-1 text-amber-200"
              disabled={locked}
              onClick={() => disable(id)}
              type="button"
            >
              Disable
            </button>
          </li>
        ))}
      </ol>
      {inactive.length ? (
        <details className="rounded-lg border border-zinc-800 p-3">
          <summary className="cursor-pointer text-xs text-zinc-400">
            {inactive.length} disabled
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {inactive.map((id) => (
              <button
                className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-400"
                disabled={locked}
                key={id}
                onClick={() => enable(id)}
                type="button"
              >
                Enable {id}
              </button>
            ))}
          </div>
        </details>
      ) : null}
      {dirty ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-zinc-700 px-3 py-2 text-xs"
            disabled={locked}
            onClick={() => {
              setActive(mods.activeModIds ?? []);
              setInactive(mods.inactiveModIds);
              setDirty(false);
            }}
            type="button"
          >
            Discard
          </button>
          <button
            className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-zinc-950 disabled:opacity-40"
            disabled={!canOperate || locked}
            onClick={async () => {
              if (
                !window.confirm(
                  "Save the new mod order and activation state? A restart will be required.",
                )
              )
                return;
              setError(undefined);
              try {
                const queued = await onQueue({
                  kind: "mods.configure",
                  payload: { activeModIds: active, inactiveModIds: inactive },
                });
                setPending({
                  operationId: queued.operationId,
                  activeModIds: [...active],
                  inactiveModIds: [...inactive],
                });
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not save mods");
              }
            }}
            type="button"
          >
            Save mod configuration
          </button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
