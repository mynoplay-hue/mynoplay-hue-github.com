/* ============================================================
   PlayerDB — локальное хранилище (localStorage) + разбор списков.
   Работает без сети: сайт полностью функционален офлайн,
   а синхронизация с Google Sheets (assets/sync.js) — надстройка.
   ============================================================ */
(function (global) {
  "use strict";

  const DB_KEY = "player_directory_db";
  const DB_VERSION = 2;

  const QUOTE = `["\u201C\u201D\u201E]`;
  const quotedRe = new RegExp(`^\\s*(?:\\d+\\s+)?${QUOTE}(.*)${QUOTE}\\s+((?:\\d+\\s*)+)$`);
  const unquotedRe = /^\s*\d+\s+(.+?)\s+(\d+)\s+\d+\s+(\d+)\s*$/;

  function nowISO() {
    return new Date().toISOString();
  }

  function emptyDB() {
    return { version: DB_VERSION, players: {}, settings: {} };
  }

  /* ---------- нормализация / миграция ---------- */

  function normalizeNick(n) {
    return {
      nick: String(n.nick),
      source: n.source || "import",
      seenAt: n.seenAt || nowISO(),
      removed: !!n.removed,
      removedAt: n.removedAt || null,
    };
  }

  // Приводит любые сохранённые данные (v1 и v2) к актуальной схеме.
  function normalizeDB(raw) {
    const db = emptyDB();
    if (!raw || typeof raw !== "object") return db;
    if (raw.settings && typeof raw.settings === "object") db.settings = raw.settings;

    const src = raw.players && typeof raw.players === "object" ? raw.players : {};
    for (const key of Object.keys(src)) {
      const p = src[key] || {};
      const gameId = Number(p.gameId != null ? p.gameId : key);
      if (!Number.isSafeInteger(gameId) || gameId <= 0) continue;

      const nicks = (Array.isArray(p.nicks) ? p.nicks : [])
        .filter((n) => n && typeof n.nick === "string" && n.nick !== "")
        .map(normalizeNick);

      let currentNick = typeof p.currentNick === "string" ? p.currentNick : "";
      if (!currentNick && nicks.length) currentNick = nicks[nicks.length - 1].nick;

      db.players[String(gameId)] = {
        gameId,
        currentNick,
        level: p.level != null && p.level !== "" ? Number(p.level) : null,
        note: p.note != null && p.note !== "" ? String(p.note) : null,
        source: p.source || "import",
        createdAt: p.createdAt || nowISO(),
        updatedAt: p.updatedAt || p.createdAt || nowISO(),
        deleted: !!p.deleted,
        nicks,
      };
    }
    return db;
  }

  /* ---------- чтение / запись ---------- */

  function load(storage) {
    try {
      const raw = storage.getItem(DB_KEY);
      if (raw) return normalizeDB(JSON.parse(raw));
    } catch (e) {
      console.error("Не удалось прочитать локальные данные", e);
    }
    return emptyDB();
  }

  function save(storage, db) {
    try {
      storage.setItem(DB_KEY, JSON.stringify(db));
      return null;
    } catch (e) {
      const msg =
        e && (e.name === "QuotaExceededError" || e.code === 22)
          ? "Локальное хранилище переполнено — выгрузите резервную копию."
          : "Не удалось сохранить данные: " + (e && e.message ? e.message : e);
      console.error(msg, e);
      return msg;
    }
  }

  /* ---------- выборки ---------- */

  function allPlayers(db) {
    return Object.values(db.players).filter((p) => !p.deleted);
  }

  function visibleNicks(p) {
    return p.nicks.filter((n) => !n.removed);
  }

  function getStats(db) {
    let players = 0;
    let nicknames = 0;
    let changed = 0;
    for (const p of allPlayers(db)) {
      players++;
      const vis = visibleNicks(p);
      nicknames += vis.length;
      if (vis.length > 1) changed++;
    }
    return { players, nicknames, changed };
  }

  /* ---------- разбор списка ---------- */

  // Поддерживаемые форматы строки (все дают ник + id + необязательный уровень):
  //   1 "Nick" 7646467 1566560000 9999   (ранг, ник, id, очки, уровень)
  //   "Nick" 7646467 9999                 (ник, id, уровень)
  //   "Nick" 7646467                      (ник, id)
  //   1 Nick 7646467 1566560000 9999      (без кавычек)
  function parseList(text) {
    const lines = String(text).replace(/\r/g, "").split("\n");
    const entries = [];
    const invalid = [];
    let totalLines = 0;

    lines.forEach((raw, index) => {
      if (!raw.trim()) return;
      totalLines++;

      let nick = null;
      let gameId = null;
      let level = null;

      const q = raw.match(quotedRe);
      if (q) {
        const nums = q[2].trim().split(/\s+/);
        nick = q[1];
        gameId = Number(nums[0]);
        level = nums.length >= 2 ? Number(nums[nums.length - 1]) : null;
      } else {
        const u = raw.match(unquotedRe);
        if (u) {
          nick = u[1];
          gameId = Number(u[2]);
          level = Number(u[3]);
        }
      }

      if (
        nick === null ||
        nick.trim() === "" ||
        gameId === null ||
        !Number.isSafeInteger(gameId) ||
        gameId <= 0
      ) {
        invalid.push({ line: index + 1, text: raw.slice(0, 120) });
        return;
      }

      if (level !== null && (!Number.isSafeInteger(level) || level > 2147483647)) level = null;
      entries.push({ nick, gameId, level });
    });

    return { entries, invalid, totalLines };
  }

  /* ---------- импорт: расчёт изменений (dry-run) и применение ---------- */

  // Группирует строки по игроку: порядок ников сохраняется, последний ник — текущий.
  function groupEntries(entries) {
    const grouped = new Map();
    const seenPairs = new Set();
    let duplicateLines = 0;

    for (const e of entries) {
      const g = grouped.get(e.gameId) || { gameId: e.gameId, nicks: [], level: null };
      const pairKey = e.gameId + "\u0000" + e.nick;
      if (seenPairs.has(pairKey)) {
        duplicateLines++;
      } else {
        seenPairs.add(pairKey);
        if (g.nicks.includes(e.nick)) {
          // тот же ник ещё раз — считаем повтором, но порядок не ломаем
          duplicateLines++;
        } else {
          g.nicks.push(e.nick);
        }
      }
      if (e.level !== null) g.level = e.level;
      grouped.set(e.gameId, g);
    }

    return { grouped, duplicateLines };
  }

  /**
   * Считает, что изменится при импорте. Ничего не пишет в базу.
   * Возвращает { report, actions } — actions применяет applyImport().
   */
  function planImport(db, entries, source, opts) {
    const dryRun = !!(opts && opts.dryRun);
    const { grouped, duplicateLines } = groupEntries(entries);
    const now = nowISO();

    const report = {
      dryRun,
      totalLines: (opts && opts.totalLines) || entries.length,
      invalid: (opts && opts.invalid) || [],
      parsed: entries.length,
      uniqueIds: grouped.size,
      duplicateLines,
      newPlayers: 0,
      unchanged: 0,
      renamed: [],
      levelUpdated: 0,
      nicksAdded: 0,
      newSample: [],
    };

    const actions = [];

    for (const [gameId, g] of grouped) {
      const latest = g.nicks[g.nicks.length - 1];
      if (!latest) continue;
      const player = db.players[String(gameId)];

      if (!player || player.deleted) {
        report.newPlayers++;
        if (report.newSample.length < 20) report.newSample.push({ gameId, nick: latest });
        report.nicksAdded += g.nicks.length;
        actions.push({
          type: player ? "revive" : "create",
          gameId,
          nicks: g.nicks,
          level: g.level,
          currentNick: latest,
        });
        continue;
      }

      const known = new Map(player.nicks.map((n) => [n.nick, n]));
      const missing = g.nicks.filter((n) => !known.has(n));
      const restored = [];
      for (const n of g.nicks) {
        const existing = known.get(n);
        if (existing && existing.removed) restored.push(n);
      }

      if (missing.length || restored.length) {
        report.nicksAdded += missing.length + restored.length;
      }

      if (latest !== player.currentNick) {
        report.renamed.push({
          gameId,
          oldNick: player.currentNick,
          newNick: latest,
          nicksAdded: missing.length + restored.length,
        });
        actions.push({
          type: "update",
          gameId,
          currentNick: latest,
          addNicks: missing,
          restoreNicks: restored,
          level: g.level,
        });
      } else {
        report.unchanged++;
        const levelChanged = g.level !== null && g.level !== player.level;
        if (levelChanged) report.levelUpdated++;
        if (levelChanged || missing.length || restored.length) {
          actions.push({
            type: "update",
            gameId,
            currentNick: player.currentNick,
            addNicks: missing,
            restoreNicks: restored,
            level: g.level,
          });
        }
      }
    }

    // Самопроверка отчёта: новые + изменённые + без изменений должны покрывать все ID.
    report.balanceOk = report.newPlayers + report.renamed.length + report.unchanged === report.uniqueIds;

    return { report, actions };
  }

  function applyImport(db, actions, source) {
    const now = nowISO();
    let touched = 0;

    for (const a of actions) {
      const key = String(a.gameId);
      let player = db.players[key];

      if (!player) {
        player = {
          gameId: a.gameId,
          currentNick: a.currentNick,
          level: a.level,
          note: null,
          source: source,
          createdAt: now,
          updatedAt: now,
          deleted: false,
          nicks: [],
        };
        db.players[key] = player;
      }

      player.deleted = false;
      player.currentNick = a.currentNick;
      if (a.level !== null && a.level !== undefined) player.level = a.level;
      else if (player.level === null) player.level = null;
      player.updatedAt = now;
      touched++;

      const byNick = new Map(player.nicks.map((n) => [n.nick, n]));
      // Новый игрок: сразу добавляем все ники из списка (включая текущий).
      for (const nick of a.nicks || []) {
        if (!byNick.has(nick)) {
          const entry = { nick, source, seenAt: now, removed: false, removedAt: null };
          player.nicks.push(entry);
          byNick.set(nick, entry);
        }
      }
      for (const nick of a.addNicks || []) {
        if (!byNick.has(nick)) {
          const entry = { nick, source, seenAt: now, removed: false, removedAt: null };
          player.nicks.push(entry);
          byNick.set(nick, entry);
        }
      }
      for (const nick of a.restoreNicks || []) {
        const entry = byNick.get(nick);
        if (entry) {
          entry.removed = false;
          entry.removedAt = null;
          entry.seenAt = now;
          entry.source = source;
        }
      }
    }

    return touched;
  }

  /* ---------- ручные операции ---------- */

  function findPlayer(db, gameId) {
    return db.players[String(gameId)] || null;
  }

  function addNick(db, gameId, nick, source) {
    const p = findPlayer(db, gameId);
    if (!p) return "Игрок не найден";
    const clean = String(nick).trim();
    if (!clean) return "Ник пустой";
    const now = nowISO();
    const existing = p.nicks.find((n) => n.nick === clean);
    if (existing) {
      existing.removed = false;
      existing.removedAt = null;
      existing.seenAt = now;
    } else {
      p.nicks.push({ nick: clean, source: source || "manual", seenAt: now, removed: false, removedAt: null });
    }
    p.currentNick = clean;
    p.updatedAt = now;
    return null;
  }

  function setCurrent(db, gameId, nick) {
    const p = findPlayer(db, gameId);
    if (!p) return "Игрок не найден";
    const entry = p.nicks.find((n) => n.nick === nick && !n.removed);
    if (!entry) return "Этого ника нет в истории игрока";
    p.currentNick = nick;
    p.updatedAt = nowISO();
    return null;
  }

  function removeNick(db, gameId, nick) {
    const p = findPlayer(db, gameId);
    if (!p) return "Игрок не найден";
    const vis = visibleNicks(p);
    if (vis.length <= 1) return "У игрока должен остаться хотя бы один ник. Удалите игрока целиком.";
    const entry = p.nicks.find((n) => n.nick === nick && !n.removed);
    if (!entry) return "Ник не найден";

    const now = nowISO();
    entry.removed = true;
    entry.removedAt = now;
    if (p.currentNick === nick) {
      const rest = visibleNicks(p);
      p.currentNick = rest[rest.length - 1].nick;
    }
    p.updatedAt = now;
    return null;
  }

  function setNote(db, gameId, note) {
    const p = findPlayer(db, gameId);
    if (!p) return "Игрок не найден";
    p.note = String(note || "").trim() || null;
    p.updatedAt = nowISO();
    return null;
  }

  // Удаление — «мягкое» (tombstone), чтобы удаление доехало до других устройств.
  function deletePlayer(db, gameId) {
    const p = findPlayer(db, gameId);
    if (!p) return "Игрок не найден";
    p.deleted = true;
    p.updatedAt = nowISO();
    return null;
  }

  // Ручное добавление игрока/ника из формы.
  function addManual(db, input) {
    const gameId = Number(input.gameId);
    const nick = String(input.nick || "").trim();
    const older = (input.olderNicks || []).map((s) => s.trim()).filter(Boolean);
    const now = nowISO();
    const key = String(gameId);
    let player = db.players[key];
    const created = !player || player.deleted;

    if (!player) {
      player = {
        gameId,
        currentNick: nick,
        level: input.level != null ? input.level : null,
        note: input.note || null,
        source: "manual",
        createdAt: now,
        updatedAt: now,
        deleted: false,
        nicks: [],
      };
      db.players[key] = player;
    } else {
      player.deleted = false;
      player.source = player.source || "manual";
      player.updatedAt = now;
      if (input.level != null) player.level = input.level;
      if (input.note) player.note = input.note;
      player.currentNick = nick;
    }

    const push = (n) => {
      const found = player.nicks.find((x) => x.nick === n);
      if (found) {
        found.removed = false;
        found.removedAt = null;
        found.seenAt = now;
        found.source = "manual";
      } else {
        player.nicks.push({ nick: n, source: "manual", seenAt: now, removed: false, removedAt: null });
      }
    };
    older.forEach(push);
    push(nick);

    return { created, player };
  }

  /* ---------- поиск ---------- */

  function searchPlayers(db, query, opts) {
    const q = String(query || "").trim();
    const changedOnly = !!(opts && opts.changedOnly);
    const limit = (opts && opts.limit) || 100;
    let results;

    if (!q) {
      results = allPlayers(db).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    } else if (/^\d+(?:[\s,;]+\d+)+$/.test(q)) {
      const ids = q.split(/[\s,;]+/).map(Number).filter((n) => Number.isSafeInteger(n));
      const set = new Set(ids.map(String));
      results = allPlayers(db).filter((p) => set.has(String(p.gameId)));
      results.sort((a, b) => ids.indexOf(a.gameId) - ids.indexOf(b.gameId));
    } else {
      const qLower = q.toLowerCase();
      results = allPlayers(db).filter((p) => {
        if (p.currentNick.toLowerCase().includes(qLower)) return true;
        if (visibleNicks(p).some((n) => n.nick.toLowerCase().includes(qLower))) return true;
        if (/^\d+$/.test(q) && String(p.gameId).startsWith(q)) return true;
        return false;
      });
      results.sort((a, b) => {
        const aExactId = String(a.gameId) === q ? 0 : 1;
        const bExactId = String(b.gameId) === q ? 0 : 1;
        if (aExactId !== bExactId) return aExactId - bExactId;
        const aExactNick = a.currentNick.toLowerCase() === qLower ? 0 : 1;
        const bExactNick = b.currentNick.toLowerCase() === qLower ? 0 : 1;
        if (aExactNick !== bExactNick) return aExactNick - bExactNick;
        return a.currentNick.localeCompare(b.currentNick);
      });
    }

    if (changedOnly) results = results.filter((p) => visibleNicks(p).length > 1);

    return { total: results.length, results: results.slice(0, limit) };
  }

  global.PlayerDB = {
    DB_KEY,
    DB_VERSION,
    emptyDB,
    normalizeDB,
    load,
    save,
    allPlayers,
    visibleNicks,
    getStats,
    parseList,
    groupEntries,
    planImport,
    applyImport,
    addManual,
    addNick,
    setCurrent,
    removeNick,
    setNote,
    deletePlayer,
    findPlayer,
    searchPlayers,
    nowISO,
  };
})(window);
