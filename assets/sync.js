/* ============================================================
   PlayerSync — двусторонняя синхронизация с Google Sheets.

   Сайт статический (GitHub Pages), поэтому браузер обращается
   к таблице через сторонний REST-сервис (SheetDB / Sheetson).
   Данные всегда живут локально (localStorage): без сети сайт
   работает, а изменения уходят в таблицу при следующей связи.

   Модель хранения в таблице — append-only (только добавление строк):
     players       — состояние игрока на момент изменения
     nick_history  — каждая запись об нике (включая удалённые)
   При чтении строки сводятся по принципу «побеждает самый свежий
   updated_at», поэтому конфликты между устройствами разрешаются
   без потери истории.
   ============================================================ */
(function (global) {
  "use strict";

  const PlayerDB = global.PlayerDB;
  const CONFIG_KEY = "player_directory_sync";
  const SHEET_PLAYERS = "players";
  const SHEET_HISTORY = "nick_history";
  const CHUNK = 100;
  const REQUEST_TIMEOUT = 25000;

  /* ---------- конфигурация ---------- */

  const DEFAULT_CONFIG = {
    enabled: false,
    provider: "sheetdb",
    apiId: "",        // SheetDB: API ID
    apiKey: "",       // Sheetson: API key
    spreadsheetId: "", // Sheetson: ID таблицы
    autoPullMinutes: 10,
    lastPullAt: null,
    lastPushAt: null,
  };

  function loadConfig(storage) {
    try {
      const raw = storage.getItem(CONFIG_KEY);
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch (e) {
      console.error("Не удалось прочитать настройки синхронизации", e);
    }
    return { ...DEFAULT_CONFIG };
  }

  function saveConfig(storage, cfg) {
    storage.setItem(CONFIG_KEY, JSON.stringify({ ...DEFAULT_CONFIG, ...cfg }));
  }

  /* ---------- провайдеры ---------- */

  function sheetsonHeaders(cfg) {
    if (!cfg.apiKey) throw new Error("Не указан API-ключ Sheetson");
    if (!cfg.spreadsheetId) throw new Error("Не указан Spreadsheet ID");
    return {
      Authorization: `Bearer ${cfg.apiKey}`,
      "X-Spreadsheet-Id": cfg.spreadsheetId,
      "Content-Type": "application/json",
    };
  }

  function timeoutSignal(ms) {
    if (typeof AbortController === "undefined") return {};
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return { signal: c.signal };
  }

  async function request(url, init) {
    let res;
    try {
      res = await fetch(url, { ...init, ...timeoutSignal(REQUEST_TIMEOUT) });
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("Сервис не ответил за 25 секунд");
      throw new Error(
        "Нет связи с сервисом. Проверьте интернет, правильность API ID и то, что таблица доступна (CORS).",
      );
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        `Сервис вернул ошибку ${res.status}. Проверьте API ID и названия листов.`;
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(String(data.error));
    return data;
  }

  function sheetDbUrl(cfg) {
    const id = String(cfg.apiId || "").trim();
    if (!id) throw new Error("Не указан API ID SheetDB");
    return `https://sheetdb.io/api/v1/${encodeURIComponent(id)}`;
  }

  const PROVIDERS = {
    sheetdb: {
      label: "SheetDB",
      docs: "https://sheetdb.io",
      configFields: ["apiId"],
      async list(cfg, sheet, { limit, offset }) {
        const url =
          `${sheetDbUrl(cfg)}?sheet=${encodeURIComponent(sheet)}` +
          `&limit=${limit}&offset=${offset}&_=${Date.now()}`;
        const data = await request(url, { method: "GET" });
        return Array.isArray(data) ? data : Array.isArray(data && data.results) ? data.results : [];
      },
      // Небольшая пауза: сервис сбрасывает кэш чтения с задержкой,
      // иначе сразу после записи можно прочитать устаревшие строки.
      defer: () => new Promise((r) => setTimeout(r, 400)),
      async append(cfg, sheet, rows) {
        // mode=RAW: значения пишутся как текст и не вычисляются как формулы.
        await request(`${sheetDbUrl(cfg)}?mode=RAW`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheet, data: rows }),
        });
        return rows.length;
      },
    },

    sheetson: {
      label: "Sheetson",
      docs: "https://docs.sheetson.com",
      configFields: ["apiKey", "spreadsheetId"],
      async list(cfg, sheet, { limit, offset }) {
        const url =
          `https://api.sheetson.com/v2/sheets/${encodeURIComponent(sheet)}` +
          `?limit=${Math.min(limit, 100)}&skip=${offset}`;
        const data = await request(url, { headers: sheetsonHeaders(cfg) });
        return Array.isArray(data) ? data : Array.isArray(data && data.results) ? data.results : [];
      },
      defer: () => new Promise((r) => setTimeout(r, 250)),
      async append(cfg, sheet, rows) {
        // Sheetson пишет по одной строке за запрос — учитывайте лимит запросов.
        for (const row of rows) {
          await request(`https://api.sheetson.com/v2/sheets/${encodeURIComponent(sheet)}`, {
            method: "POST",
            headers: sheetsonHeaders(cfg),
            body: JSON.stringify(row),
          });
        }
        return rows.length;
      },
    },
  };

  function provider(cfg) {
    const p = PROVIDERS[cfg.provider];
    if (!p) throw new Error(`Неизвестный сервис: ${cfg.provider}`);
    return p;
  }

  /* ---------- счётчик запросов за сеанс ---------- */

  const usage = { requests: 0, rowsPushed: 0, rowsPulled: 0 };

  async function counted(fn, ...args) {
    usage.requests++;
    return fn.apply(this, args);
  }

  /* ---------- сериализация строк ---------- */

  const ts = (v) => (v ? String(v) : "");
  const bool = (v) => (v === true || v === 1 || v === "1" || v === "true" || v === "TRUE" ? "1" : "0");
  // В таблице значения хранятся как "1"/"0", поэтому сравниваем явно, а не через truthiness.
  const isTrue = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";

  function playerRow(p) {
    return {
      game_id: String(p.gameId),
      current_nick: p.currentNick,
      level: p.level == null ? "" : String(p.level),
      note: p.note == null ? "" : p.note,
      source: p.source || "",
      created_at: ts(p.createdAt),
      updated_at: ts(p.updatedAt),
      deleted: bool(p.deleted),
    };
  }

  function nickRow(gameId, n) {
    return {
      game_id: String(gameId),
      nick: n.nick,
      source: n.source || "",
      seen_at: ts(n.seenAt),
      removed: bool(n.removed),
      removed_at: ts(n.removedAt),
    };
  }

  function rowTime(row, ...fields) {
    let best = 0;
    for (const f of fields) {
      const v = row[f];
      if (!v) continue;
      const t = new Date(v).getTime();
      if (Number.isFinite(t) && t > best) best = t;
    }
    return best;
  }

  /* ---------- сбор изменений для отправки ---------- */

  function collectChanges(db, sinceISO) {
    const since = sinceISO ? new Date(sinceISO).getTime() : 0;
    const players = [];
    const history = [];

    // Важно: удалённые игроки тоже нужны — иначе удаление не доедет до других устройств.
    for (const p of Object.values(db.players)) {
      if (new Date(p.updatedAt).getTime() > since) players.push(playerRow(p));
      for (const n of p.nicks) {
        const t = Math.max(
          new Date(n.seenAt || 0).getTime() || 0,
          new Date(n.removedAt || 0).getTime() || 0,
        );
        if (t > since) history.push(nickRow(p.gameId, n));
      }
    }
    return { players, history };
  }

  /* ---------- чтение всей таблицы ---------- */

  async function fetchAll(prov, cfg, sheet, onProgress) {
    const out = [];
    let offset = 0;
    let guard = 0;
    // Sheetson отдаёт не больше 100 строк за запрос, SheetDB — тоже 100 по умолчанию.
    const limit = 100;

    while (guard++ < 500) {
      const rows = await counted(prov.list, cfg, sheet, { limit, offset });
      if (!Array.isArray(rows) || rows.length === 0) break;
      out.push(...rows);
      usage.rowsPulled += rows.length;
      if (onProgress) onProgress({ sheet, loaded: out.length });
      if (rows.length < limit) {
        // сервис мог урезать страницу (например, до 100) — продолжаем, если вернул ровно свою границу
        if (rows.length < Math.min(limit, 100)) break;
        offset += rows.length;
        if (rows.length < limit) continue;
      } else {
        offset += rows.length;
      }
      // защита от бесконечного цикла, если сервис игнорирует offset
      if (offset > 200000) break;
    }
    return out;
  }

  /* ---------- слияние ---------- */

  function mergeSnapshot(db, playerRows, nickRows) {
    const result = {
      playersPulled: 0,
      playersCreated: 0,
      playersUpdated: 0,
      nicksPulled: 0,
      nicksAdded: 0,
      localNewer: 0,
    };

    // 1. Игроки: оставляем самую свежую версию по updated_at
    const remotePlayers = new Map();
    for (const row of playerRows) {
      const id = Number(row.game_id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const prev = remotePlayers.get(id);
      if (!prev || rowTime(row, "updated_at") >= rowTime(prev, "updated_at")) remotePlayers.set(id, row);
    }
    result.playersPulled = remotePlayers.size;

    for (const [gameId, row] of remotePlayers) {
      const key = String(gameId);
      const local = db.players[key];
      const remoteAt = rowTime(row, "updated_at");
      const localAt = local ? new Date(local.updatedAt).getTime() || 0 : -1;

      if (!local) {
        db.players[key] = {
          gameId,
          currentNick: String(row.current_nick || ""),
          level: row.level === "" || row.level == null ? null : Number(row.level),
          note: row.note ? String(row.note) : null,
          source: row.source || "import",
          createdAt: row.created_at || row.updated_at || PlayerDB.nowISO(),
          updatedAt: row.updated_at || PlayerDB.nowISO(),
          deleted: isTrue(row.deleted),
          nicks: [],
        };
        result.playersCreated++;
      } else if (remoteAt > localAt) {
        local.currentNick = String(row.current_nick || local.currentNick);
        local.level = row.level === "" || row.level == null ? null : Number(row.level);
        local.note = row.note ? String(row.note) : null;
        if (row.source) local.source = row.source;
        local.deleted = isTrue(row.deleted);
        local.updatedAt = row.updated_at || local.updatedAt;
        result.playersUpdated++;
      } else if (localAt > remoteAt) {
        result.localNewer++;
      }
    }

    // 2. История ников: ключ (gameId, nick), побеждает более свежее событие
    const remoteNicks = new Map();
    for (const row of nickRows) {
      const id = Number(row.game_id);
      const nick = row.nick;
      if (!Number.isSafeInteger(id) || id <= 0 || !nick) continue;
      const key = id + "\u0000" + nick;
      const prev = remoteNicks.get(key);
      if (!prev || rowTime(row, "seen_at", "removed_at") >= rowTime(prev, "seen_at", "removed_at")) {
        remoteNicks.set(key, row);
      }
    }
    result.nicksPulled = remoteNicks.size;

    for (const row of remoteNicks.values()) {
      const gameId = Number(row.game_id);
      const player = db.players[String(gameId)];
      if (!player) continue; // ники без игрока игнорируем: игрок придёт отдельной строкой

      const nick = String(row.nick);
      const remoteAt = rowTime(row, "seen_at", "removed_at");
      const existing = player.nicks.find((n) => n.nick === nick);
      const localAt = existing
        ? Math.max(
            new Date(existing.seenAt || 0).getTime() || 0,
            new Date(existing.removedAt || 0).getTime() || 0,
          )
        : -1;

      if (!existing) {
        player.nicks.push({
          nick,
          source: row.source || "import",
          seenAt: row.seen_at || PlayerDB.nowISO(),
          removed: isTrue(row.removed),
          removedAt: row.removed_at || null,
        });
        result.nicksAdded++;
      } else if (remoteAt > localAt) {
        existing.source = row.source || existing.source;
        existing.seenAt = row.seen_at || existing.seenAt;
        existing.removed = isTrue(row.removed);
        existing.removedAt = row.removed_at || null;
        result.nicksAdded++;
      }
    }

    return result;
  }

  /* ---------- операции ---------- */

  async function check(storage, cfg) {
    const prov = provider(cfg);
    const report = { provider: prov.label, sheets: {}, ok: true, errors: [] };

    for (const sheet of [SHEET_PLAYERS, SHEET_HISTORY]) {
      try {
        const rows = await counted(prov.list, cfg, sheet, { limit: 5, offset: 0 });
        const keys = rows.length ? Object.keys(rows[0]).filter((k) => k !== "rowIndex") : [];
        report.sheets[sheet] = { ok: true, rowsSample: rows.length, columns: keys };
      } catch (e) {
        report.ok = false;
        report.errors.push(`${sheet}: ${e.message}`);
        report.sheets[sheet] = { ok: false, rowsSample: 0, columns: [], error: e.message };
      }
    }
    return report;
  }

  async function push(storage, db, cfg, opts) {
    const prov = provider(cfg);
    const full = !!(opts && opts.full);
    // opts.rows — заранее снятый снимок изменений (используется в sync()).
    const { players, history } =
      (opts && opts.rows) || collectChanges(db, full ? null : cfg.lastPushAt);

    if (!players.length && !history.length) {
      return { skipped: true, playersPushed: 0, nicksPushed: 0 };
    }

    const startedAt = PlayerDB.nowISO();
    let playersPushed = 0;
    let nicksPushed = 0;

    for (let i = 0; i < players.length; i += CHUNK) {
      playersPushed += await counted(prov.append, cfg, SHEET_PLAYERS, players.slice(i, i + CHUNK));
    }
    for (let i = 0; i < history.length; i += CHUNK) {
      nicksPushed += await counted(prov.append, cfg, SHEET_HISTORY, history.slice(i, i + CHUNK));
    }
    if (prov.defer && playersPushed + nicksPushed) await prov.defer();

    usage.rowsPushed += playersPushed + nicksPushed;
    saveConfig(storage, { ...cfg, lastPushAt: startedAt });

    return { skipped: false, playersPushed, nicksPushed, lastPushAt: startedAt };
  }

  async function pull(storage, db, cfg, onProgress) {
    const prov = provider(cfg);
    const startedAt = PlayerDB.nowISO();

    const playerRows = await fetchAll(prov, cfg, SHEET_PLAYERS, onProgress);
    const nickRows = await fetchAll(prov, cfg, SHEET_HISTORY, onProgress);
    const merged = mergeSnapshot(db, playerRows, nickRows);

    merged.lastPullAt = startedAt;
    merged.empty = playerRows.length === 0;
    saveConfig(storage, { ...cfg, lastPullAt: startedAt });
    return merged;
  }

  /**
   * Полный цикл: сначала забираем свежее из таблицы, затем отправляем
   * локальные изменения. Снимок изменений берётся ДО загрузки, иначе
   * только что полученные строки отправились бы обратно в таблицу.
   */
  async function sync(storage, db, cfg, opts) {
    const startedAt = Date.now();
    const result = { ok: true, pull: null, push: null, requests: 0, ms: 0, error: null };
    const before = usage.requests;

    if (!cfg.enabled || !hasCredentials(cfg)) {
      result.ok = false;
      result.error = "Синхронизация не настроена";
      return result;
    }

    try {
      const rows = collectChanges(db, opts && opts.full ? null : cfg.lastPushAt);
      result.pull = await pull(storage, db, cfg, opts && opts.onProgress);
      result.push = await push(storage, db, loadConfig(storage), { rows });
      result.requests = usage.requests - before;
    } catch (e) {
      result.ok = false;
      result.error = e.message;
      result.requests = usage.requests - before;
    }
    result.ms = Date.now() - startedAt;
    return result;
  }

  function hasCredentials(cfg) {
    if (!cfg) return false;
    if (cfg.provider === "sheetdb") return !!String(cfg.apiId || "").trim();
    if (cfg.provider === "sheetson") return !!String(cfg.apiKey || "").trim() && !!String(cfg.spreadsheetId || "").trim();
    return false;
  }

  async function pushAll(storage, db, cfg) {
    saveConfig(storage, { ...cfg, lastPushAt: null });
    return push(storage, db, loadConfig(storage), { full: true });
  }

  /* ---------- публичный API ---------- */

  global.PlayerSync = {
    CONFIG_KEY,
    SHEETS: { players: SHEET_PLAYERS, history: SHEET_HISTORY },
    PROVIDERS,
    DEFAULT_CONFIG,
    loadConfig,
    saveConfig,
    hasCredentials,
    getUsage: () => ({ ...usage }),
    resetUsage: () => {
      usage.requests = 0;
      usage.rowsPushed = 0;
      usage.rowsPulled = 0;
    },
    check,
    pull,
    push,
    pushAll,
    sync,
    mergeSnapshot,
    collectChanges,
  };
})(window);
