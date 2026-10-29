
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const state = {
    player: {},
    busy: false,
    lastClick: 0,
    theme: localStorage.getItem("akira-theme") || "crimson",
    activeTab: "shop"
  };

  const themeNames = {
    crimson: "Crimson",
    midnight: "Midnight",
    ocean: "Ocean",
    emerald: "Emerald"
  };

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) {
      console.log("[AKIRA]", message);
      return;
    }

    toast.textContent = String(message);
    toast.hidden = false;
    toast.classList.add("show");

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.classList.remove("show");
      toast.hidden = true;
    }, 2600);
  }

  function getInitData() {
    return window.Telegram?.WebApp?.initData || "";
  }

  async function api(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    const initData = getInitData();
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
        throw new Error(
          `Сервер вернул не JSON (HTTP ${response.status}). Проверь API на Render.`
        );
      }
    }

    if (!response.ok) {
      throw new Error(
        data.error || data.message || `Ошибка сервера: ${response.status}`
      );
    }

    if (data && data.error) {
      throw new Error(data.error);
    }

    return data;
  }

  function firstValue(object, keys, fallback = 0) {
    for (const key of keys) {
      if (object && object[key] !== undefined && object[key] !== null) {
        return object[key];
      }
    }
    return fallback;
  }

  function playerFromResponse(data) {
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

  function formatNumber(value) {
    const number = Number(value);
    return (Number.isFinite(number) ? number : 0).toLocaleString("ru-RU");
  }

  function getBalance() {
    return Number(firstValue(state.player, [
      "balance", "coins", "money"
    ], 0));
  }

  function getEarned() {
    return Number(firstValue(state.player, [
      "total_earned", "totalEarned", "earned"
    ], 0));
  }

  function getClickPower() {
    const base = Number(firstValue(state.player, [
      "click_power", "clickPower"
    ], 1));

    const multiplier = Number(firstValue(state.player, [
      "multiplier_level", "multiplierLevel"
    ], 0));

    return Math.max(1, base * Math.pow(2, multiplier));
  }

  function getAutoPower() {
    return Number(firstValue(state.player, [
      "auto_power", "autoPower", "auto_level", "autoLevel"
    ], 0));
  }

  function renderState() {
    const player = state.player;

    const balance = getBalance();
    const earned = getEarned();
    const clickPower = getClickPower();
    const autoPower = getAutoPower();

    const balanceEl = $("#balance");
    const earnedEl = $("#total-earned");
    const clickEl = $("#click-power");
    const autoEl = $("#auto-power");

    if (balanceEl) balanceEl.textContent = formatNumber(balance);
    if (earnedEl) earnedEl.textContent = formatNumber(earned);
    if (clickEl) clickEl.textContent = `+${formatNumber(clickPower)} за клик`;
    if (autoEl) autoEl.textContent = `${formatNumber(autoPower)}/сек авто`;

    const level = Number(firstValue(player, ["level"], 1));
    const levelEl = $("#level");
    if (levelEl) levelEl.textContent = `Уровень ${level}`;

    const name = firstValue(player, [
      "name", "username", "first_name"
    ], "Игрок");

    const nameEl = $("#player-name");
    if (nameEl) nameEl.textContent = name;

    const profileBalance = $("#profile-balance");
    const profileEarned = $("#profile-earned");
    const profileClick = $("#profile-click");
    const profileAuto = $("#profile-auto");

    if (profileBalance) profileBalance.textContent = formatNumber(balance);
    if (profileEarned) profileEarned.textContent = formatNumber(earned);
    if (profileClick) profileClick.textContent = formatNumber(clickPower);
    if (profileAuto) profileAuto.textContent = formatNumber(autoPower);

    const fingerPrice = $("#finger-price");
    const autoPrice = $("#auto-price");
    const multiplierPrice = $("#multiplier-price");

    if (fingerPrice) {
      fingerPrice.textContent = formatNumber(firstValue(player, [
        "click_price", "finger_price", "next_click_price"
      ], 82));
    }

    if (autoPrice) {
      autoPrice.textContent = formatNumber(firstValue(player, [
        "auto_price", "next_auto_price"
      ], 250));
    }

    if (multiplierPrice) {
      multiplierPrice.textContent = formatNumber(firstValue(player, [
        "multiplier_price", "next_multiplier_price"
      ], 1000));
    }

    updateUpgradeButtons();
  }

  function updateUpgradeButtons() {
    const balance = getBalance();

    const prices = {
      click: Number(firstValue(state.player, [
        "click_price", "finger_price", "next_click_price"
      ], 82)),
      auto: Number(firstValue(state.player, [
        "auto_price", "next_auto_price"
      ], 250)),
      multiplier: Number(firstValue(state.player, [
        "multiplier_price", "next_multiplier_price"
      ], 1000))
    };

    $$("[data-upgrade]").forEach(button => {
      const type = button.dataset.upgrade;
      if (!(type in prices)) return;

      const price = prices[type];
      button.disabled = state.busy || balance < price;
    });
  }

  async function loadState(options = {}) {
    try {
      const data = await api("/api/state");

      const player = playerFromResponse(data);
      if (player) {
        state.player = { ...state.player, ...player };
        renderState();
      }

      if (Array.isArray(data.tasks)) {
        renderTasks(data.tasks);
      }

      if (!options.silent) {
        console.log("[AKIRA] Состояние загружено");
      }

      return data;
    } catch (error) {
      console.error("[AKIRA] Ошибка загрузки состояния:", error);
      if (!options.silent) showToast(error.message);
      throw error;
    }
  }

  function renderTasks(tasks) {
    const container = $("#tasks");
    if (!container) return;

    if (!tasks.length) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = tasks.map(task => {
      const title = escapeHtml(task.title || task.name || "Задание");
      const reward = formatNumber(task.reward || 0);

      return `
        <div class="task-item">
          <span>${title}</span>
          <span>+${reward} 🍪</span>
        </div>
      `;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  async function clickCookie() {
    const now = Date.now();

    if (state.busy || now - state.lastClick < 80) return;
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

      const player = playerFromResponse(data);
      if (player) {
        state.player = { ...state.player, ...player };
        renderState();
      } else {
        await loadState({ silent: true });
      }

      if (data.reward !== undefined && !player) {
        showFloatingReward(data.reward);
      }
    } catch (error) {
      console.error("[AKIRA] Ошибка клика:", error);
      showToast(error.message);
    }
  }

  function showFloatingReward(reward) {
    const area = $("#click-area");
    if (!area) return;

    const el = document.createElement("span");
    el.className = "floating-reward";
    el.textContent = `+${formatNumber(reward)}`;
    area.appendChild(el);

    setTimeout(() => el.remove(), 900);
  }

  async function buyUpgrade(type) {
    if (state.busy) return;

    const allowed = ["click", "auto", "multiplier"];
    if (!allowed.includes(type)) {
      showToast("Неизвестное улучшение");
      return;
    }

    state.busy = true;
    updateUpgradeButtons();

    try {
      // В сервере AKIRA покупка реализована через /api/buy.
      const data = await api("/api/buy", {
        method: "POST",
        body: JSON.stringify({
          upgrade: type,
          type
        })
      });

      const player = playerFromResponse(data);
      if (player) {
        state.player = { ...state.player, ...player };
        renderState();
      } else {
        await loadState({ silent: true });
      }

      showToast(data.message || "Улучшение куплено!");
    } catch (error) {
      console.error("[AKIRA] Ошибка покупки:", error);
      showToast(error.message || "Не удалось купить улучшение");
    } finally {
      state.busy = false;
      updateUpgradeButtons();
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

      const player = playerFromResponse(data);
      if (player) {
        state.player = { ...state.player, ...player };
        renderState();
      } else {
        await loadState({ silent: true });
      }

      showToast(data.message || "Ежедневная награда получена!");
    } catch (error) {
      console.error("[AKIRA] Ошибка ежедневной награды:", error);
      showToast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadLeaderboard() {
    const container = $("#leaderboard");
    if (!container) return;

    container.innerHTML = '<p class="loading">Загрузка рейтинга...</p>';

    try {
      const data = await api("/api/leaderboard");

      const players = Array.isArray(data)
        ? data
        : data.players || data.leaderboard || data.top || [];

      if (!players.length) {
        container.innerHTML = "<p>Пока нет игроков в рейтинге.</p>";
        return;
      }

      container.innerHTML = players.map((player, index) => {
        const rank = player.rank || index + 1;
        const name = escapeHtml(
          player.name || player.username || player.first_name || "Игрок"
        );
        const score = Number(firstValue(player, [
          "score", "balance", "coins", "total_earned"
        ], 0));

        return `
          <div class="leaderboard-item">
            <span class="leaderboard-rank">#${rank}</span>
            <strong class="leaderboard-name">${name}</strong>
            <span class="leaderboard-score">
              ${formatNumber(score)} 🍪
            </span>
          </div>
        `;
      }).join("");
    } catch (error) {
      console.error("[AKIRA] Ошибка рейтинга:", error);
      container.innerHTML =
        `<p class="error">${escapeHtml(error.message)}</p>`;
    }
  }

  function switchTab(tabName) {
    const panel = $(`#tab-${tabName}`);
    if (!panel) {
      console.warn(`[AKIRA] Не найдена вкладка tab-${tabName}`);
      showToast("Вкладка не найдена в HTML");
      return;
    }

    state.activeTab = tabName;

    $$(".nav-button").forEach(button => {
      const active = button.dataset.tab === tabName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });

    ["shop", "top", "profile", "themes"].forEach(name => {
      const tabPanel = $(`#tab-${name}`);
      if (!tabPanel) return;

      const active = name === tabName;
      tabPanel.hidden = !active;
      tabPanel.classList.toggle("active", active);
      tabPanel.setAttribute("aria-hidden", String(!active));
    });

    if (tabName === "top") {
      loadLeaderboard();
    }

    if (tabName === "profile") {
      loadState({ silent: true }).catch(() => {});
    }
  }

  function applyTheme(theme) {
    if (!themeNames[theme]) theme = "crimson";

    state.theme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("akira-theme", theme);

    $$(".theme-option").forEach(button => {
      const active = button.dataset.theme === theme;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function bindEvents() {
    const cookie = $("#cookie-button");
    if (cookie) {
      cookie.addEventListener("click", clickCookie);
    }

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

    const daily = $("#daily-button");
    if (daily) daily.addEventListener("click", claimDaily);

    $$(".theme-option[data-theme]").forEach(button => {
      button.addEventListener("click", () => {
        applyTheme(button.dataset.theme);
        showToast(`Тема «${themeNames[button.dataset.theme]}» выбрана`);
      });
    });
  }

  async function init() {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor?.("#09080d");
        tg.setBackgroundColor?.("#09080d");
      }

      applyTheme(state.theme);
      bindEvents();

      // Показываем магазин сразу, даже если сервер загружается медленно.
      switchTab("shop");

      await loadState();
      await loadLeaderboard().catch(() => {});
    } catch (error) {
      console.error("[AKIRA] Ошибка запуска:", error);
      showToast(error.message || "Не удалось загрузить игру");
    }

    // Обновляем данные, но не прерываем игру, если сервер временно недоступен.
    setInterval(() => {
      loadState({ silent: true }).catch(() => {});
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
