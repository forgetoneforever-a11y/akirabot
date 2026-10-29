(() => {
  "use strict";

  const API = "/api";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  let player = null;
  let busy = false;
  let refreshTimer = null;

  const tasks = [];
  const leaderboard = [];

  // -----------------------------
  // TELEGRAM
  // -----------------------------

  const tg = window.Telegram?.WebApp;

  if (tg) {
    tg.ready();
    tg.expand();

    try {
      tg.setHeaderColor("#09090d");
      tg.setBackgroundColor("#09090d");
    } catch (_) {}
  }

  function haptic(type = "light") {
    try {
      if (type === "success") {
        tg?.HapticFeedback?.notificationOccurred("success");
      } else {
        tg?.HapticFeedback?.impactOccurred(type);
      }
    } catch (_) {}
  }

  // -----------------------------
  // API
  // -----------------------------

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (tg?.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }

    const response = await fetch(API + path, {
      ...options,
      headers,
      cache: "no-store"
    });

    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      throw new Error("Сервер вернул некорректный ответ");
    }

    if (!response.ok) {
      throw new Error(
        data.error || data.message || `Ошибка сервера: ${response.status}`
      );
    }

    return data;
  }

  function showToast(message, type = "info") {
    const toast = $("#toast");
    if (!toast) {
      console.log(message);
      return;
    }

    toast.textContent = message;
    toast.hidden = false;
    toast.dataset.type = type;

    clearTimeout(showToast.timer);

    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    showToast.timer = setTimeout(() => {
      toast.classList.remove("show");

      setTimeout(() => {
        toast.hidden = true;
      }, 250);
    }, 2400);
  }

  function number(value) {
    return Math.floor(Number(value) || 0).toLocaleString("ru-RU");
  }

  function setText(selector, value) {
    $$(selector).forEach((element) => {
      element.textContent = value;
    });
  }

  // -----------------------------
  // PLAYER / BALANCE
  // -----------------------------

  function getClickReward() {
    if (!player) return 1;

    if (player.clickReward != null) {
      return Number(player.clickReward);
    }

    return (
      Number(player.click_power || 1) *
      Math.pow(2, Number(player.multiplier_level || 0))
    );
  }

  function getAutoPower() {
    if (!player) return 0;

    if (player.autoPowerPerSecond != null) {
      return Number(player.autoPowerPerSecond);
    }

    return (
      Number(player.auto_level || 0) *
      Math.pow(2, Number(player.multiplier_level || 0))
    );
  }

  function renderPlayer() {
    if (!player) return;

    const balance = number(player.coins);
    const earned = number(player.total_earned);
    const click = number(getClickReward());
    const auto = number(getAutoPower());

    setText("#balance", balance);
    setText("#total-earned", earned);
    setText("#level", number(player.level || 1));

    setText("#click-power", click);
    setText("#auto-power", auto);

    setText("#player-name", player.name || "Игрок");
    setText("#profile-balance", balance);
    setText("#profile-earned", earned);
    setText("#profile-click", click);
    setText("#profile-auto", `${auto}/с`);

    renderUpgradePrices();
  }

  // -----------------------------
  // UPGRADE PRICES
  // -----------------------------

  const upgradeConfig = {
    click: {
      base: 50,
      factor: 1.65,
      max: 100,
      level: () => Number(player?.click_power || 1),
      priceElement: "#finger-price"
    },
    auto: {
      base: 250,
      factor: 1.8,
      max: 50,
      level: () => Number(player?.auto_level || 0),
      priceElement: "#auto-price"
    },
    multiplier: {
      base: 1000,
      factor: 2.1,
      max: 25,
      level: () => Number(player?.multiplier_level || 0),
      priceElement: "#multiplier-price"
    }
  };

  function upgradeCost(type) {
    const config = upgradeConfig[type];
    if (!config) return Infinity;

    return Math.floor(
      config.base * Math.pow(config.factor, config.level())
    );
  }

  function renderUpgradePrices() {
    if (!player) return;

    Object.entries(upgradeConfig).forEach(([type, config]) => {
      const level = config.level();
      const maxed = level >= config.max;
      const cost = upgradeCost(type);

      setText(
        config.priceElement,
        maxed ? "МАКС." : number(cost)
      );

      $$(`[data-upgrade="${type}"]`).forEach((button) => {
        button.disabled =
          busy ||
          maxed ||
          Number(player.coins || 0) < cost;

        button.classList.toggle("is-max", maxed);
      });
    });
  }

  // -----------------------------
  // FLOATING +COINS
  // -----------------------------

  function showFloatingCoins(element, amount) {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const popup = document.createElement("div");

    popup.className = "click-popup";
    popup.textContent = `+${number(amount)}`;

    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${rect.top + rect.height / 2}px`;

    document.body.appendChild(popup);

    requestAnimationFrame(() => {
      popup.classList.add("animate");
    });

    setTimeout(() => popup.remove(), 1000);
  }

  // -----------------------------
  // CLICK COOKIE
  // -----------------------------

  async function clickCookie() {
    if (busy) return;

    const button = $("#cookie-button");
    if (!button) {
      showToast("Не найдена кнопка печеньки", "error");
      return;
    }

    busy = true;
    button.classList.add("loading");
    renderUpgradePrices();

    try {
      const data = await api("/click", {
        method: "POST",
        body: JSON.stringify({})
      });

      if (data.player) {
        player = data.player;
      } else if (data.state?.player) {
        player = data.state.player;
      } else if (player) {
        const reward = Number(
          data.reward ?? data.earned ?? data.amount ?? getClickReward()
        );

        player.coins = Number(player.coins || 0) + reward;
        player.total_earned =
          Number(player.total_earned || 0) + reward;

        player.total_clicks =
          Number(player.total_clicks || 0) + 1;
      }

      const reward = Number(
        data.reward ??
        data.earned ??
        data.amount ??
        data.clickReward ??
        getClickReward()
      );

      renderPlayer();
      showFloatingCoins(button, reward);
      haptic("light");
    } catch (error) {
      console.error("Click error:", error);
      showToast(error.message || "Ошибка клика", "error");
    } finally {
      busy = false;
      button.classList.remove("loading");
      renderUpgradePrices();
    }
  }

  // -----------------------------
  // UPGRADES
  // -----------------------------

  async function buyUpgrade(type, button) {
    if (busy) return;

    if (!upgradeConfig[type]) {
      showToast("Неизвестное улучшение", "error");
      return;
    }

    busy = true;
    if (button) button.classList.add("loading");

    renderUpgradePrices();

    try {
      const data = await api("/upgrades", {
        method: "POST",
        body: JSON.stringify({ type })
      });

      if (data.player) {
        player = data.player;
      } else if (data.state?.player) {
        player = data.state.player;
      }

      await loadState();

      showToast(data.message || "Улучшение куплено!", "success");
      haptic("success");
    } catch (error) {
      console.error("Upgrade error:", error);
      showToast(error.message || "Не удалось купить улучшение", "error");
    } finally {
      busy = false;
      if (button) button.classList.remove("loading");
      renderPlayer();
    }
  }

  // -----------------------------
  // DAILY REWARD
  // -----------------------------

  async function claimDaily() {
    if (busy) return;

    const button = $("#daily-button");

    busy = true;
    if (button) button.disabled = true;

    try {
      const data = await api("/daily", {
        method: "POST",
        body: JSON.stringify({})
      });

      if (data.player) player = data.player;

      await loadState();

      const reward = data.reward ?? data.amount;

      showToast(
        reward != null
          ? `Получено +${number(reward)} монет!`
          : data.message || "Награда получена!",
        "success"
      );

      haptic("success");
    } catch (error) {
      showToast(error.message || "Не удалось получить награду", "error");
    } finally {
      busy = false;
      if (button) button.disabled = false;
      renderUpgradePrices();
    }
  }

  // -----------------------------
  // TABS
  // -----------------------------

  function openTab(name) {
    const target = $(`#tab-${name}`);

    if (!target) {
      showToast("Раздел не найден", "error");
      return;
    }

    $$(".nav-button").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.tab === name
      );
    });

    $$(".tab-content").forEach((section) => {
      section.hidden = section.id !== `tab-${name}`;
    });

    haptic("light");

    if (name === "top") loadLeaderboard();
    if (name === "profile") loadState();
  }

  // -----------------------------
  // THEMES
  // -----------------------------

  function setTheme(theme) {
    const allowed = ["crimson", "midnight", "ocean", "emerald"];

    if (!allowed.includes(theme)) return;

    document.body.dataset.theme = theme;

    $$(".theme-option").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.theme === theme
      );
    });

    try {
      localStorage.setItem("akira-theme", theme);
    } catch (_) {}

    haptic("light");
    showToast(`Тема ${theme} применена`, "success");
  }

  function initTheme() {
    let savedTheme = "crimson";

    try {
      savedTheme = localStorage.getItem("akira-theme") || "crimson";
    } catch (_) {}

    setTheme(savedTheme);
  }

  // -----------------------------
  // LEADERBOARD
  // -----------------------------

  async function loadLeaderboard() {
    const container = $("#leaderboard");
    if (!container) return;

    try {
      const data = await api("/leaderboard");

      const entries = Array.isArray(data)
        ? data
        : data.leaderboard || data.players || [];

      container.replaceChildren();

      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "section-description";
        empty.textContent = "Пока нет игроков в рейтинге";
        container.appendChild(empty);
        return;
      }

      entries.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "leaderboard-row";

        const rank = document.createElement("span");
        rank.className = "leaderboard-rank";
        rank.textContent = `#${index + 1}`;

        const name = document.createElement("span");
        name.className = "leaderboard-name";
        name.textContent = entry.name || `Игрок ${index + 1}`;

        const coins = document.createElement("span");
        coins.className = "leaderboard-coins";
        coins.textContent = number(entry.coins);

        row.append(rank, name, coins);
        container.appendChild(row);
      });
    } catch (error) {
      console.error("Leaderboard error:", error);
      container.textContent = "Не удалось загрузить рейтинг";
    }
  }

  // -----------------------------
  // STATE
  // -----------------------------

  async function loadState() {
    const data = await api("/state");

    player = data.player || data;

    renderPlayer();

    return data;
  }

  // -----------------------------
  // EVENT HANDLERS
  // -----------------------------

  function bindEvents() {
    // Печенька
    $("#cookie-button")?.addEventListener("click", clickCookie);

    // Навигация
    $$(".nav-button[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        openTab(button.dataset.tab);
      });
    });

    // Улучшения
    $$("[data-upgrade]").forEach((button) => {
      button.addEventListener("click", () => {
        buyUpgrade(button.dataset.upgrade, button);
      });
    });

    // Ежедневная награда
    $("#daily-button")?.addEventListener("click", claimDaily);

    // Темы
    $$(".theme-option[data-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        setTheme(button.dataset.theme);
      });
    });

    // Обновление после возвращения в приложение
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        loadState().catch((error) => {
          console.error("Refresh error:", error);
        });

        const activeTab = $(".nav-button.active")?.dataset.tab;

        if (activeTab === "top") {
          loadLeaderboard();
        }
      }
    });
  }

  // -----------------------------
  // START
  // -----------------------------

  async function init() {
    bindEvents();
    initTheme();

    try {
      await loadState();

      // Не запускаем повторные интервалы.
      clearInterval(refreshTimer);

      refreshTimer = setInterval(() => {
        if (!document.hidden) {
          loadState().catch((error) => {
            console.error("Auto refresh error:", error);
          });
        }
      }, 15000);
    } catch (error) {
      console.error("AKIRA initialization error:", error);
      showToast(
        error.message || "Не удалось подключиться к серверу",
        "error"
      );
    }
  }

  // Функции для проверки из консоли браузера.
  window.AKIRA = {
    loadState,
    loadLeaderboard,
    clickCookie,
    buyUpgrade,
    claimDaily,
    openTab,
    setTheme
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
