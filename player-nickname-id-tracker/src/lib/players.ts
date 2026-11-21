import { db } from "@/db";
import { nickHistory, players } from "@/db/schema";
import { and, eq, inArray, or, sql, ilike, type SQL } from "drizzle-orm";
import type { ParsedEntry } from "./parse";

export type NickRecord = { nick: string; source: string; seenAt: string };

export type PlayerView = {
  gameId: number;
  currentNick: string;
  level: number | null;
  note: string | null;
  source: string;
  updatedAt: string;
  nicks: NickRecord[];
};

export type Stats = { players: number; nicknames: number; changed: number };

export type ImportReport = {
  dryRun: boolean;
  totalLines: number;
  parsed: number;
  invalid: { line: number; text: string }[];
  newPlayers: number;
  unchanged: number;
  renamed: { gameId: number; oldNick: string; newNick: string }[];
  newSample: { gameId: number; nick: string }[];
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function getStats(): Promise<Stats> {
  const res = await db.execute(sql`
    select
      (select count(*) from players)::int as players,
      (select count(*) from nick_history)::int as nicknames,
      (select count(*) from (
         select player_id from nick_history group by player_id having count(*) > 1
       ) c)::int as changed
  `);
  const row = res.rows[0] as { players: number; nicknames: number; changed: number };
  return { players: row.players, nicknames: row.nicknames, changed: row.changed };
}

export async function searchPlayers(
  q: string,
  opts: { changedOnly: boolean; limit: number },
): Promise<{ total: number; results: PlayerView[]; mode: "search" | "recent" }> {
  const query = q.trim();
  const conds: SQL[] = [];

  if (query) {
    if (/^\d+(?:[\s,;]+\d+)+$/.test(query)) {
      // Several IDs pasted at once -> exact lookup of each
      const ids = query
        .split(/[\s,;]+/)
        .map(Number)
        .filter((n) => Number.isSafeInteger(n));
      conds.push(inArray(players.gameId, ids));
    } else {
      const like = `%${escapeLike(query)}%`;
      const parts: SQL[] = [
        ilike(players.currentNick, like),
        sql`exists (select 1 from nick_history h where h.player_id = players.id and h.nick ilike ${like})`,
      ];
      if (/^\d+$/.test(query)) parts.push(sql`players.game_id::text like ${query + "%"}`);
      conds.push(or(...parts)!);
    }
  }

  if (opts.changedOnly) {
    conds.push(sql`(select count(*) from nick_history h2 where h2.player_id = players.id) > 1`);
  }

  const where = conds.length ? and(...conds) : undefined;

  const orderBy = query
    ? [
        sql`(players.game_id::text = ${query}) desc`,
        sql`(lower(players.current_nick) = lower(${query})) desc`,
        sql`players.current_nick asc`,
      ]
    : [sql`players.updated_at desc`, sql`players.id desc`];

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(players)
    .where(where);

  const rows = await db
    .select()
    .from(players)
    .where(where)
    .orderBy(...orderBy)
    .limit(opts.limit);

  const hist = rows.length
    ? await db
        .select()
        .from(nickHistory)
        .where(
          inArray(
            nickHistory.playerId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(nickHistory.id)
    : [];

  const byPlayer = new Map<number, NickRecord[]>();
  for (const h of hist) {
    const list = byPlayer.get(h.playerId) ?? [];
    list.push({ nick: h.nick, source: h.source, seenAt: h.seenAt.toISOString() });
    byPlayer.set(h.playerId, list);
  }

  return {
    total: countRow?.n ?? 0,
    mode: query ? "search" : "recent",
    results: rows.map((r) => ({
      gameId: r.gameId,
      currentNick: r.currentNick,
      level: r.level,
      note: r.note,
      source: r.source,
      updatedAt: r.updatedAt.toISOString(),
      nicks: byPlayer.get(r.id) ?? [],
    })),
  };
}

/**
 * Bulk import / update. For each ID in the list:
 *  - unknown ID  -> new player is created
 *  - known ID with a different nickname -> new nickname is appended to history
 *    and becomes the current one (old nicknames stay)
 *  - same nickname -> nothing happens
 */
export async function importEntries(
  entries: ParsedEntry[],
  source: "import" | "seed",
  dryRun: boolean,
  meta: { totalLines: number; invalid: { line: number; text: string }[] },
): Promise<ImportReport> {
  const grouped = new Map<number, { nicks: string[]; level: number | null }>();
  for (const e of entries) {
    const g = grouped.get(e.gameId) ?? { nicks: [], level: null };
    const i = g.nicks.indexOf(e.nick);
    if (i >= 0) g.nicks.splice(i, 1);
    g.nicks.push(e.nick);
    if (e.level !== null) g.level = e.level;
    grouped.set(e.gameId, g);
  }

  const report: ImportReport = {
    dryRun,
    totalLines: meta.totalLines,
    parsed: entries.length,
    invalid: meta.invalid,
    newPlayers: 0,
    unchanged: 0,
    renamed: [],
    newSample: [],
  };

  const ids = [...grouped.keys()];

  await db.transaction(async (tx) => {
    const existing = new Map<number, typeof players.$inferSelect>();
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const rows = await tx.select().from(players).where(inArray(players.gameId, chunk));
      rows.forEach((r) => existing.set(r.gameId, r));
    }

    const known = new Map<number, Set<string>>();
    const existingPlayerIds = [...existing.values()].map((p) => p.id);
    for (let i = 0; i < existingPlayerIds.length; i += 1000) {
      const rows = await tx
        .select()
        .from(nickHistory)
        .where(inArray(nickHistory.playerId, existingPlayerIds.slice(i, i + 1000)));
      rows.forEach((r) => {
        const s = known.get(r.playerId) ?? new Set<string>();
        s.add(r.nick);
        known.set(r.playerId, s);
      });
    }

    const toCreate: { gameId: number; nicks: string[]; level: number | null }[] = [];
    const histInserts: { playerId: number; nick: string; source: string }[] = [];
    const updates: { id: number; nick: string; level: number | null }[] = [];

    for (const [gameId, g] of grouped) {
      const latest = g.nicks[g.nicks.length - 1];
      const player = existing.get(gameId);

      if (!player) {
        report.newPlayers += 1;
        if (report.newSample.length < 20) report.newSample.push({ gameId, nick: latest });
        toCreate.push({ gameId, nicks: g.nicks, level: g.level });
        continue;
      }

      const seen = known.get(player.id) ?? new Set<string>();
      const missing = g.nicks.filter((n) => !seen.has(n));
      missing.forEach((n) => histInserts.push({ playerId: player.id, nick: n, source }));

      if (latest !== player.currentNick) {
        report.renamed.push({ gameId, oldNick: player.currentNick, newNick: latest });
        updates.push({ id: player.id, nick: latest, level: g.level });
      } else {
        report.unchanged += 1;
        if (g.level !== null && g.level !== player.level) {
          updates.push({ id: player.id, nick: latest, level: g.level });
        }
      }
    }

    if (dryRun) return;

    for (let i = 0; i < toCreate.length; i += 500) {
      const chunk = toCreate.slice(i, i + 500);
      const created = await tx
        .insert(players)
        .values(
          chunk.map((c) => ({
            gameId: c.gameId,
            currentNick: c.nicks[c.nicks.length - 1],
            level: c.level,
            source,
          })),
        )
        .returning({ id: players.id, gameId: players.gameId });
      const idByGame = new Map(created.map((c) => [c.gameId, c.id]));
      chunk.forEach((c) => {
        const pid = idByGame.get(c.gameId)!;
        c.nicks.forEach((nick) => histInserts.push({ playerId: pid, nick, source }));
      });
    }

    for (let i = 0; i < histInserts.length; i += 1000) {
      await tx
        .insert(nickHistory)
        .values(histInserts.slice(i, i + 1000))
        .onConflictDoNothing();
    }

    for (const u of updates) {
      await tx
        .update(players)
        .set({
          currentNick: u.nick,
          ...(u.level !== null ? { level: u.level } : {}),
          updatedAt: new Date(),
        })
        .where(eq(players.id, u.id));
    }
  });

  return report;
}

export async function addManual(input: {
  gameId: number;
  nick: string;
  olderNicks?: string[];
  note?: string | null;
  level?: number | null;
}): Promise<{ created: boolean }> {
  const older = (input.olderNicks ?? []).filter((n) => n.trim() !== "" && n !== input.nick);

  return db.transaction(async (tx) => {
    const [found] = await tx.select().from(players).where(eq(players.gameId, input.gameId));
    let playerId: number;
    let created = false;

    if (!found) {
      const [row] = await tx
        .insert(players)
        .values({
          gameId: input.gameId,
          currentNick: input.nick,
          level: input.level ?? null,
          note: input.note || null,
          source: "manual",
        })
        .returning({ id: players.id });
      playerId = row.id;
      created = true;
    } else {
      playerId = found.id;
      await tx
        .update(players)
        .set({
          currentNick: input.nick,
          ...(input.level != null ? { level: input.level } : {}),
          ...(input.note ? { note: input.note } : {}),
          updatedAt: new Date(),
        })
        .where(eq(players.id, playerId));
    }

    const rows = [...older, input.nick].map((nick) => ({ playerId, nick, source: "manual" }));
    await tx.insert(nickHistory).values(rows).onConflictDoNothing();
    return { created };
  });
}

export async function setCurrentNick(gameId: number, nick: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(players).where(eq(players.gameId, gameId));
    if (!p) return "Player not found";
    const [h] = await tx
      .select()
      .from(nickHistory)
      .where(and(eq(nickHistory.playerId, p.id), eq(nickHistory.nick, nick)));
    if (!h) return "Nickname is not in this player's history";
    await tx
      .update(players)
      .set({ currentNick: nick, updatedAt: new Date() })
      .where(eq(players.id, p.id));
    return null;
  });
}

export async function removeNick(gameId: number, nick: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(players).where(eq(players.gameId, gameId));
    if (!p) return "Player not found";
    const all = await tx
      .select()
      .from(nickHistory)
      .where(eq(nickHistory.playerId, p.id))
      .orderBy(nickHistory.id);
    if (all.length <= 1) return "A player must keep at least one nickname. Delete the player instead.";
    const rest = all.filter((h) => h.nick !== nick);
    if (rest.length === all.length) return "Nickname not found";
    await tx
      .delete(nickHistory)
      .where(and(eq(nickHistory.playerId, p.id), eq(nickHistory.nick, nick)));
    if (p.currentNick === nick) {
      await tx
        .update(players)
        .set({ currentNick: rest[rest.length - 1].nick, updatedAt: new Date() })
        .where(eq(players.id, p.id));
    }
    return null;
  });
}

export async function setNote(gameId: number, note: string) {
  await db
    .update(players)
    .set({ note: note.trim() || null, updatedAt: new Date() })
    .where(eq(players.gameId, gameId));
}

export async function deletePlayer(gameId: number) {
  await db.delete(players).where(eq(players.gameId, gameId));
}
