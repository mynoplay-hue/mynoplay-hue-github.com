"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client";
import type { ImportReport } from "@/lib/players";

export default function ImportPanel({ onChanged }: { onChanged: () => void }) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await api<ImportReport>("/api/import", {
        method: "POST",
        body: JSON.stringify({ text, dryRun }),
      });
      setReport(r);
      if (!dryRun) {
        onChanged();
        setText("");
      }
    } catch (e) {
      setError((e as Error).message);
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setText(await file.text());
    setReport(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const lineCount = text.split("\n").filter((l) => l.trim()).length;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-lg font-semibold text-white">Update from a new list</h2>
      <p className="mt-1 text-sm text-slate-400">
        Paste the new list (or upload a .txt file). Every ID is compared with the database: new IDs are added,
        and if a known ID now has a different nickname, the new nickname is appended and becomes current –
        old nicknames are kept.
      </p>
      <p className="mt-2 rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-slate-400">
        1 &quot;Bazhena&quot; 7646467 1566560000 9999
      </p>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setReport(null);
        }}
        rows={10}
        spellCheck={false}
        placeholder={'1 "Nick" 7646467 1566560000 9999\n2 "Another nick" 2720541 1556036845 7427\n…'}
        className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Upload .txt
        </button>
        <button
          disabled={busy || !text.trim()}
          onClick={() => run(true)}
          className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-40"
        >
          Scan (preview, no changes)
        </button>
        <button
          disabled={busy || !text.trim()}
          onClick={() => run(false)}
          className="rounded-xl bg-indigo-500 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
        >
          {busy ? "Working…" : "Import & update"}
        </button>
        {text.trim() && <span className="text-sm text-slate-500">{lineCount} lines</span>}
      </div>

      {error && <p className="mt-4 text-rose-400">{error}</p>}

      {report && (
        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950 p-4">
          <p className="font-medium text-white">
            {report.dryRun ? "Preview – nothing saved yet" : "Import finished ✔"}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <Stat label="Lines read" value={report.parsed} />
            <Stat label="New players" value={report.newPlayers} tone="emerald" />
            <Stat label="Nick changed" value={report.renamed.length} tone="amber" />
            <Stat label="Unchanged" value={report.unchanged} />
          </div>

          {report.renamed.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-amber-300">Nickname changes detected</p>
              <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-sm">
                {report.renamed.map((r) => (
                  <li key={r.gameId} className="rounded-lg bg-slate-900 px-3 py-1.5 text-slate-300">
                    <span className="font-mono text-indigo-300">{r.gameId}</span>{" "}
                    <span className="whitespace-pre-wrap text-slate-500 line-through">{r.oldNick}</span>
                    <span className="mx-1.5 text-slate-500">→</span>
                    <span className="whitespace-pre-wrap text-white">{r.newNick}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.newSample.length > 0 && (
            <details className="mt-4 text-sm text-slate-400">
              <summary className="cursor-pointer text-emerald-300">
                New players{report.newPlayers > report.newSample.length ? ` (first ${report.newSample.length})` : ""}
              </summary>
              <ul className="mt-2 space-y-1">
                {report.newSample.map((n) => (
                  <li key={n.gameId}>
                    <span className="font-mono text-indigo-300">{n.gameId}</span>{" "}
                    <span className="whitespace-pre-wrap">{n.nick}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report.invalid.length > 0 && (
            <details className="mt-4 text-sm text-slate-400">
              <summary className="cursor-pointer text-rose-300">{report.invalid.length} line(s) skipped</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {report.invalid.map((l) => (
                  <li key={l.line}>
                    #{l.line}: {l.text}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report.dryRun && (
            <button
              disabled={busy}
              onClick={() => run(false)}
              className="mt-4 rounded-xl bg-indigo-500 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
            >
              Looks right – import now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" }) {
  const color = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-white";
  return (
    <div className="rounded-lg bg-slate-900 px-2 py-3">
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
