import { parseList } from "@/lib/parse";
import { importEntries } from "@/lib/players";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { text?: string; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return Response.json({ error: "The list is empty" }, { status: 400 });

  const parsed = parseList(text);
  if (parsed.entries.length === 0) {
    return Response.json(
      { error: "No valid lines found. Expected: 1 \"Nick\" 7646467 1566560000 9999" },
      { status: 400 },
    );
  }

  const report = await importEntries(parsed.entries, "import", body.dryRun === true, {
    totalLines: parsed.totalLines,
    invalid: parsed.invalid.slice(0, 50),
  });
  return Response.json(report);
}
