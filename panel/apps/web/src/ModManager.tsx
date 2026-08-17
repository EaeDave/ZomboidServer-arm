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

function ModReviewDialog({
  active,
  inactive,
  applying,
  onClose,
  onConfirm,
}: {
  active: string[];
  inactive: string[];
  applying: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-labelledby="mod-review-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Before saving
        </p>
        <h2 id="mod-review-title" className="mt-1 text-xl font-semibold text-zinc-100">
          Review mod configuration
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          The new activation state and load order will be written safely. Restart the server before
          players connect again.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-emerald-400/10 p-3">
            <p className="text-xs text-emerald-200/70">Active</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-200">{active.length}</p>
          </div>
          <div className="rounded-xl bg-zinc-950 p-3">
            <p className="text-xs text-zinc-500">Disabled</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-200">{inactive.length}</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">New load order</p>
          <ol className="mt-2 space-y-1 text-xs text-zinc-300">
            {active.slice(0, 8).map((id, index) => (
              <li className="flex gap-2" key={id}>
                <span className="w-5 text-right text-zinc-600">{index + 1}</span>
                <span className="truncate">{id}</span>
              </li>
            ))}
          </ol>
          {active.length > 8 ? (
            <p className="mt-2 text-xs text-zinc-600">and {active.length - 8} more…</p>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
            disabled={applying}
            onClick={onClose}
            type="button"
          >
            Keep editing
          </button>
          <button
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
            disabled={applying}
            onClick={onConfirm}
            type="button"
          >
            {applying ? "Saving…" : "Confirm and save"}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [reviewOpen, setReviewOpen] = useState(false);
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
    if (!mods || mods.activeModIds === undefined) return;
    if (pending) {
      if (
        sameIds(mods.activeModIds, pending.activeModIds) &&
        sameIds(mods.inactiveModIds, pending.inactiveModIds)
      ) {
        setPending(undefined);
        setDirty(false);
      }
      return;
    }
    if (dirty) return;
    setActive(mods.activeModIds);
    setInactive(mods.inactiveModIds);
  }, [dirty, mods, pending]);

  useEffect(() => {
    if (pending && pendingOperation.isError) {
      setError(
        pendingOperation.error instanceof Error
          ? pendingOperation.error.message
          : "Could not track the mod update",
      );
      setPending(undefined);
      return;
    }
    const operation = pendingOperation.data;
    if (!pending || !operation) return;
    if (operation.status === "failed" || operation.status === "cancelled") {
      setError(operation.error ?? "The mod update did not complete");
      setPending(undefined);
    }
  }, [pending, pendingOperation.data, pendingOperation.error, pendingOperation.isError]);

  if (!mods) return <p className="text-sm text-zinc-500">Waiting for the agent inventory…</p>;
  if (mods.activeModIds === undefined) {
    return (
      <p className="text-sm text-amber-300">
        This agent does not report ordered active mods. Upgrade the agent before editing mod state.
      </p>
    );
  }
  const reportedActiveModIds = mods.activeModIds;
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
  const save = async () => {
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
      setReviewOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save mods");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-200">Load order</p>
          <p className="mt-1 text-sm text-zinc-500">Later mods can override earlier ones.</p>
        </div>
        <div className="flex gap-3 text-xs text-zinc-500">
          <span>{active.length} active</span>
          <span>{inactive.length} disabled</span>
          {dirty ? <span className="text-amber-200">Unsaved</span> : null}
        </div>
      </div>
      <ol className="max-h-96 space-y-1.5 overflow-auto pr-1">
        {active.map((id, index) => (
          <li
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2 text-xs"
            key={id}
          >
            <span className="w-6 text-center tabular-nums text-zinc-600">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-300" title={id}>
              {id}
            </span>
            <button
              aria-label={`Move ${id} up`}
              className="rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white disabled:opacity-20"
              disabled={index === 0 || locked}
              onClick={() => move(index, -1)}
              title="Move up"
              type="button"
            >
              ↑
            </button>
            <button
              aria-label={`Move ${id} down`}
              className="rounded px-1.5 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white disabled:opacity-20"
              disabled={index === active.length - 1 || locked}
              onClick={() => move(index, 1)}
              title="Move down"
              type="button"
            >
              ↓
            </button>
            <button
              className="rounded border border-zinc-700 px-2 py-1 text-amber-200 hover:border-amber-300 disabled:opacity-40"
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
        <details className="rounded-xl border border-zinc-800 p-3">
          <summary className="cursor-pointer text-sm text-zinc-400">
            Show {inactive.length} disabled mod{inactive.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {inactive.map((id) => (
              <button
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-400 hover:text-emerald-300"
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
        <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
          <button
            className="rounded-xl border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
            disabled={locked}
            onClick={() => {
              setActive(reportedActiveModIds);
              setInactive(mods.inactiveModIds);
              setDirty(false);
            }}
            type="button"
          >
            Discard
          </button>
          <button
            className="rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
            disabled={!canOperate || locked}
            onClick={() => setReviewOpen(true)}
            type="button"
          >
            Review changes
          </button>
        </div>
      ) : null}
      {pending ? (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
          Waiting for the host to confirm the new mod inventory…
        </p>
      ) : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {reviewOpen ? (
        <ModReviewDialog
          active={active}
          applying={locked}
          inactive={inactive}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => void save()}
        />
      ) : null}
    </div>
  );
}
