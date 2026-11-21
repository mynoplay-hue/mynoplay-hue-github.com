"use client";

import { useState } from "react";
import SearchPanel from "./SearchPanel";
import AddPanel from "./AddPanel";
import ImportPanel from "./ImportPanel";
import { api } from "@/lib/client";
import type { Stats } from "@/lib/players";

type Tab = "search" | "add" | "import";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "add", label: "Add manually" },
  { id: "import", label: "Update from list" },
];

export default function Dashboard({ initialStats }: { initialStats: Stats }) {
  const [tab, setTab] = useState<Tab>("search");
  const [stats, setStats] = useState<Stats>(initialStats);
  const [refreshKey, setRefreshKey] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState("");

  const bump = () => setRefreshKey((k) => k + 1);

  async function seed() {
    setSeeding(true);
    setSeedError("");
    try {
      await api("/api/seed", { method: "POST" });
      bump();
    } catch (e) {
      setSeedError((e as Error).message);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-indigo-300">Player directory</p>
        <h1 className="mt-1 text-3xl font-bold text-white sm:text-4xl">Who changed their nickname?</h1>
        <p className="mt-2 text-slate-400">
          Look up a player&apos;s current nickname by game ID – or find an ID by any part of a nickname,
          past or present.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-3 gap-3 text-center">
        <Box label="Players" value={stats.players} />
        <Box label="Nicknames stored" value={stats.nicknames} />
        <Box label="Changed nick" value={stats.changed} />
      </div>

      {stats.players === 0 && (
        <div className="mb-6 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5">
          <p className="font-medium text-white">The database is empty</p>
          <p className="mt-1 text-sm text-slate-300">
            Load the starter list of 1000 players, or paste your own on the “Update from list” tab.
          </p>
          <button
            onClick={seed}
            disabled={seeding}
            className="mt-3 rounded-xl bg-indigo-500 px-5 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {seeding ? "Loading…" : "Load starter list (1000 players)"}
          </button>
          {seedError && <p className="mt-2 text-rose-400">{seedError}</p>}
        </div>
      )}

      <nav className="mb-5 flex gap-1 rounded-xl bg-slate-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.id ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className={tab === "search" ? "" : "hidden"}>
        <SearchPanel refreshKey={refreshKey} onChanged={bump} onStats={setStats} />
      </div>
      {tab === "add" && <AddPanel onChanged={bump} />}
      {tab === "import" && <ImportPanel onChanged={bump} />}
    </div>
  );
}

function Box({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
      <p className="text-2xl font-semibold text-white">{value.toLocaleString("en-US")}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
