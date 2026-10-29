"use strict";

const API_BASE = "/api";

const THEMES = ["crimson", "midnight", "ocean", "emerald"];
const DEFAULT_THEME = "crimson";

const state = {
  player: {},
  prices: {},
  loading: false,
  currentTab: "shop",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function number(value) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function formatNumber(value) {
  return Math.floor(number(value)).toLocaleString("ru-RU");
}

function showToast(message) {
  const toast = $("#toast");

  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show", "active");
  toast.classList.remove("hidden");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show", "active");
  }, 2200);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined
      ? undefined
      : JSON.stringify(options.body),
  });

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Сервер вернул не JSON (HTTP ${response.status}). Проверь ответ сервера.`
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Ошибка сервера: HTTP ${response.status}`
    );
  }

  return data;
}

/* =========================
   ТЕМЫ
========================= */

function normalizeTheme(theme) {
  return THEMES.includes(theme) ? theme : DEFAULT_THEME;
}

function applyTheme(theme, notify = false) {
  const selectedTheme = normalizeTheme(theme);

  document.documentElement.dataset.theme = selectedTheme;

  if (document.body) {
    document.body.dataset.theme = selectedTheme;
  }

  try {
    localStorage.setItem("akira-theme", selectedTheme);
  } catch (error) {
    console.warn("Не удалось сохранить тему:", error);
  }

  $$(".theme-option").forEach((button) => {
    const selected = button.dataset.theme === selectedTheme;

    button.classList.toggle("active", selected);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  if (notify) {
    showToast("Тема изменена");
  }
}

function initThemes() {
  let savedTheme = DEFAULT_THEME;

  try {
    savedTheme = localStorage.getItem("akira-theme") || DEFAULT_THEME;
  } catch (error) {
    console.warn("Не удалось прочитать тему:", error);
  }

  applyTheme(savedTheme);

  $$(".theme-option").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.theme, true);
    });
  });
}

/* =========================
   ИГРОК И ОТОБРАЖЕНИЕ
========================= */

function getPlayer() {
  return state.player || {};
}

function getBalance() {
  return number(getPlayer().balance);
}

function getClickPower() {
  const player = getPlayer();

  const power = number(
    player.click_power ?? player.clickPower ?? 1
  );

  const multiplierLevel = number(
    player.multiplier_level ?? player.multiplierLevel
  );

  return power * Math.pow(2, multiplierLevel);
}

function getAutoPower() {
  const player = getPlayer();

  if (player.auto_power !== undefined) {
    return number(player.auto_power);
  }

  if (player.autoPower !== undefined) {
    return number(player.autoPower);
  }

  return number(player.auto_level ?? player.autoLevel);
}

function renderState(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Сервер вернул пустое состояние игры");
  }

  state.player = data.player || data;
  state.prices = data.prices || state.player.prices || {};

  const player = getPlayer();

  const balance = $("#balance");
  if (balance) {
    balance.textContent = formatNumber(player.balance);
  }

  const totalEarned = $("#total-earned");
  if (totalEarned) {
    totalEarned.textContent = formatNumber(
      player.total_earned ?? player.totalEarned
    );
  }

  const level = $("#level");
  if (level) {
    level.textContent = player.level ?? 1;
  }

  const clickPower = $("#click-power");
  if (clickPower) {
    clickPower.textContent = formatNumber(getClickPower());
  }

  const autoPower = $("#auto-power");
  if (autoPower) {
    autoPower.textContent = formatNumber(getAutoPower());
  }

  const profileBalance = $("#profile-balance");
  if (profileBalance) {
    profileBalance.textContent = formatNumber(player.balance);
  }

  const profileEarned = $("#profile-earned");
  if (profileEarned) {
    profileEarned.textContent = formatNumber(
      player.total_earned ?? player.totalEarned
    );
  }

  const profileClick = $("#profile-click");
  if (profileClick) {
    profileClick.textContent = formatNumber(getClickPower());
  }

  const profileAuto = $("#profile-auto");
  if (profileAuto) {
    profileAuto.textContent = formatNumber(getAutoPower());
  }

  const playerName = $("#player-name");
  if (playerName) {
    playerName.textContent =
      player.name || player.username || "Игрок AKIRA";
  }

  updateUpgradePrices();
}

function updateUpgradePrices() {
  const priceElements = {
    click: $("#finger-price"),
    auto: $("#auto-price"),
    multiplier: $("#multiplier-price"),
  };

  for (const [type, element] of Object.entries(priceElements)) {
    if (!element) continue;

    const price = state.prices[type];

    if (price !== undefined && price !== null) {
      element.textContent = formatNumber(
        typeof price === "object" ? price.price : price
      );
    }
  }
}

async function loadState() {
  try {
    const data = await api("/state");
    renderState(data);
  } catch (error) {
    console.error("Ошибка загрузки состояния:", error);
    showToast(error.message || "Не удалось загрузить игру");
  }
}

/* =========================
   КЛИКЕР
========================= */

function animateCookie() {
  const button = $("#cookie-button");
  if (!button) return;

  button.classList.remove("clicked");

  // Перезапускаем CSS-анимацию клика.
  void button.offsetWidth;

  button.classList.add("clicked");

  setTimeout(() => {
    button.classList.remove("clicked");
  }, 180);
}

async function clickCookie() {
  if (state.loading) return;

  animateCookie();

  try {
    const data = await api("/click", {
      method: "POST",
      body: {},
    });

    if (data.player || data.balance !== undefined) {
      renderState(data);
    } else {
      await loadState();
    }
  } catch (error) {
    console.error("Ошибка клика:", error);
    showToast(error.message || "Не удалось выполнить клик");
  }
}

/* =========================
   ПОКУПКА УЛУЧШЕНИЙ
========================= */

async function buyUpgrade(type) {
  if (state.loading) return;

  state.loading = true;

  try {
    let data;

    try {
      data = await api("/upgrades", {
        method: "POST",
        body: {
          type,
          upgrade: type,
        },
      });
    } catch (error) {
      if (
        !String(error.message).includes("404") &&
        !String(error.message).includes("405")
      ) {
        throw error;
      }

      data = await api("/buy", {
        method: "POST",
        body: {
          type,
          upgrade: type,
        },
      });
    }

    if (data.player || data.balance !== undefined) {
      renderState(data);
    } else {
      await loadState();
    }

    showToast("Улучшение куплено!");
  } catch (error) {
    console.error("Ошибка покупки:", error);
    showToast(error.message || "Не удалось купить улучшение");
  } finally {
    state.loading = false;
  }
}

/* =========================
   ЕЖЕДНЕВНАЯ НАГРАДА
========================= */

async function claimDailyReward() {
  const button = $("#daily-button");

  if (button?.disabled) return;

  try {
    const data = await api("/daily", {
      method: "POST",
      body: {},
    });

    if (data.player || data.balance !== undefined) {
      renderState(data);
    } else {
      await loadState();
    }

    showToast(data.message || "Ежедневная награда получена!");
  } catch (error) {
    console.error("Ошибка ежедневной награды:", error);
    showToast(error.message || "Не удалось получить награду");
  }
}

/* =========================
   ВКЛАДКИ
========================= */

function switchTab(tabName) {
  const validTabs = ["shop", "top", "profile", "themes"];

  if (!validTabs.includes(tabName)) return;

  state.currentTab = tabName;

  $$(".nav-button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.tab === tabName
    );
  });

  validTabs.forEach((name) => {
    const panel = $(`#tab-${name}`);
    if (!panel) return;

    const visible = name === tabName;

    panel.hidden = !visible;
    panel.classList.toggle("active", visible);
    panel.style.display = visible ? "" : "none";
  });

  if (tabName === "top") {
    loadLeaderboard();
  }

  if (tabName === "profile") {
    loadState();
  }
}

/* =========================
   ТАБЛИЦА ЛИДЕРОВ
========================= */

async function loadLeaderboard() {
  const container = $("#leaderboard");
  if (!container) return;

  container.textContent = "Загрузка рейтинга…";

  try {
    const data = await api("/leaderboard");

    const players = Array.isArray(data)
      ? data
      : data.players || data.leaderboard || [];

    container.replaceChildren();

    if (!players.length) {
      container.textContent = "Пока нет игроков в рейтинге";
      return;
    }

    players.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${index + 1}`;

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent =
        player.name || player.username || "Игрок";

      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = formatNumber(
        player.total_earned ??
        player.totalEarned ??
        player.balance
      );

      row.append(rank, name, score);
      container.appendChild(row);
    });
  } catch (error) {
    console.error("Ошибка рейтинга:", error);

    container.textContent =
      error.message || "Не удалось загрузить рейтинг";
  }
}

/* =========================
   ОБРАБОТЧИКИ КНОПОК
========================= */

function initEventHandlers() {
  const cookieButton = $("#cookie-button");

  if (cookieButton) {
    cookieButton.addEventListener("click", clickCookie);
  }

  $$("[data-upgrade]").forEach((button) => {
    button.addEventListener("click", () => {
      buyUpgrade(button.dataset.upgrade);
    });
  });

  $$(".nav-button[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      switchTab(button.dataset.tab);
    });
  });

  const dailyButton = $("#daily-button");

  if (dailyButton) {
    dailyButton.addEventListener("click", claimDailyReward);
  }
}

/* =========================
   ЗАПУСК ПРИЛОЖЕНИЯ
========================= */

function init() {
  initThemes();
  initEventHandlers();

  // При открытии показываем магазин.
  switchTab("shop");

  // Загружаем данные игрока с сервера.
  loadState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
