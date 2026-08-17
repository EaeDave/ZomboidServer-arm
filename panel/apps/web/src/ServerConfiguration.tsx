import { useQuery } from "@tanstack/react-query";
import type {
  AuthUser,
  ConfigField,
  ConfigSnapshot,
  ConfigUpdatePayload,
  OperationRecord,
} from "@zomboid/contracts";
import { useEffect, useMemo, useState } from "react";

type Scalar = boolean | number | string;
type Draft = Record<string, Scalar>;

class ConfigApiError extends Error {}

function identity(field: Pick<ConfigField, "source" | "path">) {
  return `${field.source}:${field.path}`;
}

async function readConfig(serverId: string): Promise<ConfigSnapshot> {
  const response = await fetch(`/api/servers/${serverId}/config`, { credentials: "same-origin" });
  const body = (await response.json()) as ConfigSnapshot & { error?: { message?: string } };
  if (!response.ok) throw new ConfigApiError(body.error?.message ?? "Configuração indisponível");
  return body;
}

async function readOperation(operationId: string): Promise<OperationRecord> {
  const response = await fetch(`/api/operations/${operationId}`, { credentials: "same-origin" });
  if (!response.ok) throw new ConfigApiError("Não foi possível acompanhar a alteração");
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
        {field.configured ? "Configurado e protegido" : "Não configurado"}
      </span>
    );
  }
  if (!field.editable) {
    return <span className="text-xs text-zinc-500">Gerenciado por uma área dedicada</span>;
  }
  if (field.type === "boolean") {
    return (
      <button
        aria-pressed={value === true}
        className={`relative h-7 w-12 rounded-full transition ${value === true ? "bg-emerald-400" : "bg-zinc-700"}`}
        disabled={disabled}
        onClick={() => onChange(value !== true)}
        type="button"
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${value === true ? "left-6" : "left-1"}`}
        />
        <span className="sr-only">{value === true ? "Ativado" : "Desativado"}</span>
      </button>
    );
  }
  if (field.options?.length) {
    return (
      <select
        className="max-w-xs rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        disabled={disabled}
        value={String(value ?? "")}
        onChange={(event) => {
          const option = field.options?.find(
            ({ value: candidate }) => String(candidate) === event.target.value,
          );
          if (option) onChange(option.value);
        }}
      >
        {field.options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="w-44 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:opacity-50"
      disabled={disabled}
      max={field.maximum}
      min={field.minimum}
      step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
      type={field.type === "string" ? "text" : "number"}
      value={String(value ?? "")}
      onChange={(event) => {
        if (field.type === "string") onChange(event.target.value);
        else if (event.target.value !== "") {
          const parsed =
            field.type === "integer"
              ? Number.parseInt(event.target.value, 10)
              : Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }
      }}
    />
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
  const config = useQuery({
    queryKey: ["server-config", serverId],
    queryFn: () => readConfig(serverId),
    enabled: Boolean(user),
    staleTime: 30_000,
    retry: false,
  });
  const [draft, setDraft] = useState<Draft>({});
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"all" | "server" | "sandbox">("all");
  const [category, setCategory] = useState<string>("sleep");
  const [changedOnly, setChangedOnly] = useState(false);
  const [createBackup, setCreateBackup] = useState(true);
  const [operationId, setOperationId] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
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
      void config.refetch();
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
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return fields.filter((field) => {
      if (source !== "all" && field.source !== source) return false;
      if (!needle && !changedOnly && field.category !== category) return false;
      if (changedOnly && !changed.some((candidate) => identity(candidate) === identity(field)))
        return false;
      return (
        !needle ||
        `${field.label} ${field.path} ${field.description}`.toLocaleLowerCase().includes(needle)
      );
    });
  }, [category, changed, changedOnly, fields, search, source]);

  const setValue = (field: ConfigField, value: Scalar) => {
    setDraft((current) => ({ ...current, [identity(field)]: value }));
  };
  const applySleepPreset = (allowed: boolean, needed: boolean) => {
    const next = { ...draft };
    for (const field of fields) {
      if (field.source === "server" && field.path === "SleepAllowed")
        next[identity(field)] = allowed;
      if (field.source === "server" && field.path === "SleepNeeded") next[identity(field)] = needed;
    }
    setDraft(next);
    setSource("server");
    setCategory("sleep");
  };
  const canEdit = user?.role === "admin" || user?.role === "operator";
  const applying =
    busy || operation.data?.status === "queued" || operation.data?.status === "running";

  return (
    <section
      className="mt-5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 shadow-2xl shadow-black/20"
      id="configuration"
    >
      <header className="border-b border-zinc-800 p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-emerald-400">
              Configuração assistida
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Servidor e Sandbox</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Edite as opções reais do INI e do Sandbox sem abrir um editor. Chaves de mods são
              descobertas automaticamente; segredos e identidade do mundo permanecem protegidos.
            </p>
          </div>
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-400 disabled:opacity-40"
            disabled={config.isFetching || busy}
            onClick={() => void config.refetch()}
            type="button"
          >
            {config.isFetching ? "Carregando…" : "Recarregar do host"}
          </button>
        </div>
        {config.data ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-black/20 p-4">
              <p className="text-xs text-zinc-500">Opções encontradas</p>
              <p className="mt-1 text-xl font-semibold">{fields.length}</p>
            </div>
            <div className="rounded-xl bg-black/20 p-4">
              <p className="text-xs text-zinc-500">Editáveis</p>
              <p className="mt-1 text-xl font-semibold">
                {fields.filter((field) => field.editable).length}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-4">
              <p className="text-xs text-zinc-500">Revisão carregada</p>
              <p className="mt-1 font-mono text-sm text-zinc-300">
                {config.data.revision.slice(0, 12)}
              </p>
            </div>
          </div>
        ) : null}
      </header>

      {config.isError ? (
        <p className="m-6 rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">
          {config.error.message}
        </p>
      ) : null}
      {config.isPending ? (
        <p className="p-6 text-sm text-zinc-400">Lendo configurações atuais pelo agente…</p>
      ) : null}
      {config.data ? (
        <div className="grid lg:grid-cols-[250px_1fr]">
          <aside className="border-b border-zinc-800 p-5 lg:border-b-0 lg:border-r">
            <div className="grid grid-cols-3 gap-2">
              {(["all", "server", "sandbox"] as const).map((item) => (
                <button
                  className={`rounded-lg px-2 py-2 text-xs ${source === item ? "bg-emerald-400 text-zinc-950" : "bg-zinc-800 text-zinc-300"}`}
                  key={item}
                  onClick={() => setSource(item)}
                  type="button"
                >
                  {item === "all" ? "Tudo" : item === "server" ? "Servidor" : "Sandbox"}
                </button>
              ))}
            </div>
            <nav className="mt-5 space-y-1">
              {categories.map((item) => (
                <button
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${category === item.id && !search && !changedOnly ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-800/60"}`}
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

          <div className="min-w-0 p-5 md:p-6">
            <div className="flex flex-wrap gap-3">
              <input
                aria-label="Buscar configurações"
                className="min-w-64 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm outline-none focus:border-emerald-400"
                placeholder="Buscar por nome, chave ou descrição…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                className={`rounded-xl border px-4 py-2 text-sm ${changedOnly ? "border-emerald-400 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}
                onClick={() => setChangedOnly((value) => !value)}
                type="button"
              >
                Alteradas ({changed.length})
              </button>
            </div>

            {category === "sleep" && !search && !changedOnly ? (
              <div className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                <p className="font-medium text-emerald-200">Atalhos de sono multiplayer</p>
                <p className="mt-1 text-sm text-zinc-400">
                  Escolha um comportamento conhecido; você ainda revisará o diff antes de aplicar.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-medium text-zinc-950"
                    onClick={() => applySleepPreset(true, false)}
                    type="button"
                  >
                    Permitir, sem obrigar
                  </button>
                  <button
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
                    onClick={() => applySleepPreset(true, true)}
                    type="button"
                  >
                    Permitir e exigir
                  </button>
                  <button
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
                    onClick={() => applySleepPreset(false, false)}
                    type="button"
                  >
                    Desativar sono
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 space-y-3">
              {visible.map((field) => {
                const key = identity(field);
                const value = fieldValue(field, draft);
                const isChanged = key in draft && draft[key] !== field.value;
                return (
                  <article
                    className={`rounded-xl border p-4 transition ${isChanged ? "border-emerald-400/50 bg-emerald-400/5" : "border-zinc-800 bg-black/15"}`}
                    key={key}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{field.label}</h3>
                          {isChanged ? (
                            <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase text-emerald-300">
                              alterada
                            </span>
                          ) : null}
                          {!field.editable ? (
                            <span className="rounded-full bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300">
                              somente leitura
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm leading-5 text-zinc-400">{field.description}</p>
                        <p className="mt-2 font-mono text-[11px] text-zinc-600">
                          {field.source} · {field.path}
                          {field.minimum !== undefined ? ` · mín ${field.minimum}` : ""}
                          {field.maximum !== undefined ? ` · máx ${field.maximum}` : ""}
                        </p>
                      </div>
                      <FieldControl
                        disabled={!canEdit || applying}
                        field={field}
                        value={value}
                        onChange={(next) => setValue(field, next)}
                      />
                    </div>
                    {isChanged ? (
                      <button
                        className="mt-3 text-xs text-zinc-400 underline hover:text-white"
                        onClick={() =>
                          setDraft((current) => {
                            const next = { ...current };
                            delete next[key];
                            return next;
                          })
                        }
                        type="button"
                      >
                        Desfazer esta alteração
                      </button>
                    ) : null}
                  </article>
                );
              })}
              {visible.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
                  Nenhuma opção encontrada neste filtro.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {changed.length ? (
        <footer className="sticky bottom-0 border-t border-emerald-400/20 bg-zinc-950/95 p-5 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium">{changed.length} alteração(ões) no rascunho</p>
              <p className="text-xs text-zinc-500">
                Nada foi gravado no servidor ainda. Todas exigem reinício.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  checked={createBackup}
                  onChange={(event) => setCreateBackup(event.target.checked)}
                  type="checkbox"
                />
                Criar backup dos arquivos
              </label>
              <button
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm"
                disabled={applying}
                onClick={() => setDraft({})}
                type="button"
              >
                Descartar
              </button>
              <button
                className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
                disabled={!canEdit || applying || !config.data}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Aplicar ${changed.length} alteração(ões) ao servidor ${serverId}?`,
                    )
                  )
                    return;
                  setSubmitError(undefined);
                  try {
                    const queued = await onQueue({
                      expectedRevision: config.data!.revision,
                      createBackup,
                      changes: changed.map((field) => ({
                        source: field.source,
                        path: field.path,
                        value: draft[identity(field)]!,
                      })),
                    });
                    setOperationId(queued.operationId);
                  } catch (error) {
                    setSubmitError(
                      error instanceof Error ? error.message : "Não foi possível aplicar",
                    );
                  }
                }}
                type="button"
              >
                {applying ? "Aplicando…" : "Revisar e aplicar"}
              </button>
            </div>
          </div>
          {submitError ? (
            <p className="mx-auto mt-3 max-w-5xl text-sm text-rose-300">{submitError}</p>
          ) : null}
          {operation.data?.status === "failed" ? (
            <p className="mx-auto mt-3 max-w-5xl text-sm text-rose-300">
              Falha no host: {operation.data.error}
            </p>
          ) : null}
          {operation.data?.status === "succeeded" ? (
            <p className="mx-auto mt-3 max-w-5xl text-sm text-emerald-300">
              Configuração salva e relida do host. Reinicie o servidor quando estiver pronto.
            </p>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
