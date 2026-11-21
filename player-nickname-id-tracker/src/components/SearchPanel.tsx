"use client";

import { useEffect, useRef, useState } from "react";
import PlayerCard from "./PlayerCard";
import type { PlayerView, Stats } from "@/lib/players";

type Response = { total: number; results: PlayerView[]; mode: "search" | "recent"; stats: Stats };

export default function SearchPanel({
  refreshKey,
  onChanged,
  onStats,
}: {
  refreshKey: number;
  onChanged: () => void;
  onStats: (s: Stats) => void;
}) {
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/players?q=${encodeURIComponent(query)}&changed=${changedOnly ? 1 : 0}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) throw new Error("Search failed");
        const json: Response = await res.json();
        setData(json);
        setError("");
        onStatsRef.current(json.stats);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, changedOnly, refreshKey]);

  return (
    <div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <label htmlFor="q" className="mb-2 block text-sm font-medium text-slate-300">
          Search by player ID or part of a nickname
        </label>
        <div className="relative">
          <input
            id="q"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 7646467  or  Charl  (several IDs: 7646467, 2720541)"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 pr-10 text-lg text-white outline-none placeholder:text-slate-600 focus:border-indigo-400"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(e) => setChangedOnly(e.target.checked)}
              className="h-4 w-4 accent-indigo-500"
            />
            Only players who changed nickname
          </label>
          <span>
            {loading
              ? "Searching…"
              : data
                ? data.mode === "recent"
                  ? `Recently updated · showing ${data.results.length} of ${data.total}`
                  : `${data.total} match${data.total === 1 ? "" : "es"}${data.total > data.results.length ? ` (showing ${data.results.length})` : ""}`
                : ""}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Old nicknames are searched too, so you can find a player by a nickname they used before.
        </p>
      </div>

      {error && <p className="mt-4 text-rose-400">{error}</p>}

      <div className="mt-4 space-y-3">
        {data?.results.map((p) => (
          <PlayerCard key={p.gameId} player={p} query={query} onChanged={onChanged} />
        ))}
        {data && data.results.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
            Nothing found. If this player is new, add them on the “Add manually” tab.
          </div>
        )}
      </div>
    </div>
  );
}
