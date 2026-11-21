import { addManual, getStats, searchPlayers } from "@/lib/players";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const changedOnly = url.searchParams.get("changed") === "1";
  const [data, stats] = await Promise.all([
    searchPlayers(q, { changedOnly, limit: 100 }),
    getStats(),
  ]);
  return Response.json({ ...data, stats });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idStr = String(body.gameId ?? "").trim();
  const nick = typeof body.nick === "string" ? body.nick : "";
  if (!/^\d{1,15}$/.test(idStr) || Number(idStr) <= 0) {
    return Response.json({ error: "ID must be a positive number" }, { status: 400 });
  }
  if (!nick.trim()) {
    return Response.json({ error: "Nickname is required" }, { status: 400 });
  }

  const olderNicks =
    typeof body.olderNicks === "string"
      ? body.olderNicks.split("\n").map((s) => s.replace(/\r/g, ""))
      : [];
  const note = typeof body.note === "string" ? body.note.trim() : null;
  const levelStr = String(body.level ?? "").trim();
  const level = /^\d{1,9}$/.test(levelStr) ? Number(levelStr) : null;

  const result = await addManual({ gameId: Number(idStr), nick, olderNicks, note, level });
  return Response.json({ ok: true, ...result });
}
