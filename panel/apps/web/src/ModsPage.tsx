import { useQuery } from "@tanstack/react-query";
import type {
  AgentStatus,
  ModsUpdateApplyResult,
  ModsUpdateCheckResult,
  OperationCreateRequest,
  OperationRecord,
  WorkshopUpdate,
} from "@zomboid/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { throwApiError } from "./api-error";
import { ModManager } from "./ModManager";
import { PageHeading } from "./PanelNav";

type Mods = NonNullable<AgentStatus["mods"]>;

async function readOperation(operationId: string): Promise<OperationRecord> {
  const response = await fetch(`/api/operations/${operationId}`, { credentials: "same-origin" });
  if (!response.ok) throwApiError(response, "Could not track the Workshop update");
  return response.json() as Promise<OperationRecord>;
}

function dateFromWorkshopTimestamp(value: number) {
  if (!value) return "unknown date";
  return new Date(value * 1_000).toLocaleDateString();
}

function WorkshopUpdateDialog({
  updates,
  server,
  restart,
  requireEmpty,
  busy,
  onClose,
  onConfirm,
  onRestartChange,
  onRequireEmptyChange,
}: {
  updates: WorkshopUpdate[];
  server?: AgentStatus;
  restart: boolean;
  requireEmpty: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRestartChange: (value: boolean) => void;
  onRequireEmptyChange: (value: boolean) => void;
}) {
  const playerCount = server?.playerCount ?? -1;
  return (
    <div
      aria-labelledby="workshop-update-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Workshop sync
        </p>
        <h2 id="workshop-update-title" className="mt-1 text-xl font-semibold text-zinc-100">
          Update {updates.length} mod{updates.length === 1 ? "" : "s"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          The host will download the newer Workshop files. Existing files are kept if a download
          fails.
        </p>
        <div className="mt-4 max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          {updates.map((update) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
              key={update.workshopId}
            >
              <span className="min-w-0 truncate text-zinc-200">{update.title}</span>
              <span className="shrink-0 text-xs text-zinc-500">
                {dateFromWorkshopTimestamp(update.storedUpdatedAt)} →{" "}
                {dateFromWorkshopTimestamp(update.availableUpdatedAt)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-3 rounded-xl border border-zinc-800 p-3">
          <label className="flex items-start gap-3 text-sm text-zinc-300">
            <input
              checked={restart}
              className="mt-0.5 size-4 accent-emerald-400"
              onChange={(event) => onRestartChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong className="font-medium text-zinc-100">Restart after updating</strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Recommended so the game loads the new files immediately.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-zinc-300">
            <input
              checked={requireEmpty}
              className="mt-0.5 size-4 accent-emerald-400"
              onChange={(event) => onRequireEmptyChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong className="font-medium text-zinc-100">Require an empty server</strong>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Prevents an update from interrupting connected players.
              </span>
            </span>
          </label>
        </div>
        {playerCount > 0 ? (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
            {playerCount} player{playerCount === 1 ? "" : "s"} currently online. The empty-server
            guard will block this update until they leave.
          </p>
        ) : null}
        <p className="mt-4 text-xs text-zinc-500">
          A pre-update world backup follows the server&apos;s configured retention policy.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Queuing…" : "Update mods"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkshopUpdateCard({
  server,
  canOperate,
  busy,
  onQueue,
  onRefresh,
}: {
  server?: AgentStatus;
  canOperate: boolean;
  busy: boolean;
  onQueue: (request: OperationCreateRequest) => Promise<OperationRecord>;
  onRefresh: () => void;
}) {
  const [checkOperationId, setCheckOperationId] = useState<string>();
  const [applyOperationId, setApplyOperationId] = useState<string>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [restart, setRestart] = useState(true);
  const [requireEmpty, setRequireEmpty] = useState(true);
  const [error, setError] = useState<string>();
  const checkOperation = useQuery({
    queryKey: ["mods-update-check", checkOperationId],
    queryFn: () => readOperation(checkOperationId!),
    enabled: Boolean(checkOperationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" || status === "cancelled"
        ? false
        : 1_500;
    },
  });
  const applyOperation = useQuery({
    queryKey: ["mods-update-apply", applyOperationId],
    queryFn: () => readOperation(applyOperationId!),
    enabled: Boolean(applyOperationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" || status === "cancelled"
        ? false
        : 1_500;
    },
  });
  const checkResult = checkOperation.data?.result as ModsUpdateCheckResult | undefined;
  const applyResult = applyOperation.data?.result as ModsUpdateApplyResult | undefined;
  const checking =
    checkOperation.data?.status === "queued" || checkOperation.data?.status === "running";
  const applying =
    applyOperation.data?.status === "queued" || applyOperation.data?.status === "running";

  useEffect(() => {
    if (applyOperation.data?.status !== "succeeded") return;
    setCheckOperationId(undefined);
    setReviewOpen(false);
    onRefresh();
  }, [applyOperation.data?.status]);

  const check = async () => {
    setError(undefined);
    setApplyOperationId(undefined);
    try {
      const queued = await onQueue({ kind: "mods.update.check", payload: {} });
      setCheckOperationId(queued.operationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check Workshop updates");
    }
  };

  const apply = async () => {
    setError(undefined);
    try {
      const queued = await onQueue({
        kind: "mods.update.apply",
        payload: { restart, requireEmpty },
      });
      setApplyOperationId(queued.operationId);
      setReviewOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue the Workshop update");
    }
  };

  const updates = checkResult?.updates ?? [];
  const statusMessage =
    checkResult?.message ??
    (checkResult?.status === "up_to_date"
      ? "All tracked Workshop items are current."
      : checkResult?.status === "no_tracked_mods"
        ? "No tracked Workshop items yet. Add a Workshop mod to start tracking it."
        : undefined);

  return (
    <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Workshop sync
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Keep clients in sync</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Compare tracked Workshop versions with the host files and update only what changed.
          </p>
        </div>
        <button
          className="rounded-xl border border-emerald-400/40 px-3.5 py-2 text-sm text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-40"
          disabled={busy || checking || applying}
          onClick={() => void check()}
          type="button"
        >
          {checking ? "Checking…" : checkResult ? "Check again" : "Check for updates"}
        </button>
      </div>

      {checking ? (
        <p className="mt-5 text-sm text-zinc-400">
          Checking Workshop metadata through the host agent…
        </p>
      ) : null}
      {checkOperation.data?.status === "failed" ? (
        <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-300">
          {checkOperation.data.error ?? "Workshop update check failed."}
        </p>
      ) : null}
      {checkResult && !checking ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              className={`text-sm ${checkResult.status === "updates_available" ? "text-amber-200" : checkResult.status === "unavailable" ? "text-rose-300" : "text-emerald-300"}`}
            >
              {checkResult.status === "updates_available"
                ? `${updates.length} update${updates.length === 1 ? "" : "s"} available`
                : (statusMessage ?? "Workshop check completed.")}
            </p>
            <span className="text-xs text-zinc-600">
              {checkResult.trackedCount} tracked ·{" "}
              {new Date(checkResult.checkedAt).toLocaleString()}
            </span>
          </div>
          {updates.length ? (
            <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <ul className="space-y-2 text-sm text-zinc-200">
                {updates.slice(0, 5).map((update) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-2"
                    key={update.workshopId}
                  >
                    <span className="min-w-0 truncate">{update.title}</span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {dateFromWorkshopTimestamp(update.storedUpdatedAt)} →{" "}
                      {dateFromWorkshopTimestamp(update.availableUpdatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {updates.length > 5 ? (
                <p className="mt-2 text-xs text-zinc-500">and {updates.length - 5} more…</p>
              ) : null}
              <button
                className="mt-4 rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
                disabled={!canOperate || busy || applying}
                onClick={() => setReviewOpen(true)}
                type="button"
              >
                Update {updates.length} mod{updates.length === 1 ? "" : "s"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {applyOperation.data?.status === "failed" ? (
        <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-300">
          {applyOperation.data.error ?? "Workshop update failed."}
        </p>
      ) : null}
      {applying ? (
        <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
          Updating Workshop files on the host…
        </p>
      ) : null}
      {applyResult && !applying ? (
        <div
          className={`mt-4 rounded-xl border p-3 text-sm ${applyResult.status === "partial" ? "border-amber-400/20 bg-amber-400/5 text-amber-200" : "border-emerald-400/20 bg-emerald-400/5 text-emerald-200"}`}
        >
          {applyResult.status === "partial"
            ? `${applyResult.updated.length} updated; ${applyResult.failed.length} failed. Previous files were kept for failures.`
            : `${applyResult.updated.length} mod${applyResult.updated.length === 1 ? "" : "s"} updated successfully.`}
          {applyResult.restartRequested && !applyResult.restarted
            ? " Restart will be needed before players reconnect."
            : null}
        </div>
      ) : null}
      {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      {reviewOpen && updates.length ? (
        <WorkshopUpdateDialog
          busy={busy || applying}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => void apply()}
          onRequireEmptyChange={setRequireEmpty}
          onRestartChange={setRestart}
          requireEmpty={requireEmpty}
          restart={restart}
          server={server}
          updates={updates}
        />
      ) : null}
    </section>
  );
}

function ResetWorldDialog({
  createBackup,
  onClose,
  onConfirm,
  onToggleBackup,
}: {
  createBackup: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onToggleBackup: (value: boolean) => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = phrase === "RESET WORLD";

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      aria-labelledby="reset-world-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-2xl border border-rose-500/40 bg-zinc-900 p-5 shadow-2xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">
          Danger zone
        </p>
        <h2 id="reset-world-title" className="mt-1 text-xl font-semibold text-zinc-100">
          Reset world and player data
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          This permanently deletes the current world and player data. Make sure the server is not in
          use before continuing.
        </p>
        <label className="mt-5 flex items-center gap-2 text-sm text-zinc-300">
          <input
            checked={createBackup}
            className="size-4 accent-emerald-400"
            onChange={(event) => onToggleBackup(event.target.checked)}
            type="checkbox"
          />
          Create a backup first
        </label>
        <label className="mt-5 block text-sm text-zinc-300" htmlFor="reset-world-confirmation">
          Type <strong className="font-semibold text-rose-200">RESET WORLD</strong> to confirm
        </label>
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-rose-400"
          id="reset-world-confirmation"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
        />
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-40"
            disabled={!ready || saving}
            onClick={() => void confirm()}
            type="button"
          >
            {saving ? "Queuing…" : "Reset world"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModsPage({
  server,
  mods,
  canAdmin,
  canOperate,
  busy,
  onQueue,
  onRefresh,
}: {
  server?: AgentStatus;
  mods?: Mods;
  canAdmin: boolean;
  canOperate: boolean;
  busy: boolean;
  onQueue: (request: OperationCreateRequest) => Promise<OperationRecord>;
  onRefresh: () => void;
}) {
  const [workshopId, setWorkshopId] = useState("");
  const [resetBackup, setResetBackup] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);

  const addMod = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setAdding(true);
    try {
      await onQueue({ kind: "mods.add", payload: { workshopId } });
      setWorkshopId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add Workshop mod");
    } finally {
      setAdding(false);
    }
  };

  const resetWorld = async () => {
    setError(undefined);
    try {
      await onQueue({
        kind: "world.reset",
        payload: { confirm: true, createBackup: resetBackup },
      });
      setResetOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue world reset");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Content"
        title="Mods"
        description="Manage Workshop content and its load order. Changes are staged safely and require a server restart."
      />

      <WorkshopUpdateCard
        busy={busy}
        canOperate={canOperate}
        onQueue={onQueue}
        onRefresh={onRefresh}
        server={server}
      />

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <form className="space-y-3" onSubmit={(event) => void addMod(event)}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Add content
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">Workshop mod</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Paste a Workshop item ID. The agent installs it and updates the server inventory.
              </p>
            </div>
            <label className="sr-only" htmlFor="workshop-id">
              Workshop item ID
            </label>
            <input
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-emerald-400 focus:ring-2"
              id="workshop-id"
              inputMode="numeric"
              pattern="[0-9]{6,20}"
              placeholder="Workshop item ID"
              value={workshopId}
              onChange={(event) => setWorkshopId(event.target.value)}
            />
            <button
              className="rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
              disabled={!canOperate || busy || adding || !/^[0-9]{6,20}$/.test(workshopId)}
              type="submit"
            >
              {adding ? "Adding…" : "Add Workshop mod"}
            </button>
          </form>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Inventory
            </p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">Configured content</h2>
            {mods ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  {(mods.collections ?? []).length ? (
                    (mods.collections ?? []).map((collection) => (
                      <a
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-emerald-300 hover:border-emerald-400"
                        href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${collection.id}`}
                        key={collection.id}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {collection.title}
                      </a>
                    ))
                  ) : (
                    <span className="text-sm text-zinc-500">No collection source recorded</span>
                  )}
                </div>
                <details className="rounded-xl border border-zinc-800 p-3">
                  <summary className="cursor-pointer text-sm text-zinc-300">
                    {(mods.configuredItems ?? []).length} configured Workshop items
                  </summary>
                  <div className="mt-3 grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
                    {(mods.configuredItems ?? []).map((item) => (
                      <a
                        className="rounded-lg bg-zinc-950 px-2.5 py-2 text-xs text-zinc-300 hover:text-emerald-300"
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
                {mods.inactiveModIds.length ? (
                  <p className="text-xs text-amber-200">
                    {mods.inactiveModIds.length} inactive mod(s)
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">Waiting for the agent inventory…</p>
            )}
          </div>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Load order
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Active mods</h2>
        </div>
        <ModManager busy={busy} canOperate={canOperate} mods={mods} onQueue={onQueue} />
      </section>

      {canAdmin ? (
        <section className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.03] p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">
            Danger zone
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Reset world data</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Permanently deletes the current world and player data. This is unrelated to mod
            management and is intentionally isolated here.
          </p>
          <div className="mt-5">
            <button
              className="rounded-xl border border-rose-500/50 px-3.5 py-2 text-sm text-rose-300 hover:border-rose-400 disabled:opacity-40"
              disabled={busy}
              onClick={() => setResetOpen(true)}
              type="button"
            >
              Reset world data
            </button>
          </div>
        </section>
      ) : null}
      {resetOpen ? (
        <ResetWorldDialog
          createBackup={resetBackup}
          onClose={() => setResetOpen(false)}
          onConfirm={resetWorld}
          onToggleBackup={setResetBackup}
        />
      ) : null}
    </div>
  );
}
