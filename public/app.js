
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const state = {
    player: {},
    theme: localStorage.getItem("akira-theme") || "crimson",
    busy: false,
    lastClick: 0
  };

  const THEMES = ["crimson", "midnight", "ocean", "emerald"];

  function number(value) {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toLocaleString("ru-RU");
  }

  function value(object, keys, fallback = 0) {
    for (const key of keys) {
      if (object?.[key] !== undefined && object[key] !== null) {
        return object[key];
      }
    }
    return fallback;
  }

  function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function toast(message) {
    const el = $("#toast");

    if (!el) {
      console.log("[AKIRA]", message);
      return;
    }

    el.textContent = String(message);
    el.hidden = false;
    el.classList.add("show");

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.classList.remove("show");
      el.hidden = true;
    }, 2500);
  }

  async function api(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    const initData = window.Telegram?.WebApp?.initData;
    if (initData) {
      headers["X-Telegram-Init-Data"] = initData;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      cache: "no-store"
    });

    const raw = await response.text();
    let data = {};

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Некорректный ответ сервера: HTTP ${response.status}`);
      }
    }

    if (!response.ok) {
      const error = new Error(
        data.error || data.message || `Ошибка HTTP ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  }

  function getPlayer(data) {
    if (!data || typeof data !== "object") return null;

    if (data.player && typeof data.player === "object") return data.player;
    if (data.state && typeof data.state === "object") return data.state;

    if (
      "balance" in data ||
      "coins" in data ||
      "click_power" in data ||
      "total_earned" in data
    ) {
      return data;
    }

    return null;
  }

  function balance() {
    return Number(value(state.player, ["balance", "coins", "money"], 0));
  }

  function clickPower() {
    const base = Number(value(
      state.player,
      ["click_power", "clickPower"],
      1
    ));

    const multiplier = Number(value(
      state.player,
      ["multiplier_level", "multiplierLevel"],
      0
    ));

    return Math.max(1, base * Math.pow(2, multiplier));
  }

  function autoPower() {
    return Number(value(
      state.player,
      ["auto_power", "autoPower", "auto_income", "autoIncome"],
      value(state.player, ["auto_level", "autoLevel"], 0)
    ));
  }

  function price(type) {
    const fields = {
      click: ["click_price", "finger_price", "next_click_price"],
      auto: ["auto_price", "next_auto_price"],
      multiplier: ["multiplier_price", "next_multiplier_price"]
    };

    const defaults = { click: 82, auto: 250, multiplier: 1000 };

    return Number(value(state.player, fields[type], defaults[type]));
  }

  function renderState() {
    const p = state.player;

    const set = (selector, text) => {
      const el = $(selector);
      if (el) el.textContent = String(text);
    };

    set("#balance", number(balance()));
    set("#total-earned", number(value(
      p, ["total_earned", "totalEarned", "earned"], 0
    )));

    // Важно: здесь только числа. Подписи «за клик» и «/сек авто»
    // должны оставаться в HTML, а не добавляться повторно через JS.
    set("#click-power", `+${number(clickPower())}`);
    set("#auto-power", number(autoPower()));

    set("#level", value(p, ["level"], 1));

    set("#player-name", value(
      p, ["name", "username", "first_name"], "Игрок"
    ));

    set("#profile-balance", number(balance()));
    set("#profile-earned", number(value(
      p, ["total_earned", "totalEarned", "earned"], 0
    )));
    set("#profile-click", number(clickPower()));
    set("#profile-auto", number(autoPower()));

    set("#finger-price", number(price("click")));
    set("#auto-price", number(price("auto")));
    set("#multiplier-price", number(price("multiplier")));

    updateButtons();
  }

  function updateButtons() {
    $$("[data-upgrade]").forEach(button => {
      const type = button.dataset.upgrade;
      if (!["click", "auto", "multiplier"].includes(type)) return;

      button.disabled = state.busy || balance() < price(type);
    });
  }

  async function loadState(silent = false) {
    try {
      const data = await api("/api/state");
      const p = getPlayer(data);

      if (p) {
        state.player = { ...state.player, ...p };
        renderState();
      }

      if (Array.isArray(data.tasks)) renderTasks(data.tasks);
      return data;
    } catch (error) {
      console.error("[AKIRA] state:", error);
      if (!silent) toast(error.message);
      throw error;
    }
  }

  function renderTasks(tasks) {
    const container = $("#tasks");
    if (!container) return;

    container.innerHTML = tasks.map(task => `
      <div class="task-item">
        <span>${escapeHTML(task.title || task.name || "Задание")}</span>
        <span>+${number(task.reward || 0)} 🍪</span>
      </div>
    `).join("");
  }

  async function clickCookie() {
    const now = Date.now();
    if (now - state.lastClick < 90) return;
    state.lastClick = now;

    const button = $("#cookie-button");
    if (button) {
      button.classList.remove("click-animation");
      void button.offsetWidth;
      button.classList.add("click-animation");
    }

    try {
      const data = await api("/api/click", {
        method: "POST",
        body: JSON.stringify({})
      });

      const p = getPlayer(data);
      if (p) {
        state.player = { ...state.player, ...p };
        renderState();
      } else {
        await loadState(true);
      }
    } catch (error) {
      console.error("[AKIRA] click:", error);
      toast(error.message);
    }
  }

  async function buyUpgrade(type) {
    if (state.busy) return;
    if (!["click", "auto", "multiplier"].includes(type)) return;

    if (balance() < price(type)) {
      toast("Недостаточно монет");
      return;
    }

    state.busy = true;
    updateButtons();

    try {
      let data;

      // Поддерживаем оба варианта API. Переходим на второй маршрут
      // только если первый отсутствует или не поддерживает метод.
      try {
        data = await api("/api/upgrades", {
          method: "POST",
          body: JSON.stringify({ type, upgrade: type })
        });
      } catch (error) {
        if (![404, 405].includes(error.status)) throw error;

        data = await api("/api/buy", {
          method: "POST",
          body: JSON.stringify({ type, upgrade: type })
        });
      }

      const p = getPlayer(data);
      if (p) {
        state.player = { ...state.player, ...p };
        renderState();
      } else {
        await loadState(true);
      }

      toast(data.message || "Покупка выполнена");
    } catch (error) {
      console.error("[AKIRA] purchase:", error);
      toast(error.message || "Не удалось купить улучшение");
    } finally {
      state.busy = false;
      updateButtons();
    }
  }

  async function claimDaily() {
    const button = $("#daily-button");
    if (button) button.disabled = true;

    try {
      const data = await api("/api/daily", {
        method: "POST",
        body: JSON.stringify({})
      });

      const p = getPlayer(data);
      if (p) {
        state.player = { ...state.player, ...p };
        renderState();
      } else {
        await loadState(true);
      }

      toast(data.message || "Ежедневная награда получена!");
    } catch (error) {
      console.error("[AKIRA] daily:", error);
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadLeaderboard() {
    const container = $("#leaderboard");
    if (!container) return;

    container.innerHTML = "<p>Загрузка рейтинга...</p>";

    try {
      const data = await api("/api/leaderboard");
      const players = Array.isArray(data)
        ? data
        : data.players || data.leaderboard || data.top || [];

      if (!players.length) {
        container.innerHTML = "<p>Пока нет игроков в рейтинге.</p>";
        return;
      }

      container.innerHTML = players.map((p, index) => {
        const rank = p.rank || index + 1;
        const name = escapeHTML(
          p.name || p.username || p.first_name || "Игрок"
        );
        const score = value(
          p, ["score", "balance", "coins", "total_earned"], 0
        );

        return `
          <div class="leaderboard-item">
            <span class="leaderboard-rank">#${rank}</span>
            <strong class="leaderboard-name">${name}</strong>
            <span class="leaderboard-score">${number(score)} 🍪</span>
          </div>
        `;
      }).join("");
    } catch (error) {
      console.error("[AKIRA] leaderboard:", error);
      container.innerHTML =
        `<p>${escapeHTML(error.message || "Ошибка загрузки рейтинга")}</p>`;
    }
  }

  function switchTab(name) {
    const panel = $(`#tab-${name}`);

    if (!panel) {
      console.error(`[AKIRA] Не найдена панель #tab-${name}`);
      toast("Панель вкладки отсутствует в index.html");
      return;
    }

    $$(".nav-button[data-tab]").forEach(button => {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });

    ["shop", "top", "profile", "themes"].forEach(tab => {
      const el = $(`#tab-${tab}`);
      if (!el) return;

      el.hidden = tab !== name;
      el.classList.toggle("active", tab === name);
    });

    if (name === "top") loadLeaderboard();
    if (name === "profile") loadState(true).catch(() => {});
  }

  function applyTheme(name) {
    if (!THEMES.includes(name)) name = "crimson";

    state.theme = name;
    document.body.dataset.theme = name;
    document.documentElement.dataset.theme = name;

    localStorage.setItem("akira-theme", name);

    $$(".theme-option[data-theme]").forEach(button => {
      const active = button.dataset.theme === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function bindEvents() {
    $("#cookie-button")?.addEventListener("click", clickCookie);
    $("#daily-button")?.addEventListener("click", claimDaily);

    $$(".nav-button[data-tab]").forEach(button => {
      button.addEventListener("click", () => {
        switchTab(button.dataset.tab);
      });
    });

    $$("[data-upgrade]").forEach(button => {
      button.addEventListener("click", () => {
        buyUpgrade(button.dataset.upgrade);
      });
    });

    $$(".theme-option[data-theme]").forEach(button => {
      button.addEventListener("click", () => {
        applyTheme(button.dataset.theme);
        toast("Тема изменена");
      });
    });
  }

  async function init() {
    const tg = window.Telegram?.WebApp;

    if (tg) {
      tg.ready();
      tg.expand();
      try {
        tg.setHeaderColor("#09080d");
        tg.setBackgroundColor("#09080d");
      } catch (_) {}
    }

    bindEvents();
    applyTheme(state.theme);
    switchTab("shop");

    try {
      await loadState();
    } catch (_) {}

    // Загрузка топа выполняется при открытии вкладки «Топ».
    setInterval(() => {
      loadState(true).catch(() => {});
    }, 15000);
  }

  window.AKIRA = {
    api,
    loadState,
    loadLeaderboard,
    buyUpgrade,
    switchTab,
    applyTheme
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
