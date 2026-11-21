"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export default function AddPanel({ onChanged }: { onChanged: () => void }) {
  const [gameId, setGameId] = useState("");
  const [nick, setNick] = useState("");
  const [older, setOlder] = useState("");
  const [level, setLevel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ created: boolean }>("/api/players", {
        method: "POST",
        body: JSON.stringify({ gameId, nick, olderNicks: older, level, note }),
      });
      setMsg({
        ok: true,
        text: res.created
          ? `Player ${gameId} added.`
          : `Player ${gameId} already existed – the nickname was added to their history and is now current.`,
      });
      setGameId("");
      setNick("");
      setOlder("");
      setLevel("");
      setNote("");
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none placeholder:text-slate-600 focus:border-indigo-400";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-lg font-semibold text-white">Add a player manually</h2>
      <p className="mt-1 text-sm text-slate-400">
        If the ID already exists, the nickname is appended to its history and becomes the current one.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-slate-300">Player ID *</label>
          <input
            required
            inputMode="numeric"
            value={gameId}
            onChange={(e) => setGameId(e.target.value.replace(/\D/g, ""))}
            placeholder="7646467"
            className={`${input} font-mono`}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Current nickname *</label>
          <input required value={nick} onChange={(e) => setNick(e.target.value)} placeholder="Bazhena" className={input} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm text-slate-300">Older nicknames (optional, one per line)</label>
          <textarea
            rows={3}
            value={older}
            onChange={(e) => setOlder(e.target.value)}
            placeholder={"Old nick 1\nOld nick 2"}
            className={input}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Level (optional)</label>
          <input
            inputMode="numeric"
            value={level}
            onChange={(e) => setLevel(e.target.value.replace(/\D/g, ""))}
            className={input}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Friend, cheater…" className={input} />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          disabled={busy}
          className="rounded-xl bg-indigo-500 px-6 py-2.5 font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save player"}
        </button>
        {msg && <p className={msg.ok ? "text-emerald-400" : "text-rose-400"}>{msg.text}</p>}
      </div>
    </form>
  );
}
