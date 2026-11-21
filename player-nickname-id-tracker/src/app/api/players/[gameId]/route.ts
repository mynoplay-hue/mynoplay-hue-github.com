import { addManual, deletePlayer, removeNick, setCurrentNick, setNote } from "@/lib/players";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ gameId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { gameId: raw } = await ctx.params;
  const gameId = Number(raw);
  if (!Number.isSafeInteger(gameId) || gameId <= 0) {
    return Response.json({ error: "Bad ID" }, { status: 400 });
  }

  let body: { action?: string; nick?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nick = typeof body.nick === "string" ? body.nick : "";
  let error: string | null = null;

  switch (body.action) {
    case "addNick":
      if (!nick.trim()) return Response.json({ error: "Nickname is required" }, { status: 400 });
      await addManual({ gameId, nick });
      break;
    case "setCurrent":
      error = await setCurrentNick(gameId, nick);
      break;
    case "removeNick":
      error = await removeNick(gameId, nick);
      break;
    case "note":
      await setNote(gameId, body.note ?? "");
      break;
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  if (error) return Response.json({ error }, { status: 400 });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { gameId: raw } = await ctx.params;
  const gameId = Number(raw);
  if (!Number.isSafeInteger(gameId) || gameId <= 0) {
    return Response.json({ error: "Bad ID" }, { status: 400 });
  }
  await deletePlayer(gameId);
  return Response.json({ ok: true });
}
