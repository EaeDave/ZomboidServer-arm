import type { AuthUser } from "@zomboid/contracts";
import { useEffect, useState, type ReactNode } from "react";

export type PanelPage = "overview" | "settings" | "mods" | "logs" | "activity";

const pages: Array<{ id: PanelPage; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Server status and quick actions" },
  { id: "settings", label: "Settings", description: "Player and gameplay configuration" },
  { id: "mods", label: "Mods", description: "Workshop content and load order" },
  { id: "logs", label: "Logs", description: "Live server output" },
  { id: "activity", label: "Activity", description: "Operations and audit history" },
];

function pageFromHash(hash: string): PanelPage {
  const candidate = hash.replace(/^#/, "") as PanelPage;
  return pages.some((page) => page.id === candidate) ? candidate : "overview";
}

export function usePanelPage() {
  const [page, setPage] = useState<PanelPage>(() => pageFromHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = (next: PanelPage) => {
    const hash = next === "overview" ? "" : `#${next}`;
    window.history.pushState({}, "", `${window.location.pathname}${hash}`);
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return { page, navigate };
}

export function PanelHeader({
  page,
  user,
  onLogout,
  onNavigate,
}: {
  page: PanelPage;
  user?: AuthUser;
  onLogout?: () => void;
  onNavigate: (page: PanelPage) => void;
}) {
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-800 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Project Zomboid
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">
            Production server
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Monitor the server and make safe, typed changes without opening a host shell.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <span className="hidden text-xs text-zinc-500 sm:inline">{user.email}</span>
          ) : null}
          {user && onLogout ? (
            <button
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              onClick={onLogout}
              type="button"
            >
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      <nav
        aria-label="Main navigation"
        className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50 p-1"
      >
        {pages.map((item) => (
          <button
            aria-current={page === item.id ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm transition ${
              page === item.id
                ? "bg-zinc-100 font-medium text-zinc-950"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={item.description}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export const panelPages = pages;
