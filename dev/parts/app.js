/* ============================================================
   app.js — интерфейс. Собирается в index.html через dev/build.mjs.
   ============================================================ */
(function () {
  "use strict";

  const DB = window.PlayerDB;
  const SYNC = window.PlayerSync;
  const storage = window.localStorage;

  let db = DB.load(storage);
  let searchQuery = "";
  let searchTimer = null;
  let syncBusy = false;

  /* ---------- утилиты ---------- */

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function highlight(text, query) {
    const q = String(query || "").trim();
    if (!q) return escapeHtml(text);
    const i = String(text).toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return escapeHtml(text);
    return (
      escapeHtml(String(text).slice(0, i)) +
      "<mark>" + escapeHtml(String(text).slice(i, i + q.length)) + "</mark>" +
      escapeHtml(String(text).slice(i + q.length))
    );
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }

  function num(n) {
    return Number(n || 0).toLocaleString("ru-RU");
  }

  function persist() {
    const err = DB.save(storage, db);
    if (err) showToast(err, "rose");
    return !err;
  }

  function showToast(text, tone) {
    const colors = {
      emerald: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
      rose: "border-rose-500/40 bg-rose-500/15 text-rose-200",
      amber: "border-amber-500/40 bg-amber-500/15 text-amber-100",
      indigo: "border-indigo-500/40 bg-indigo-500/15 text-indigo-100",
    };
    const el = document.createElement("div");
    el.className =
      "fade-in fixed bottom-4 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 rounded-xl border px-4 py-3 text-sm shadow-xl shadow-black/40 " +
      (colors[tone] || colors.indigo);
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 320);
    }, 4200);
  }

  /* ---------- статистика ---------- */

  function updateStats() {
    const s = DB.getStats(db);
    $("stat-players").textContent = num(s.players);
    $("stat-nicknames").textContent = num(s.nicknames);
    $("stat-changed").textContent = num(s.changed);
    $("seed-banner").classList.toggle("hidden", s.players > 0);
  }

  /* ---------- отрисовка результатов ---------- */

  function renderResults(query) {
    searchQuery = query;
    const changedOnly = $("filter-changed").checked;
    const { total, results } = DB.searchPlayers(db, query, { changedOnly, limit: 100 });
    const container = $("search-results");
    const status = $("search-status");

    if (!query) {
      status.textContent = `Недавно обновлённые · показано ${results.length} из ${num(total)}`;
    } else {
      status.textContent =
        total === 0
          ? "Ничего не найдено"
          : `${num(total)} ${plural(total, "совпадение", "совпадения", "совпадений")}` +
            (total > results.length ? ` (показано ${results.length})` : "");
    }

    if (!results.length) {
      container.innerHTML = `<div class="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
        ${query ? "Ничего не найдено. Если игрок новый — добавьте его на вкладке «Добавить»." : "База пуста: загрузите стартовый список или данные из Google Sheets."}
      </div>`;
      return;
    }

    container.innerHTML = results.map((p) => renderPlayerCard(p, query)).join("");
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function renderPlayerCard(p, query) {
    const visible = DB.visibleNicks(p);
    const previous = visible.filter((n) => n.nick !== p.currentNick);
    const allVisible = visible.length;

    return `
    <article class="fade-in rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/20" data-card="${p.gameId}">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-slate-500">Текущий ник</p>
          <h3 class="mt-0.5 whitespace-pre-wrap break-all text-xl font-semibold text-white">${highlight(p.currentNick, query)}</h3>
        </div>
        <div class="text-right">
          <p class="text-xs uppercase tracking-wider text-slate-500">ID игрока</p>
          <button data-act="copy" data-id="${p.gameId}" title="Скопировать ID"
            class="mt-0.5 rounded-lg bg-indigo-500/15 px-2.5 py-1 font-mono text-lg font-semibold text-indigo-300 transition hover:bg-indigo-500/25">
            ${p.gameId}<span class="ml-2 text-xs font-normal text-indigo-200/70">копировать</span>
          </button>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
        ${p.level !== null ? `<span class="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">Уровень ${p.level}</span>` : ""}
        <span class="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">${allVisible} ${plural(allVisible, "ник", "ника", "ников")}</span>
        ${p.source === "manual" ? '<span class="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">добавлен вручную</span>' : ""}
        ${allVisible > 1 ? '<span class="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-300">ник менялся</span>' : ""}
        <span class="rounded-full bg-slate-800 px-2.5 py-1 text-slate-400">обновлён ${formatDate(p.updatedAt)}</span>
      </div>

      ${previous.length ? `
      <div class="mt-3">
        <p class="text-xs uppercase tracking-wider text-slate-500">Прежние ники</p>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          ${previous.map((n) => `<span class="whitespace-pre-wrap break-all rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-1 text-sm text-slate-300">${highlight(n.nick, query)}</span>`).join("")}
        </div>
      </div>` : ""}

      ${p.note ? `<p class="mt-3 text-sm italic text-slate-400">«${escapeHtml(p.note)}»</p>` : ""}

      <button data-act="toggle" class="mt-3 text-sm text-slate-400 underline-offset-4 hover:text-white hover:underline">Управление / история</button>

      <div class="player-details hidden mt-3 space-y-4 border-t border-slate-800 pt-4">
        <div>
          <p class="mb-2 text-xs uppercase tracking-wider text-slate-500">История ников (от старых к новым)</p>
          <ul class="space-y-1.5">
            ${p.nicks.map((n) => {
              const isCurrent = n.nick === p.currentNick && !n.removed;
              return `
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-lg ${n.removed ? "bg-slate-900/60 opacity-60" : "bg-slate-800/50"} px-3 py-2">
                <div class="min-w-0">
                  <span class="whitespace-pre-wrap break-all text-sm ${n.removed ? "text-slate-400 line-through" : "text-slate-100"}">${escapeHtml(n.nick)}</span>
                  ${isCurrent ? '<span class="ml-2 rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs text-indigo-300">текущий</span>' : ""}
                  ${n.removed ? '<span class="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-xs text-rose-300">удалён</span>' : ""}
                  <span class="ml-2 text-xs text-slate-500">${escapeHtml(n.source)} · ${formatDate(n.seenAt)}</span>
                </div>
                <div class="flex gap-3 text-xs">
                  ${!isCurrent && !n.removed ? `<button data-act="set-current" data-id="${p.gameId}" data-nick="${escapeHtml(n.nick)}" class="text-indigo-300 hover:underline">сделать текущим</button>` : ""}
                  ${!n.removed && allVisible > 1 ? `<button data-act="remove-nick" data-id="${p.gameId}" data-nick="${escapeHtml(n.nick)}" class="text-rose-400 hover:underline">удалить</button>` : ""}
                </div>
              </li>`;
            }).join("")}
          </ul>
        </div>

        <form data-form="add-nick" data-id="${p.gameId}" class="flex flex-wrap gap-2">
          <input type="text" name="newnick" placeholder="Новый ник (станет текущим)"
            class="input-field min-w-0 flex-1 py-2 text-sm">
          <button type="submit" class="btn bg-indigo-500 px-4 py-2 text-sm text-white hover:bg-indigo-400">Добавить ник</button>
        </form>

        <form data-form="note" data-id="${p.gameId}" class="flex flex-wrap gap-2">
          <input type="text" name="note" value="${escapeHtml(p.note || "")}" placeholder="Заметка об игроке"
            class="input-field min-w-0 flex-1 py-2 text-sm">
          <button type="submit" class="btn bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">Сохранить заметку</button>
        </form>

        <div class="flex items-center justify-between">
          <p class="text-sm text-rose-400" data-error></p>
          <button data-act="delete-player" data-id="${p.gameId}"
            class="rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10">Удалить игрока</button>
        </div>
      </div>
    </article>`;
  }

  function refreshAll() {
    updateStats();
    renderResults($("search-input").value);
    renderSyncStatus();
  }

  /* ---------- действия в карточке (делегирование) ---------- */

  $("search-results").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const nick = btn.dataset.nick;
    let err = null;

    switch (btn.dataset.act) {
      case "copy":
        navigator.clipboard.writeText(String(id)).then(() => {
          const span = btn.querySelector("span");
          if (span) {
            const old = span.textContent;
            span.textContent = "скопировано";
            setTimeout(() => (span.textContent = old), 1200);
          }
        }).catch(() => showToast("Не удалось скопировать — выделите ID вручную", "amber"));
        return;
      case "toggle": {
        const details = btn.nextElementSibling;
        const hidden = details.classList.contains("hidden");
        details.classList.toggle("hidden", !hidden);
        btn.textContent = hidden ? "Скрыть историю" : "Управление / история";
        return;
      }
      case "set-current":
        err = DB.setCurrent(db, id, nick);
        break;
      case "remove-nick":
        err = DB.removeNick(db, id, nick);
        break;
      case "delete-player": {
        const p = DB.findPlayer(db, id);
        if (!p) return;
        if (!confirm(`Удалить игрока ${id} (${p.currentNick}) и всю историю ников?`)) return;
        err = DB.deletePlayer(db, id);
        break;
      }
      default:
        return;
    }

    if (err) {
      const holder = btn.closest("article").querySelector("[data-error]");
      if (holder) holder.textContent = err;
      return;
    }
    if (persist()) refreshAll();
  });

  $("search-results").addEventListener("submit", (e) => {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    const id = Number(form.dataset.id);
    let err = null;

    if (form.dataset.form === "add-nick") {
      const input = form.querySelector('input[name="newnick"]');
      const nick = input.value.trim();
      if (!nick) return;
      err = DB.addNick(db, id, nick, "manual");
      if (!err) input.value = "";
    } else if (form.dataset.form === "note") {
      err = DB.setNote(db, id, form.querySelector('input[name="note"]').value);
    }

    if (err) {
      const holder = form.closest("article").querySelector("[data-error]");
      if (holder) holder.textContent = err;
      return;
    }
    if (persist()) refreshAll();
  });

  /* ---------- поиск ---------- */

  const searchInput = $("search-input");
  const searchClear = $("search-clear");

  searchInput.addEventListener("input", () => {
    searchClear.classList.toggle("hidden", !searchInput.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderResults(searchInput.value), 180);
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.classList.add("hidden");
    renderResults("");
    searchInput.focus();
  });

  $("filter-changed").addEventListener("change", () => renderResults(searchInput.value));

  /* ---------- вкладки ---------- */

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.remove("tab-active");
        b.classList.add("text-slate-400");
      });
      btn.classList.add("tab-active");
      btn.classList.remove("text-slate-400");

      document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
      $("tab-" + btn.dataset.tab).classList.remove("hidden");
      if (btn.dataset.tab === "backup") updateStorageInfo();
      if (btn.dataset.tab === "sync") renderSyncStatus();
      if (btn.dataset.tab === "search") searchInput.focus();
    });
  });

  /* ---------- стартовый список ---------- */

  $("btn-seed").addEventListener("click", async () => {
    const btn = $("btn-seed");
    const err = $("seed-error");
    btn.disabled = true;
    btn.textContent = "Загружаю…";
    err.classList.add("hidden");
    try {
      const resp = await fetch("data/initial-players.txt", { cache: "no-store" });
      if (!resp.ok) throw new Error("Не удалось загрузить стартовый список (" + resp.status + ")");
      const parsed = DB.parseList(await resp.text());
      if (!parsed.entries.length) throw new Error("Стартовый список пуст или в неизвестном формате");
      const { report, actions } = DB.planImport(db, parsed.entries, "seed", {
        totalLines: parsed.totalLines,
        invalid: parsed.invalid,
      });
      DB.applyImport(db, actions, "seed");
      if (persist()) refreshAll();
      showToast(
        `Загружено: ${num(report.newPlayers)} новых игроков, ${num(report.nicksAdded)} ников.` +
          (parsed.invalid.length ? ` Пропущено строк: ${parsed.invalid.length}.` : ""),
        "emerald",
      );
    } catch (e) {
      err.textContent = e.message;
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Загрузить стартовый список (1000)";
    }
  });

  /* ---------- форма добавления ---------- */

  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = $("add-msg");
    const gameIdStr = $("add-gameid").value.trim();
    const nick = $("add-nick").value.trim();
    const older = $("add-older").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const levelStr = $("add-level").value.trim();
    const note = $("add-note").value.trim();

    if (!/^\d{1,15}$/.test(gameIdStr) || Number(gameIdStr) <= 0) {
      msg.textContent = "ID должен быть положительным числом";
      msg.className = "text-sm text-rose-400";
      return;
    }
    if (!nick) {
      msg.textContent = "Ник обязателен";
      msg.className = "text-sm text-rose-400";
      return;
    }

    const { created } = DB.addManual(db, {
      gameId: Number(gameIdStr),
      nick,
      olderNicks: older,
      level: /^\d{1,9}$/.test(levelStr) ? Number(levelStr) : null,
      note: note || null,
    });

    if (!persist()) return;
    msg.textContent = created
      ? `Игрок ${gameIdStr} добавлен.`
      : `Игрок ${gameIdStr} уже был — ник добавлен в историю и стал текущим.`;
    msg.className = "text-sm text-emerald-400";

    $("add-gameid").value = "";
    $("add-nick").value = "";
    $("add-older").value = "";
    $("add-level").value = "";
    $("add-note").value = "";
    refreshAll();
  });

  /* ============================================================
     Импорт списка — с исправленным отчётом
     ============================================================ */

  const importText = $("import-text");
  const btnScan = $("btn-scan");
  const btnDoImport = $("btn-do-import");
  const importReport = $("import-report");
  const importError = $("import-error");

  function updateImportButtons() {
    const has = !!importText.value.trim();
    const lines = importText.value.split("\n").filter((l) => l.trim()).length;
    $("import-linecount").textContent = has
      ? `${num(lines)} ${plural(lines, "строка", "строки", "строк")}`
      : "";
    btnScan.disabled = !has || syncBusy;
    btnDoImport.disabled = !has || syncBusy;
    importError.classList.add("hidden");
  }

  importText.addEventListener("input", () => {
    importReport.classList.add("hidden");
    updateImportButtons();
  });

  $("btn-upload").addEventListener("click", () => $("import-file").click());

  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    importText.value = await file.text();
    importText.dispatchEvent(new Event("input"));
    e.target.value = "";
  });

  function runImport(dryRun) {
    const text = importText.value;
    if (!text.trim()) {
      importError.textContent = "Список пуст.";
      importError.classList.remove("hidden");
      return;
    }

    const parsed = DB.parseList(text);
    if (!parsed.entries.length) {
      importError.textContent =
        "Не найдено ни одной корректной строки.\nОжидаемый формат: 1 \"Ник\" 7646467 1566560000 9999";
      importError.classList.remove("hidden");
      importReport.classList.add("hidden");
      return;
    }

    let report;
    if (dryRun) {
      report = DB.planImport(db, parsed.entries, "import", {
        totalLines: parsed.totalLines,
        invalid: parsed.invalid,
        dryRun: true,
      }).report;
    } else {
      // Планируем и применяем на одном и том же снимке базы.
      const plan = DB.planImport(db, parsed.entries, "import", {
        totalLines: parsed.totalLines,
        invalid: parsed.invalid,
        dryRun: false,
      });
      DB.applyImport(db, plan.actions, "import");
      report = plan.report;
      if (!persist()) return;
      // Отчёт остаётся на экране: текст НЕ очищаем, поле не трогаем.
      updateStats();
      renderResults($("search-input").value);
    }

    renderImportReport(report);
    importReport.classList.remove("hidden");
    importReport.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (!dryRun) renderSyncStatus();
  }

  btnScan.addEventListener("click", () => runImport(true));
  btnDoImport.addEventListener("click", () => runImport(false));

  function reportRow(label, value, tone) {
    const color =
      tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : tone === "indigo" ? "text-indigo-300" : "text-white";
    return `<div class="rounded-lg bg-slate-900 px-2 py-3">
      <p class="report-num text-2xl font-semibold ${color}">${value}</p>
      <p class="text-xs text-slate-500">${label}</p>
    </div>`;
  }

  function renderImportReport(r) {
    const duplicates = Math.max(0, r.parsed - (r.uniqueIds || 0) - 0);
    const totalChecked = r.newPlayers + r.renamed.length + r.unchanged;

    importReport.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-medium text-white">${r.dryRun ? "Предпросмотр — ничего не сохранено" : "Импорт завершён ✔"}</p>
        <span class="text-xs text-slate-500">${r.dryRun ? "проверка" : "отчёт сохранён на экране"}</span>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        ${reportRow("Корректных строк", num(r.parsed))}
        ${reportRow("Уникальных ID", num(r.uniqueIds))}
        ${reportRow("Новых игроков", num(r.newPlayers), "emerald")}
        ${reportRow("Сменили ник", num(r.renamed.length), "amber")}
        ${reportRow("Без изменений", num(r.unchanged))}
        ${reportRow("Ников добавлено", num(r.nicksAdded), "indigo")}
        ${reportRow("Повторов строк", num(r.duplicateLines))}
        ${reportRow("Строк пропущено", num(r.invalid.length), r.invalid.length ? "amber" : undefined)}
      </div>

      <p class="mt-3 text-xs ${r.balanceOk ? "text-slate-500" : "text-rose-300"}">
        ${r.balanceOk
          ? `Проверка сходится: ${num(r.newPlayers)} новых + ${num(r.renamed.length)} изменённых + ${num(r.unchanged)} без изменений = ${num(totalChecked)} из ${num(r.uniqueIds)} ID.`
          : `Внимание: суммы не сходятся (${num(totalChecked)} из ${num(r.uniqueIds)}). Сообщите об этом — в отчёте ошибка.`}
      </p>

      ${r.renamed.length ? `
      <div class="mt-4">
        <p class="text-sm font-medium text-amber-300">Найденные смены ников (${num(r.renamed.length)})</p>
        <ul class="mt-2 max-h-72 space-y-1 overflow-auto text-sm">
          ${r.renamed.map((x) => `
            <li class="rounded-lg bg-slate-900 px-3 py-1.5 text-slate-300">
              <span class="font-mono text-indigo-300">${x.gameId}</span>
              <span class="whitespace-pre-wrap text-slate-500 line-through"> ${escapeHtml(x.oldNick)}</span>
              <span class="mx-1.5 text-slate-500">→</span>
              <span class="whitespace-pre-wrap text-white">${escapeHtml(x.newNick)}</span>
              ${x.nicksAdded ? `<span class="ml-2 text-xs text-slate-500">+${x.nicksAdded} в историю</span>` : ""}
            </li>`).join("")}
        </ul>
      </div>` : ""}

      ${r.newSample.length ? `
      <details class="mt-4 text-sm text-slate-400">
        <summary class="cursor-pointer text-emerald-300">Новые игроки${r.newPlayers > r.newSample.length ? ` (первые ${r.newSample.length} из ${num(r.newPlayers)})` : ""}</summary>
        <ul class="mt-2 space-y-1">
          ${r.newSample.map((n) => `<li><span class="font-mono text-indigo-300">${n.gameId}</span> <span class="whitespace-pre-wrap">${escapeHtml(n.nick)}</span></li>`).join("")}
        </ul>
      </details>` : ""}

      ${r.invalid.length ? `
      <details class="mt-4 text-sm text-slate-400">
        <summary class="cursor-pointer text-rose-300">Пропущено строк: ${num(r.invalid.length)}</summary>
        <ul class="mt-2 space-y-1 font-mono text-xs">
          ${r.invalid.slice(0, 100).map((l) => `<li>#${l.line}: ${escapeHtml(l.text)}</li>`).join("")}
        </ul>
        ${r.invalid.length > 100 ? `<p class="mt-1 text-xs text-slate-500">…и ещё ${num(r.invalid.length - 100)}</p>` : ""}
      </details>` : ""}

      ${r.dryRun
        ? `<button data-act="confirm-import" class="btn mt-4 bg-indigo-500 px-5 py-2 text-sm text-white hover:bg-indigo-400">Всё верно — импортировать</button>`
        : `<p class="mt-4 text-xs text-slate-500">Данные сохранены локально. Чтобы отправить их на другие устройства — нажмите «Синхронизировать» вверху.</p>`}
    `;
  }

  importReport.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-act="confirm-import"]');
    if (!btn) return;
    runImport(false);
  });

  /* ---------- бэкап ---------- */

  function updateStorageInfo() {
    const raw = storage.getItem(DB.DB_KEY) || "";
    const bytes = new Blob([raw]).size;
    const s = DB.getStats(db);
    $("storage-info").textContent =
      `${num(s.players)} игроков · ${num(s.nicknames)} ников · ${(bytes / 1024).toFixed(1)} КБ в localStorage этого браузера`;
  }

  function backupMsg(text, tone) {
    const el = $("backup-msg");
    el.textContent = text;
    el.className = "mt-4 text-sm " + (tone === "rose" ? "text-rose-400" : tone === "amber" ? "text-amber-400" : "text-emerald-400");
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 6000);
  }

  $("btn-export").addEventListener("click", () => {
    const payload = {
      ...db,
      exportedAt: new Date().toISOString(),
      app: "player-nickname-directory",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `player-directory-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupMsg("Резервная копия скачана.", "emerald");
  });

  $("btn-import-backup").addEventListener("click", () => $("import-backup-file").click());

  $("import-backup-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported || typeof imported.players !== "object") throw new Error("В файле нет данных игроков");
      const count = Object.keys(imported.players).length;
      if (!confirm(`Заменить текущие данные на ${num(count)} игроков из файла?`)) return;
      db = DB.normalizeDB(imported);
      if (!persist()) return;
      refreshAll();
      updateStorageInfo();
      backupMsg(`Восстановлено игроков: ${num(DB.getStats(db).players)}.`, "emerald");
    } catch (err) {
      backupMsg("Не удалось восстановить: " + err.message, "rose");
    }
    e.target.value = "";
  });

  $("btn-clear-all").addEventListener("click", () => {
    if (!confirm("Удалить ВСЕ данные из этого браузера? В Google Sheets останется копия.")) return;
    if (!confirm("Точно удалить? Сначала лучше скачать резервную копию.")) return;
    db = DB.emptyDB();
    if (!persist()) return;
    refreshAll();
    updateStorageInfo();
    backupMsg("Все локальные данные удалены.", "amber");
  });

  /* ============================================================
     Панель синхронизации
     ============================================================ */

  let cfg = SYNC.loadConfig(storage);

  function readConfigForm() {
    const provider = $("sync-provider").value;
    return {
      ...cfg,
      provider,
      enabled: $("sync-enabled").checked,
      apiId: $("sync-apiid").value.trim(),
      apiKey: $("sync-apikey").value.trim(),
      spreadsheetId: $("sync-spreadsheet").value.trim(),
      autoPullMinutes: Number($("sync-interval").value) || 0,
    };
  }

  function fillConfigForm() {
    $("sync-provider").value = cfg.provider || "sheetdb";
    $("sync-enabled").checked = !!cfg.enabled;
    $("sync-apiid").value = cfg.apiId || "";
    $("sync-apikey").value = cfg.apiKey || "";
    $("sync-spreadsheet").value = cfg.spreadsheetId || "";
    $("sync-interval").value = String(cfg.autoPullMinutes == null ? 10 : cfg.autoPullMinutes);
    toggleProviderFields();
  }

  function toggleProviderFields() {
    const p = $("sync-provider").value;
    $("field-sheetdb-apiid").classList.toggle("hidden", p !== "sheetdb");
    $("field-sheetson-key").classList.toggle("hidden", p !== "sheetson");
    $("field-sheetson-id").classList.toggle("hidden", p !== "sheetson");
    const prov = SYNC.PROVIDERS[p];
    $("sync-provider-label").textContent = prov ? prov.label : "—";
  }

  $("sync-provider").addEventListener("change", toggleProviderFields);
  $("sync-enabled").addEventListener("change", () => {
    cfg = readConfigForm();
    SYNC.saveConfig(storage, cfg);
    renderSyncStatus();
  });

  function renderSyncStatus() {
    const dot = $("sync-dot");
    const status = $("sync-status");
    const usage = SYNC.getUsage();

    $("sync-last-pull").textContent = formatDateTime(cfg.lastPullAt);
    $("sync-last-push").textContent = formatDateTime(cfg.lastPushAt);
    $("sync-usage-panel").textContent = num(usage.requests);
    $("sync-usage").textContent = usage.requests ? `${num(usage.requests)} запросов` : "";

    if (!SYNC.hasCredentials(cfg)) {
      dot.className = "status-dot bg-slate-600";
      status.textContent = "Google Sheets не подключён — данные только в этом браузере. Включить → вкладка «Sheets».";
      $("btn-sync-now").disabled = true;
      return;
    }
    if (!cfg.enabled) {
      dot.className = "status-dot bg-slate-500";
      status.textContent = "Синхронизация выключена (галочка «Включена» на вкладке «Sheets»).";
      $("btn-sync-now").disabled = true;
      return;
    }

    $("btn-sync-now").disabled = syncBusy;
    dot.className = syncBusy ? "status-dot bg-amber-400" : "status-dot bg-emerald-400";
    status.textContent = syncBusy
      ? "Синхронизация…"
      : `Google Sheets подключён · последняя загрузка ${formatDateTime(cfg.lastPullAt)}` +
        (cfg.lastPushAt ? ` · отправка ${formatDateTime(cfg.lastPushAt)}` : "");
  }

  async function runSync(action, opts) {
    if (syncBusy) return;
    syncBusy = true;
    renderSyncStatus();
    updateImportButtons();

    const msg = $("sync-action-msg");
    msg.className = "mt-3 text-sm text-slate-400";
    msg.textContent = "Работаю…";

    try {
      cfg = readConfigForm();
      SYNC.saveConfig(storage, cfg);

      if (!SYNC.hasCredentials(cfg)) {
        msg.className = "mt-3 text-sm text-amber-300";
        msg.textContent = "Сначала заполните ID/ключ и нажмите «Сохранить настройки».";
        return;
      }

      if (action === "check") {
        const r = await SYNC.check(storage, cfg);
        renderCheck(r);
        msg.className = "mt-3 text-sm " + (r.ok ? "text-emerald-300" : "text-rose-300");
        msg.textContent = r.ok ? "Подключение работает, листы найдены." : "Есть проблемы: " + r.errors.join("; ");
        return;
      }

      let result;
      if (action === "pull") {
        result = await SYNC.pull(storage, db, cfg);
        persist();
        refreshAll();
        msg.className = "mt-3 text-sm text-emerald-300";
        msg.textContent =
          `В таблице: игроков ${num(result.playersPulled)}, записей истории ${num(result.nicksPulled)}.\n` +
          `Локально: добавлено игроков ${num(result.playersCreated)}, обновлено ${num(result.playersUpdated)}, ников ${num(result.nicksAdded)}. ` +
          (result.empty ? "Таблица пуста — сначала отправьте данные." : "");
        if (result.empty) msg.className = "mt-3 text-sm text-amber-300";
      } else if (action === "push") {
        result = await SYNC.push(storage, db, cfg);
        cfg = SYNC.loadConfig(storage);
        renderSyncStatus();
        msg.className = "mt-3 text-sm text-emerald-300";
        msg.textContent = result.skipped
          ? "Нет изменений с прошлой отправки."
          : `Отправлено: строк игроков ${num(result.playersPushed)}, ников ${num(result.nicksPushed)}.`;
      } else if (action === "full") {
        result = await SYNC.sync(storage, db, cfg, { full: !!opts && opts.full });
        cfg = SYNC.loadConfig(storage);
        persist();
        refreshAll();
        if (!result.ok) throw new Error(result.error);
        msg.className = "mt-3 text-sm text-emerald-300";
        msg.textContent =
          `Синхронизация завершена.\n` +
          `Из таблицы: игроков ${num(result.pull.playersPulled)}, записей истории ${num(result.pull.nicksPulled)}; ` +
          `локально добавлено ${num(result.pull.playersCreated)}, обновлено ${num(result.pull.playersUpdated)}.\n` +
          `Отправлено: игроков ${num(result.push.playersPushed || 0)}, ников ${num(result.push.nicksPushed || 0)}.\n` +
          `Запросов: ${num(result.requests)}.`;
      }
    } catch (e) {
      msg.className = "mt-3 text-sm text-rose-300";
      msg.textContent = "Ошибка: " + e.message;
    } finally {
      syncBusy = false;
      renderSyncStatus();
      updateImportButtons();
    }
  }

  function renderCheck(r) {
    const box = $("sync-check");
    const rows = Object.entries(r.sheets)
      .map(([name, v]) => {
        const ok = v.ok;
        return `<li class="flex flex-wrap items-center gap-2">
          <span class="status-dot ${ok ? "bg-emerald-400" : "bg-rose-400"}"></span>
          <span class="font-mono text-slate-200">${escapeHtml(name)}</span>
          <span class="${ok ? "text-slate-400" : "text-rose-300"}">${ok
            ? `— доступен, колонки: ${v.columns.length ? v.columns.join(", ") : "лист пуст"}`
            : "— " + escapeHtml(v.error || "ошибка")}</span>
        </li>`;
      })
      .join("");
    box.innerHTML = `<p class="font-medium text-white">Проверка: ${escapeHtml(r.provider)}</p>
      <ul class="mt-2 space-y-1 text-xs">${rows}</ul>
      ${r.ok && Object.values(r.sheets).every((s) => s.columns.length)
        ? '<p class="mt-2 text-xs text-emerald-300">Шапка листов совпадает, можно синхронизировать.</p>'
        : '<p class="mt-2 text-xs text-amber-300">Если лист пуст — нажмите «Создать листы с шапкой» или добавьте шапку вручную (см. инструкцию ниже).</p>'}`;
    box.classList.remove("hidden");
  }

  $("sync-save").addEventListener("click", () => {
    cfg = readConfigForm();
    SYNC.saveConfig(storage, cfg);
    const msg = $("sync-config-msg");
    msg.className = "mt-3 text-sm text-emerald-300";
    msg.textContent = "Настройки сохранены в этом браузере.";
    renderSyncStatus();
  });

  $("sync-test").addEventListener("click", () => runSync("check"));
  $("sync-pull").addEventListener("click", () => runSync("pull"));
  $("sync-push").addEventListener("click", () => runSync("push"));
  $("sync-full").addEventListener("click", () => runSync("full"));
  $("sync-upload-all").addEventListener("click", () => {
    if (!confirm("Выгрузить всю локальную базу в таблицу (добавит строки заново)?")) return;
    cfg = readConfigForm();
    SYNC.saveConfig(storage, cfg);
    runSync("push", { full: true });
  });

  $("sync-create-sheets").addEventListener("click", async () => {
    cfg = readConfigForm();
    SYNC.saveConfig(storage, cfg);
    const msg = $("sync-config-msg");
    if (!SYNC.hasCredentials(cfg)) {
      msg.className = "mt-3 text-sm text-amber-300";
      msg.textContent = "Сначала заполните ID/ключ и сохраните настройки.";
      return;
    }
    msg.className = "mt-3 text-sm text-slate-400";
    msg.textContent = "Проверяю листы…";

    const headers = {
      players: ["game_id", "current_nick", "level", "note", "source", "created_at", "updated_at", "deleted"],
      history: ["game_id", "nick", "source", "seen_at", "removed", "removed_at"],
    };

    try {
      const prov = SYNC.PROVIDERS[cfg.provider];
      const done = [];
      for (const sheet of [SYNC.SHEETS.players, SYNC.SHEETS.history]) {
        const rows = await prov.list(cfg, sheet, { limit: 1, offset: 0 });
        if (rows.length) {
          done.push(`${sheet}: уже есть данные, шапку не трогаю`);
          continue;
        }
        const row = Object.fromEntries((sheet === SYNC.SHEETS.players ? headers.players : headers.history).map((h) => [h, h]));
        await prov.append(cfg, sheet, [row]);
        done.push(`${sheet}: шапка создана`);
      }
      msg.className = "mt-3 text-sm text-emerald-300";
      msg.textContent = done.join("\n");
    } catch (e) {
      msg.className = "mt-3 text-sm text-rose-300";
      msg.textContent = "Не удалось создать листы: " + e.message;
    }
  });

  $("btn-sync-now").addEventListener("click", () => runSync("full"));
  $("btn-seed-pull").addEventListener("click", () => {
    document.querySelector('.tab-btn[data-tab="sync"]').click();
    runSync("full");
  });

  /* ---------- автосинхронизация ---------- */

  function maybeAutoSync() {
    if (!cfg.enabled || !SYNC.hasCredentials(cfg)) return;
    const minutes = Number(cfg.autoPullMinutes) || 0;
    if (!minutes) return;
    const last = cfg.lastPullAt ? new Date(cfg.lastPullAt).getTime() : 0;
    if (Date.now() - last < minutes * 60 * 1000) return;
    runSync("full").catch(() => {});
  }

  /* ---------- инициализация ---------- */

  function init() {
    fillConfigForm();
    updateStats();
    renderResults("");
    renderSyncStatus();
    updateImportButtons();
    maybeAutoSync();

    window.addEventListener("online", () => {
      showToast("Связь восстановлена — можно синхронизировать.", "indigo");
    });
    window.addEventListener("offline", () => {
      showToast("Нет сети: данные доступны, изменения уйдут в таблицу позже.", "amber");
    });
  }

  init();
})();
