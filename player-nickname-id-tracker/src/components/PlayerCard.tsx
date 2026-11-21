"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { PlayerView } from "@/lib/players";

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-300/90 px-0.5 text-slate-900">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function PlayerCard({
  player,
  query,
  onChanged,
}: {
  player: PlayerView;
  query: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newNick, setNewNick] = useState("");
  const [note, setNote] = useState(player.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const previous = player.nicks.filter((n) => n.nick !== player.currentNick);

  async function run(body: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/players/${player.gameId}`, { method: "PATCH", body: JSON.stringify(body) });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete player ${player.gameId} (${player.currentNick}) and all nicknames?`)) return;
    setBusy(true);
    try {
      await api(`/api/players/${player.gameId}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(player.gameId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-slate-500">Current nickname</p>
          <h3 className="mt-0.5 break-all text-xl font-semibold text-white whitespace-pre-wrap">
            <Highlight text={player.currentNick} query={query} />
          </h3>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-slate-500">Player ID</p>
          <button
            onClick={copy}
            title="Copy ID"
            className="mt-0.5 rounded-lg bg-indigo-500/15 px-2.5 py-1 font-mono text-lg font-semibold text-indigo-300 transition hover:bg-indigo-500/25"
          >
            {player.gameId}
            <span className="ml-2 text-xs font-normal text-indigo-200/70">{copied ? "copied" : "copy"}</span>
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {player.level !== null && (
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">Level {player.level}</span>
        )}
        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">
          {player.nicks.length} nickname{player.nicks.length === 1 ? "" : "s"}
        </span>
        {player.source === "manual" && (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">added manually</span>
        )}
        {previous.length > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-300">nickname changed</span>
        )}
      </div>

      {previous.length > 0 && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Previous nicknames</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {previous.map((n) => (
              <span
                key={n.nick}
                className="whitespace-pre-wrap break-all rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1 text-sm text-slate-300"
              >
                <Highlight text={n.nick} query={query} />
              </span>
            ))}
          </div>
        </div>
      )}

      {player.note && !open && <p className="mt-3 text-sm italic text-slate-400">“{player.note}”</p>}

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-sm text-slate-400 underline-offset-4 hover:text-white hover:underline"
      >
        {open ? "Hide details" : "Manage / history"}
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-t border-slate-800 pt-4">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Nickname history (oldest first)</p>
            <ul className="space-y-1.5">
              {player.nicks.map((n) => {
                const current = n.nick === player.currentNick;
                return (
                  <li
                    key={n.nick}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-800/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="whitespace-pre-wrap break-all text-sm text-slate-100">{n.nick}</span>
                      {current && (
                        <span className="ml-2 rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs text-indigo-300">
                          current
                        </span>
                      )}
                      <span className="ml-2 text-xs text-slate-500">
                        {n.source === "manual" ? "manual" : "list"} · {new Date(n.seenAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      {!current && (
                        <button
                          disabled={busy}
                          onClick={() => run({ action: "setCurrent", nick: n.nick })}
                          className="text-indigo-300 hover:underline disabled:opacity-50"
                        >
                          make current
                        </button>
                      )}
                      {player.nicks.length > 1 && (
                        <button
                          disabled={busy}
                          onClick={() => run({ action: "removeNick", nick: n.nick })}
                          className="text-rose-400 hover:underline disabled:opacity-50"
                        >
                          remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newNick.trim()) return;
              run({ action: "addNick", nick: newNick }).then(() => setNewNick(""));
            }}
          >
            <input
              value={newNick}
              onChange={(e) => setNewNick(e.target.value)}
              placeholder="New nickname (becomes current)"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
            />
            <button
              disabled={busy}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              Add nickname
            </button>
          </form>

          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run({ action: "note", note });
            }}
          >
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note about this player (optional)"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
            />
            <button
              disabled={busy}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
            >
              Save note
            </button>
          </form>

          <div className="flex items-center justify-between">
            <p className="text-sm text-rose-400">{error}</p>
            <button
              disabled={busy}
              onClick={remove}
              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            >
              Delete player
            </button>
          </div>
        </div>
      )}
      {!open && error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </article>
  );
}
