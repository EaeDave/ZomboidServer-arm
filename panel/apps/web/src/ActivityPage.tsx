import type { AgentStatus, AuditEvent, HealthResponse, OperationRecord } from "@zomboid/contracts";
import { PageHeading } from "./PanelNav";

function operationLabel(kind: string) {
  return kind.replaceAll(".", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: OperationRecord["status"]) {
  if (status === "succeeded") return "text-emerald-300";
  if (status === "failed" || status === "cancelled") return "text-rose-300";
  return "text-amber-200";
}

export function ActivityPage({
  operations,
  audit,
  auditLoading,
  auditError,
  canAdmin,
  health,
  server,
}: {
  operations?: OperationRecord[];
  audit?: AuditEvent[];
  auditLoading: boolean;
  auditError?: string;
  canAdmin: boolean;
  health?: HealthResponse;
  server?: AgentStatus;
}) {
  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="History"
        title="Activity"
        description="Review operations performed on the server and security-sensitive administrator actions."
      />

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Server operations
            </p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">Recent jobs</h2>
          </div>
          <span className="text-xs text-zinc-500">Automatically refreshed</span>
        </div>
        {operations?.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-3 font-medium">Operation</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Target</th>
                  <th className="px-3 py-3 font-medium">Created</th>
                  <th className="px-3 py-3 font-medium">Finished</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {operations.slice(0, 30).map((operation) => (
                  <tr className="text-zinc-300" key={operation.operationId}>
                    <td className="px-3 py-3 font-medium">{operationLabel(operation.kind)}</td>
                    <td className={`px-3 py-3 ${statusClass(operation.status)}`}>
                      {operation.status}
                    </td>
                    <td className="px-3 py-3 text-zinc-500">{operation.targetState ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-500">
                      {new Date(operation.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-500">
                      {operation.finishedAt ? new Date(operation.finishedAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 text-sm text-zinc-500">No operations recorded yet.</p>
        )}
      </section>

      {canAdmin ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Security log
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">Audit events</h2>
            </div>
            <span className="text-xs text-zinc-500">Administrator only</span>
          </div>
          {auditLoading ? (
            <p className="mt-5 text-sm text-zinc-500">Loading audit history…</p>
          ) : null}
          {auditError ? <p className="mt-5 text-sm text-rose-300">{auditError}</p> : null}
          {!auditLoading && !auditError ? (
            <ul className="mt-4 divide-y divide-zinc-800">
              {(audit ?? []).slice(0, 30).map((event) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  key={event.id}
                >
                  <span className="font-medium text-zinc-300">{event.action}</span>
                  <span className="text-xs text-zinc-500">
                    {event.actorUserId ? "Administrator" : "System"}
                  </span>
                  <time className="text-xs text-zinc-500" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
              {!audit?.length ? (
                <li className="py-3 text-sm text-zinc-500">No audit events yet.</li>
              ) : null}
            </ul>
          ) : null}
        </section>
      ) : null}

      <details className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 sm:p-6">
        <summary className="cursor-pointer list-none text-sm font-medium text-zinc-300">
          <span className="mr-2 text-zinc-600">＋</span>
          Technical diagnostics
        </summary>
        <p className="mt-3 text-sm text-zinc-500">
          Raw health data is kept here for troubleshooting and support, rather than taking space on
          the operational dashboard.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-black/30 p-4 text-xs leading-5 text-zinc-400">
          {JSON.stringify({ controlPlane: health ?? null, server: server ?? null }, null, 2)}
        </pre>
      </details>
    </div>
  );
}
