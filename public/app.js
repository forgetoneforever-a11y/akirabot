"use strict";

const API_BASE = "/api";

const THEMES = ["crimson", "midnight", "ocean", "emerald"];
const DEFAULT_THEME = "crimson";
const TABS = ["shop", "top", "profile", "themes", "games"];

const state = {
  player: {},
  prices: {},
  loading: false,
  currentTab: "shop",
  selectedGame: null,
  gameMode: "bot",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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

  toast.textContent = String(message);
  toast.hidden = false;
  toast.classList.add("show", "active");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show", "active");
    if (!toast.classList.contains("akira-toast")) {
      toast.hidden = true;
    }
  }, 2400);
}

async function api(path, options = {}) {
  const telegram = window.Telegram?.WebApp;
  const initData = telegram?.initData || "";

  const headers = {
    "Content-Type": "application/json",
    ...(initData ? { "X-Telegram-Init-Data": initData } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Сервер вернул неверный ответ (HTTP ${response.status})`);
    }
  }

  if (!response.ok) {
    throw new Error(
      data.error || data.message || `Ошибка сервера: HTTP ${response.status}`
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
  document.body.dataset.theme = selectedTheme;

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

  if (notify) showToast("Тема изменена");
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
   ИГРОК И СОСТОЯНИЕ
========================= */

function getPlayer() {
  return state.player || {};
}

function getBalance() {
  return number(getPlayer().balance);
}

function getClickPower() {
  const player = getPlayer();
  const power = number(player.click_power ?? player.clickPower ?? 1);
  const multiplierLevel = number(
    player.multiplier_level ?? player.multiplierLevel
  );

  return power * Math.pow(2, multiplierLevel);
}

function getAutoPower() {
  const player = getPlayer();

  return number(
    player.auto_power ??
    player.autoPower ??
    player.auto_level ??
    player.autoLevel
  );
}

function getAvatarUrl(player = getPlayer()) {
  return player.avatar_url || player.avatarUrl || "/avatar-default.svg";
}

function renderState(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Сервер вернул пустое состояние игры");
  }

  state.player = data.player || data;
  state.prices = data.prices || state.player.prices || {};

  const player = getPlayer();

  setText("#balance", formatNumber(player.balance));
  setText("#total-earned", formatNumber(player.total_earned ?? player.totalEarned));
  setText("#level", player.level ?? 1);
  setText("#click-power", formatNumber(getClickPower()));
  setText("#auto-power", formatNumber(getAutoPower()));

  setText("#profile-balance", formatNumber(player.balance));
  setText("#profile-earned", formatNumber(player.total_earned ?? player.totalEarned));
  setText("#profile-click", formatNumber(getClickPower()));
  setText("#profile-auto", `${formatNumber(getAutoPower())}/с`);

  setText(
    "#player-name",
    player.name || player.username || "Игрок AKIRA"
  );

  const nameInput = $("#profile-name-input");
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = player.name || player.username || "";
  }

  const avatar = $("#profile-avatar");
  if (avatar) {
    avatar.src = getAvatarUrl(player);
    avatar.onerror = () => {
      avatar.onerror = null;
      avatar.src = "/avatar-default.svg";
    };
  }

  updateUpgradePrices();

  document.dispatchEvent(
    new CustomEvent("akira:state-updated", { detail: { player } })
  );
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = String(value ?? "");
}

function updateUpgradePrices() {
  const aliases = {
    click: ["#finger-price", "click_price"],
    auto: ["#auto-price", "auto_price"],
    multiplier: ["#multiplier-price", "multiplier_price"],
  };

  for (const [type, [selector, playerKey]] of Object.entries(aliases)) {
    const element = $(selector);
    if (!element) continue;

    const price =
      state.prices[type]?.price ??
      state.prices[type] ??
      getPlayer()[playerKey];

    if (price !== undefined && price !== null) {
      element.textContent = formatNumber(price);
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

  button.classList.remove("clicked", "click-bounce");
  void button.offsetWidth;
  button.classList.add("clicked", "click-bounce");

  setTimeout(() => {
    button.classList.remove("clicked", "click-bounce");
  }, 180);
}

function createClickPopup(event, reward) {
  const popup = document.createElement("div");
  popup.className = "click-popup";
  popup.textContent = `+${formatNumber(reward)}`;

  const button = $("#cookie-button");
  const rect = button?.getBoundingClientRect();

  popup.style.left = `${event?.clientX || (rect ? rect.left + rect.width / 2 : window.innerWidth / 2)}px`;
  popup.style.top = `${event?.clientY || (rect ? rect.top + rect.height / 2 : window.innerHeight / 2)}px`;

  document.body.appendChild(popup);

  requestAnimationFrame(() => popup.classList.add("animate"));
  setTimeout(() => popup.remove(), 800);
}

async function clickCookie(event) {
  if (state.loading) return;

  animateCookie();

  try {
    const data = await api("/click", {
      method: "POST",
      body: {},
    });

    createClickPopup(event, data.reward ?? getClickPower());

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
   УЛУЧШЕНИЯ
========================= */

async function buyUpgrade(type) {
  if (state.loading) return;

  state.loading = true;

  const buttons = $$("[data-upgrade]");
  buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const data = await api("/upgrades", {
      method: "POST",
      body: { type, upgrade: type },
    });

    if (data.player || data.balance !== undefined) {
      renderState(data);
    } else {
      await loadState();
    }

    showToast(data.message || "Улучшение куплено!");
  } catch (error) {
    console.error("Ошибка покупки:", error);
    showToast(error.message || "Не удалось купить улучшение");
  } finally {
    state.loading = false;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

/* =========================
   ЕЖЕДНЕВНАЯ НАГРАДА
========================= */

async function claimDailyReward() {
  const button = $("#daily-button");
  if (button?.disabled) return;

  if (button) button.disabled = true;

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
  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================
   ВКЛАДКИ И СВАЙПЫ
========================= */

// Делаем переключение вкладок доступным и другим модулям приложения.
window.switchTab = switchTab;

function switchTab(tabName, direction = 0) {
  if (!TABS.includes(tabName)) return;

  const oldIndex = TABS.indexOf(state.currentTab);
  const newIndex = TABS.indexOf(tabName);

  if (oldIndex === newIndex && tabName === state.currentTab) return;

  state.currentTab = tabName;
  document.body.classList.toggle("games-fullscreen", tabName === "games");

  $(".nav-button[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  TABS.forEach((name) => {
    const panel = $(`#tab-${name}`);
    if (!panel) return;

    const visible = name === tabName;
    panel.hidden = !visible;
    panel.classList.toggle("active", visible);
    panel.style.display = visible ? "" : "none";

    panel.classList.remove("tab-enter-left", "tab-enter-right");

    if (visible) {
      const sign = direction || (newIndex >= oldIndex ? 1 : -1);
      panel.classList.add(sign >= 0 ? "tab-enter-right" : "tab-enter-left");
    }
  });

  if (tabName === "top") loadLeaderboard();
  if (tabName === "profile") loadState();
}

function initSwipeNavigation() {
  const app = $("#app");
  if (!app) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  app.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) {
      tracking = false;
      return;
    }

    const target = event.target;
    if (
      target.closest("button, input, textarea, select, a, label, .chess-board, .durak-table")
    ) {
      tracking = false;
      return;
    }

    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  app.addEventListener("touchend", (event) => {
    if (!tracking || !event.changedTouches.length) return;
    tracking = false;

    const dx = event.changedTouches[0].clientX - startX;
    const dy = event.changedTouches[0].clientY - startY;

    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return;

    const index = TABS.indexOf(state.currentTab);
    const nextIndex = dx < 0
      ? Math.min(TABS.length - 1, index + 1)
      : Math.max(0, index - 1);

    if (nextIndex !== index) {
      switchTab(TABS[nextIndex], dx < 0 ? 1 : -1);
    }
  }, { passive: true });
}

/* =========================
   РЕЙТИНГ
========================= */

async function loadLeaderboard() {
  const container = $("#leaderboard");
  if (!container) return;

  container.replaceChildren();

  const loading = document.createElement("p");
  loading.className = "section-description";
  loading.textContent = "Загрузка рейтинга…";
  container.appendChild(loading);

  try {
    const data = await api("/leaderboard");
    const players = Array.isArray(data)
      ? data
      : data.players || data.leaderboard || [];

    container.replaceChildren();

    if (!players.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Пока нет игроков в рейтинге";
      container.appendChild(empty);
      return;
    }

    players.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${player.rank ?? index + 1}`;

      const avatar = document.createElement("img");
      avatar.className = "leaderboard-avatar";
      avatar.src = getAvatarUrl(player);
      avatar.alt = "";
      avatar.loading = "lazy";
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = "/avatar-default.svg";
      };

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = player.name || player.username || "Игрок";

      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = formatNumber(
        player.total_earned ?? player.totalEarned ?? player.score ?? player.balance
      );

      row.append(rank, avatar, name, score);
      container.appendChild(row);
    });
  } catch (error) {
    console.error("Ошибка рейтинга:", error);
    container.replaceChildren();

    const message = document.createElement("div");
    message.className = "empty-state";
    message.textContent = error.message || "Не удалось загрузить рейтинг";
    container.appendChild(message);
  }
}

/* =========================
   ПРОФИЛЬ
========================= */

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));

    reader.readAsDataURL(file);
  });
}

async function saveProfile(event) {
  event?.preventDefault();

  const nameInput = $("#profile-name-input");
  const avatarInput = $("#profile-avatar-input");
  const saveButton = $("#profile-save-button");

  const name = String(nameInput?.value || "").trim();

  if (!name || name.length > 24) {
    showToast("Имя должно содержать от 1 до 24 символов");
    nameInput?.focus();
    return;
  }

  let avatarUrl = getPlayer().avatar_url || null;
  const file = avatarInput?.files?.[0];

  if (file) {
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      showToast("Выбери PNG, JPG, WEBP или GIF");
      return;
    }

    if (file.size > 1024 * 1024) {
      showToast("Изображение должно быть меньше 1 МБ");
      return;
    }

    try {
      avatarUrl = await fileToDataUrl(file);
    } catch (error) {
      showToast(error.message);
      return;
    }
  }

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Сохраняем…";
  }

  try {
    const data = await api("/profile", {
      method: "PATCH",
      body: { name, avatar_url: avatarUrl },
    });

    if (data.player) renderState(data);
    else await loadState();

    if (avatarInput) avatarInput.value = "";

    showToast("Профиль сохранён");
  } catch (error) {
    console.error("Ошибка сохранения профиля:", error);
    showToast(error.message || "Не удалось сохранить профиль");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "💾 Сохранить профиль";
    }
  }
}

async function resetAvatar() {
  const name = String($("#profile-name-input")?.value || getPlayer().name || "").trim();

  try {
    const data = await api("/profile", {
      method: "PATCH",
      body: { name: name || "Игрок", avatar_url: null },
    });

    if (data.player) renderState(data);
    else await loadState();

    const input = $("#profile-avatar-input");
    if (input) input.value = "";

    showToast("Установлена стандартная аватарка");
  } catch (error) {
    console.error("Ошибка сброса аватарки:", error);
    showToast(error.message || "Не удалось изменить аватарку");
  }
}

/* =========================
   МИНИ-ИГРЫ — МЕНЮ
========================= */

function openGameMenu(game) {
  state.selectedGame = game;

  const title = $("#game-menu-title");
  const description = $("#game-menu-description");
  const panel = $("#game-menu-panel");

  if (title) title.textContent = game === "durak" ? "🃏 Дурак" : "♟️ Шахматы";

  if (description) {
    description.textContent = game === "durak"
      ? "Выбери подкидной или переводной режим, затем игру с ботом или онлайн."
      : "Играй против бота или найди соперника онлайн.";
  }

  if (panel) panel.hidden = false;

  const durakSettings = $("#durak-mode")?.closest("label") || $("#durak-mode");
  const chessSettings = $("#chess-color")?.closest("label") || $("#chess-color");

  if (durakSettings) durakSettings.hidden = game !== "durak";
  if ($("#durak-mode")) $("#durak-mode").hidden = game !== "durak";
  if ($("#chess-color")) $("#chess-color").hidden = game !== "chess";

  const diff = $("#game-difficulty");
  if (diff) diff.hidden = false;

  $("#durak-game-panel")?.setAttribute("hidden", "");
  $("#chess-game-panel")?.setAttribute("hidden", "");
  panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function startSelectedGame(mode) {
  state.gameMode = mode;

  if (!state.selectedGame) {
    showToast("Сначала выбери игру");
    return;
  }

  const detail = {
    game: state.selectedGame,
    mode,
    difficulty: $("#game-difficulty")?.value || "easy",
    durakMode: $("#durak-mode")?.value || "throw-in",
    chessColor: $("#chess-color")?.value || "white",
  };

  document.dispatchEvent(new CustomEvent("akira:start-game", { detail }));

  if (state.selectedGame === "durak") {
    if (typeof window.startDurakGame === "function") {
      window.startDurakGame(detail);
    } else {
      showToast("Модуль «Дурак» ещё не загружен");
    }
  } else if (state.selectedGame === "chess") {
    if (typeof window.startChessGame === "function") {
      window.startChessGame(detail);
    } else {
      showToast("Шахматный модуль ещё не загружен");
    }
  }
}

/* =========================
   ОБРАБОТЧИКИ
========================= */

function initEventHandlers() {
  $("#cookie-button")?.addEventListener("click", clickCookie);

  $$("[data-upgrade]").forEach((button) => {
    button.addEventListener("click", () => buyUpgrade(button.dataset.upgrade));
  });

  // Делегирование кликов: навигация продолжит работать даже после обновления DOM.
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-button[data-tab]");
    if (!button) return;
    event.preventDefault();
    switchTab(button.dataset.tab);
  });

  $("#daily-button")?.addEventListener("click", claimDailyReward);
}

/* =========================
   ЗАПУСК
========================= */

function init() {
  const telegram = window.Telegram?.WebApp;

  try {
    telegram?.ready();
    telegram?.expand();
    telegram?.setHeaderColor?.("#170b12");
    telegram?.setBackgroundColor?.("#170b12");
  } catch (error) {
    console.warn("Telegram WebApp init:", error);
  }

  initThemes();
  initEventHandlers();
  initSwipeNavigation();

  switchTab("shop");
  loadState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
