import type { AgentStatus, OperationCreateRequest, OperationRecord } from "@zomboid/contracts";
import { useState, type FormEvent } from "react";
import { ModManager } from "./ModManager";
import { PageHeading } from "./PanelNav";

type Mods = NonNullable<AgentStatus["mods"]>;

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
  mods,
  canAdmin,
  canOperate,
  busy,
  onQueue,
}: {
  mods?: Mods;
  canAdmin: boolean;
  canOperate: boolean;
  busy: boolean;
  onQueue: (request: OperationCreateRequest) => Promise<OperationRecord>;
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
