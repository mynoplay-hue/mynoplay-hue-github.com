import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseList } from "@/lib/parse";
import { getStats, importEntries } from "@/lib/players";

export const dynamic = "force-dynamic";

// Loads the bundled starter list (the first 1000 players). Only works on an empty database.
export async function POST() {
  const stats = await getStats();
  if (stats.players > 0) {
    return Response.json({ error: "Database is not empty" }, { status: 400 });
  }
  const file = path.join(process.cwd(), "src", "data", "initial-players.txt");
  const text = await readFile(file, "utf8");
  const parsed = parseList(text);
  const report = await importEntries(parsed.entries, "seed", false, {
    totalLines: parsed.totalLines,
    invalid: parsed.invalid,
  });
  return Response.json(report);
}
