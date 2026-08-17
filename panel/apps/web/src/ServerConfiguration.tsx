import { useQuery } from "@tanstack/react-query";
import type {
  AuthUser,
  ConfigField,
  ConfigSnapshot,
  ConfigUpdatePayload,
  OperationRecord,
} from "@zomboid/contracts";
import { useEffect, useMemo, useState } from "react";
import { throwApiError } from "./api-error";

type Scalar = boolean | number | string;
type Draft = Record<string, Scalar>;
type ViewMode = "common" | "advanced";

const COMMON_PATHS: Record<string, true> = {
  SleepAllowed: true,
  SleepNeeded: true,
  FastForwardMultiplier: true,
  PauseEmpty: true,
  SaveWorldEveryMinutes: true,
  PVP: true,
  PvP: true,
};

function identity(field: Pick<ConfigField, "source" | "path">) {
  return `${field.source}:${field.path}`;
}

function displayValue(value: Scalar | null | undefined) {
  if (value === null || value === undefined || value === "") return "Not configured";
  return String(value);
}

async function readConfig(serverId: string): Promise<ConfigSnapshot> {
  const response = await fetch(`/api/servers/${serverId}/config`, { credentials: "same-origin" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throwApiError(response, body?.error?.message ?? "Configuration unavailable");
  }
  return response.json() as Promise<ConfigSnapshot>;
}

async function readOperation(operationId: string): Promise<OperationRecord> {
  const response = await fetch(`/api/operations/${operationId}`, { credentials: "same-origin" });
  if (!response.ok) throwApiError(response, "Could not track the configuration update");
  return response.json() as Promise<OperationRecord>;
}

function fieldValue(field: ConfigField, draft: Draft): Scalar | null {
  return draft[identity(field)] ?? field.value;
}

function FieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ConfigField;
  value: Scalar | null;
  disabled: boolean;
  onChange: (value: Scalar) => void;
}) {
  if (field.sensitive) {
    return (
      <span className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
        {field.configured ? "Configured and protected" : "Not configured"}
      </span>
    );
  }
  if (!field.editable) {
    return <span className="text-xs text-zinc-500">Managed by a dedicated workflow</span>;
  }
  if (field.type === "boolean") {
    const enabled = value === true;
    return (
      <button
        aria-pressed={enabled}
        className={`flex min-w-24 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition ${enabled ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-zinc-700 bg-zinc-950 text-zinc-400"}`}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        type="button"
      >
        <span>{enabled ? "Enabled" : "Disabled"}</span>
        <span
          className={`relative h-4 w-7 rounded-full transition ${enabled ? "bg-emerald-400" : "bg-zinc-700"}`}
        >
          <span
            className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition ${enabled ? "left-3.5" : "left-0.5"}`}
          />
        </span>
      </button>
    );
  }
  const optionsId = `options-${field.source}-${field.path.replaceAll(".", "-")}`;
  return (
    <>
      <input
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400 disabled:opacity-50 sm:w-52"
        disabled={disabled}
        list={field.options?.length ? optionsId : undefined}
        max={field.maximum}
        min={field.minimum}
        step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
        type={field.type === "string" ? "text" : "number"}
        value={String(value ?? "")}
        onChange={(event) => {
          if (field.type === "string") onChange(event.target.value);
          else if (event.target.value !== "") {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed) && (field.type !== "integer" || Number.isInteger(parsed)))
              onChange(parsed);
          }
        }}
      />
      {field.options?.length ? (
        <datalist id={optionsId}>
          {field.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </datalist>
      ) : null}
    </>
  );
}

function ReviewDialog({
  changed,
  draft,
  applying,
  onClose,
  onConfirm,
}: {
  changed: ConfigField[];
  draft: Draft;
  applying: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-labelledby="configuration-review-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Before saving
        </p>
        <h2 id="configuration-review-title" className="mt-1 text-xl font-semibold text-zinc-100">
          Review {changed.length} change{changed.length === 1 ? "" : "s"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Nothing has been written yet. A recovery backup will be created and the server should be
          restarted before players rely on these values.
        </p>
        <div className="mt-5 max-h-80 space-y-2 overflow-y-auto pr-1">
          {changed.map((field) => {
            const key = identity(field);
            return (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3" key={key}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-200">{field.label}</p>
                  <span className="text-[11px] text-zinc-600">
                    {field.source} · {field.path}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <p className="rounded-lg bg-zinc-900 px-2.5 py-2 text-zinc-500">
                    Current:{" "}
                    <strong className="font-medium text-zinc-300">
                      {displayValue(field.value)}
                    </strong>
                  </p>
                  <p className="rounded-lg bg-emerald-400/10 px-2.5 py-2 text-emerald-200">
                    New: <strong className="font-medium">{displayValue(draft[key])}</strong>
                  </p>
                </div>
              </div>
            );
          })}
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
            {applying ? "Applying…" : "Confirm and apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ServerConfiguration({
  serverId,
  user,
  busy,
  onQueue,
}: {
  serverId: string;
  user?: AuthUser;
  busy: boolean;
  onQueue: (payload: ConfigUpdatePayload) => Promise<OperationRecord>;
}) {
  const canEdit = user?.role === "admin" || user?.role === "operator";
  const config = useQuery({
    queryKey: ["server-config", serverId],
    queryFn: () => readConfig(serverId),
    enabled: canEdit,
    staleTime: 30_000,
    retry: false,
  });
  const [draft, setDraft] = useState<Draft>({});
  const [viewMode, setViewMode] = useState<ViewMode>("common");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"all" | "server" | "sandbox">("all");
  const [category, setCategory] = useState<string>("sleep");
  const [changedOnly, setChangedOnly] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [operationId, setOperationId] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const operation = useQuery({
    queryKey: ["config-operation", operationId],
    queryFn: () => readOperation(operationId!),
    enabled: Boolean(operationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" || status === "cancelled"
        ? false
        : 1_500;
    },
  });

  useEffect(() => {
    if (operation.data?.status === "succeeded") {
      setDraft({});
      void (async () => {
        const refreshed = await config.refetch();
        if (refreshed.isSuccess) {
          setSuccessMessage("Configuration saved and re-read from the host.");
        } else {
          setSubmitError("Configuration was saved, but the host snapshot could not be re-read.");
        }
      })();
    }
  }, [operation.data?.status]);

  const fields = config.data?.fields ?? [];
  const changed = useMemo(
    () =>
      fields.filter((field) => {
        const key = identity(field);
        return key in draft && draft[key] !== field.value;
      }),
    [draft, fields],
  );
  const categories = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; count: number }>();
    for (const field of fields) {
      if (source !== "all" && field.source !== source) continue;
      const current = byId.get(field.category);
      if (current) current.count += 1;
      else byId.set(field.category, { id: field.category, label: field.categoryLabel, count: 1 });
    }
    return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [fields, source]);
  useEffect(() => {
    if (!categories.length || categories.some((item) => item.id === category)) return;
    setCategory(categories.find((item) => item.id === "sleep")?.id ?? categories[0]!.id);
  }, [categories, category]);

  const commonFields = useMemo(
    () =>
      fields
        .filter((field) => COMMON_PATHS[field.path] && field.editable && !field.sensitive)
        .slice(0, 12),
    [fields],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return fields.filter((field) => {
      if (viewMode === "common" && !commonFields.some((item) => identity(item) === identity(field)))
        return false;
      if (viewMode === "advanced" && source !== "all" && field.source !== source) return false;
      if (viewMode === "advanced" && !needle && !changedOnly && field.category !== category)
        return false;
      if (changedOnly && !changed.some((candidate) => identity(candidate) === identity(field)))
        return false;
      return (
        !needle ||
        `${field.label} ${field.path} ${field.description}`.toLocaleLowerCase().includes(needle)
      );
    });
  }, [category, changed, changedOnly, commonFields, fields, search, source, viewMode]);

  const setValue = (field: ConfigField, value: Scalar) => {
    setSuccessMessage(undefined);
    setDraft((current) => ({ ...current, [identity(field)]: value }));
  };
  const applySleepPreset = (allowed: boolean, needed: boolean) => {
    setSuccessMessage(undefined);
    const next = { ...draft };
    for (const field of fields) {
      if (field.source === "server" && field.path === "SleepAllowed")
        next[identity(field)] = allowed;
      if (field.source === "server" && field.path === "SleepNeeded") next[identity(field)] = needed;
    }
    setDraft(next);
  };
  const applying =
    busy || operation.data?.status === "queued" || operation.data?.status === "running";

  const applyChanges = async () => {
    setSubmitError(undefined);
    try {
      const queued = await onQueue({
        expectedRevision: config.data!.revision,
        createBackup: true,
        changes: changed.map((field) => ({
          source: field.source,
          path: field.path,
          value: draft[identity(field)]!,
        })),
      });
      setReviewOpen(false);
      setOperationId(queued.operationId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not apply changes");
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 shadow-xl shadow-black/10">
      <header className="border-b border-zinc-800 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Assisted configuration
            </p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-100">Server and Sandbox</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Use common controls for everyday changes, or browse the full typed configuration when
              you need an advanced option. Mod-defined keys remain available.
            </p>
          </div>
          <button
            className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-emerald-400 hover:text-emerald-300 disabled:opacity-40"
            disabled={config.isFetching || busy}
            onClick={() => void config.refetch()}
            type="button"
          >
            {config.isFetching ? "Reloading…" : "Reload from host"}
          </button>
        </div>
        {config.data ? (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-500">
            <span>{fields.length} options discovered</span>
            <span>{fields.filter((field) => field.editable).length} editable</span>
            <details>
              <summary className="cursor-pointer hover:text-zinc-300">Technical details</summary>
              <span className="ml-2 font-mono text-zinc-400">
                revision {config.data.revision.slice(0, 12)}
              </span>
            </details>
          </div>
        ) : null}
      </header>

      {config.isError ? (
        <p className="m-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200 sm:m-6">
          {config.error.message}
        </p>
      ) : null}
      {successMessage ? (
        <p className="m-5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-300 sm:m-6">
          {successMessage}
        </p>
      ) : null}
      {config.data?.warnings.length ? (
        <div className="m-5 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200 sm:m-6">
          <p className="font-medium">Some entries need attention</p>
          <p className="mt-1 text-xs text-amber-200/70">
            They were preserved safely and are not blocking the rest of the configuration.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-amber-100">
              Show parser warnings
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {config.data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
      {!canEdit ? (
        <p className="p-5 text-sm text-zinc-400 sm:p-6">
          An operator or administrator role is required to read and edit configuration.
        </p>
      ) : null}
      {config.isPending && canEdit ? (
        <p className="p-5 text-sm text-zinc-400 sm:p-6">
          Reading current configuration through the agent…
        </p>
      ) : null}

      {config.data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4 sm:px-6">
            <div className="flex rounded-lg border border-zinc-700 bg-zinc-950 p-1">
              <button
                className={`rounded-md px-3 py-1.5 text-xs ${viewMode === "common" ? "bg-zinc-100 font-medium text-zinc-950" : "text-zinc-400 hover:text-white"}`}
                onClick={() => {
                  setViewMode("common");
                  setSearch("");
                  setChangedOnly(false);
                }}
                type="button"
              >
                Common settings
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-xs ${viewMode === "advanced" ? "bg-zinc-100 font-medium text-zinc-950" : "text-zinc-400 hover:text-white"}`}
                onClick={() => setViewMode("advanced")}
                type="button"
              >
                All settings
              </button>
            </div>
            {changed.length ? (
              <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300">
                {changed.length} unsaved change{changed.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {viewMode === "advanced" ? (
            <div className="grid lg:grid-cols-[220px_1fr]">
              <aside className="border-b border-zinc-800 p-4 lg:border-b-0 lg:border-r lg:p-5">
                <div className="grid grid-cols-3 gap-1.5">
                  {(["all", "server", "sandbox"] as const).map((item) => (
                    <button
                      className={`rounded-lg px-2 py-2 text-xs ${source === item ? "bg-emerald-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                      key={item}
                      onClick={() => setSource(item)}
                      type="button"
                    >
                      {item === "all" ? "All" : item === "server" ? "Server" : "Sandbox"}
                    </button>
                  ))}
                </div>
                <nav className="mt-4 max-h-[32rem] space-y-1 overflow-y-auto pr-1">
                  {categories.map((item) => (
                    <button
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${category === item.id && !search && !changedOnly ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"}`}
                      key={item.id}
                      onClick={() => {
                        setCategory(item.id);
                        setSearch("");
                        setChangedOnly(false);
                      }}
                      type="button"
                    >
                      <span>{item.label}</span>
                      <span className="text-xs text-zinc-600">{item.count}</span>
                    </button>
                  ))}
                </nav>
              </aside>

              <div className="min-w-0 p-5 sm:p-6">
                <div className="flex flex-wrap gap-3">
                  <input
                    aria-label="Search configuration"
                    className="min-w-52 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-400"
                    placeholder="Search by name, key or description…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <button
                    className={`rounded-xl border px-4 py-2 text-sm ${changedOnly ? "border-emerald-400 text-emerald-300" : "border-zinc-700 text-zinc-400 hover:text-zinc-200"}`}
                    onClick={() => setChangedOnly((value) => !value)}
                    type="button"
                  >
                    Changed ({changed.length})
                  </button>
                </div>
                <FieldList
                  applying={applying}
                  changed={changed}
                  draft={draft}
                  fields={visible}
                  onChange={setValue}
                  onUndo={(key) =>
                    setDraft((current) => {
                      const next = { ...current };
                      delete next[key];
                      return next;
                    })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="p-5 sm:p-6">
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                <p className="font-medium text-emerald-200">Multiplayer sleep presets</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Choose a known behavior; you can review the exact values before applying them.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-300"
                    disabled={applying}
                    onClick={() => applySleepPreset(true, false)}
                    type="button"
                  >
                    Allow, not required
                  </button>
                  <button
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500"
                    disabled={applying}
                    onClick={() => applySleepPreset(true, true)}
                    type="button"
                  >
                    Allow and require
                  </button>
                  <button
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500"
                    disabled={applying}
                    onClick={() => applySleepPreset(false, false)}
                    type="button"
                  >
                    Disable sleep
                  </button>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium text-zinc-200">Frequently used options</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    A small set of safe everyday controls. Use All settings for everything else.
                  </p>
                </div>
                <button
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-emerald-400 hover:text-emerald-300"
                  onClick={() => setViewMode("advanced")}
                  type="button"
                >
                  Browse all {fields.length} settings
                </button>
              </div>
              <FieldList
                applying={applying}
                changed={changed}
                draft={draft}
                fields={visible}
                onChange={setValue}
                onUndo={(key) =>
                  setDraft((current) => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                  })
                }
              />
              {changedOnly ? (
                <button
                  className="mt-4 text-xs text-zinc-400 underline hover:text-white"
                  onClick={() => setChangedOnly(false)}
                  type="button"
                >
                  Show all common options
                </button>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {changed.length ? (
        <footer className="sticky bottom-3 z-20 m-3 rounded-xl border border-emerald-400/20 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur sm:m-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium text-zinc-100">
                {changed.length} unsaved change{changed.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-zinc-500">A restart will be required after applying.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-xl border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
                disabled={applying}
                onClick={() => setDraft({})}
                type="button"
              >
                Discard
              </button>
              <button
                className="rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-40"
                disabled={!canEdit || applying || !config.data}
                onClick={() => setReviewOpen(true)}
                type="button"
              >
                Review changes
              </button>
            </div>
          </div>
          {submitError ? <p className="mt-3 text-sm text-rose-300">{submitError}</p> : null}
          {operation.data?.status === "failed" ? (
            <p className="mt-3 text-sm text-rose-300">Host failure: {operation.data.error}</p>
          ) : null}
        </footer>
      ) : null}

      {reviewOpen ? (
        <ReviewDialog
          applying={applying}
          changed={changed}
          draft={draft}
          onClose={() => setReviewOpen(false)}
          onConfirm={() => void applyChanges()}
        />
      ) : null}
    </section>
  );
}

function FieldList({
  fields,
  changed,
  draft,
  applying,
  onChange,
  onUndo,
}: {
  fields: ConfigField[];
  changed: ConfigField[];
  draft: Draft;
  applying: boolean;
  onChange: (field: ConfigField, value: Scalar) => void;
  onUndo: (key: string) => void;
}) {
  return (
    <div className="mt-5 space-y-2">
      {fields.map((field) => {
        const key = identity(field);
        const value = fieldValue(field, draft);
        const isChanged = key in draft && draft[key] !== field.value;
        return (
          <article
            className={`rounded-xl border p-3 transition sm:p-4 ${isChanged ? "border-emerald-400/50 bg-emerald-400/5" : "border-zinc-800 bg-black/10"}`}
            key={key}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-zinc-100">{field.label}</h3>
                  {isChanged ? (
                    <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                      changed
                    </span>
                  ) : null}
                  {!field.editable ? (
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                      read only
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-zinc-400">
                  {field.description}
                </p>
                <details className="mt-2 text-[11px] text-zinc-600">
                  <summary className="cursor-pointer hover:text-zinc-400">Details</summary>
                  <p className="mt-1 font-mono">
                    {field.source} · {field.path} · {field.type}
                    {field.minimum !== undefined ? ` · min ${field.minimum}` : ""}
                    {field.maximum !== undefined ? ` · max ${field.maximum}` : ""}
                  </p>
                </details>
              </div>
              <div className="shrink-0 sm:pt-0.5">
                <FieldControl
                  disabled={applying || !field.editable}
                  field={field}
                  value={value}
                  onChange={(next) => onChange(field, next)}
                />
              </div>
            </div>
            {isChanged ? (
              <button
                className="mt-3 text-xs text-zinc-400 underline hover:text-white"
                onClick={() => onUndo(key)}
                type="button"
              >
                Undo this change
              </button>
            ) : null}
          </article>
        );
      })}
      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
          {changed.length ? "No changed options match this view." : "No options match this filter."}
        </p>
      ) : null}
    </div>
  );
}
