import {
  bigint,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// One row per in-game player ID. The ID never changes, the nickname does.
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  gameId: bigint("game_id", { mode: "number" }).notNull().unique(),
  currentNick: text("current_nick").notNull(),
  level: integer("level"),
  note: text("note"),
  source: text("source").notNull().default("import"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every nickname ever seen for a player. Old nicknames are never overwritten.
export const nickHistory = pgTable(
  "nick_history",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    nick: text("nick").notNull(),
    source: text("source").notNull().default("import"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("nick_history_player_nick_uq").on(t.playerId, t.nick),
    index("nick_history_nick_idx").on(t.nick),
  ],
);
