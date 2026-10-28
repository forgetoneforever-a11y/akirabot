(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const state = {
    coins: 0,
    totalEarned: 0,
    earned: 0,
    clickPower: 1,
    power: 1,
    autoLevel: 0,
    multiplierLevel: 0,
    multiplier: 1,
    streak: 0,
    name: "Игрок",
  };

  let busy = false;
  let lastClick = 0;

  async function api(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(tg?.initData
        ? { "X-Telegram-Init-Data": tg.initData }
        : {}),
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || "Ошибка сервера");
    }

    return data;
  }

  function notify(message) {
    const toast = $("#toast");

    if (toast) {
      toast.textContent = message;
      toast.classList.add("show");

      clearTimeout(notify.timer);
      notify.timer = setTimeout(() => {
        toast.classList.remove("show");
      }, 2500);
    } else {
      console.log(message);
    }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 1,
    }).format(Number(value) || 0);
  }

  function mergeState(data) {
    const player = data?.player || data?.state || data;

    if (!player || typeof player !== "object") return;

    for (const key of [
      "coins",
      "totalEarned",
      "earned",
      "clickPower",
      "power",
      "autoLevel",
      "multiplierLevel",
      "multiplier",
      "streak",
      "name",
    ]) {
      if (player[key] !== undefined) {
        state[key] = player[key];
      }
    }

    updateUI();
  }

  function updateUI() {
    const coins = Number(state.coins) || 0;
    const total = Number(state.totalEarned) || 0;
    const power = Number(state.clickPower ?? state.power) || 1;

    const values = {
      "#balance": formatNumber(coins),
      "#total-earned": formatNumber(total),
      "#click-power": formatNumber(power),
      "#auto-power": formatNumber(state.autoLevel || 0),
      "#level": formatNumber(
        Math.max(1, Math.floor(total / 1000) + 1)
      ),
    };

    for (const [selector, value] of Object.entries(values)) {
      const element = $(selector);
      if (element) element.textContent = value;
    }

    const nameElement = $("#player-name");
    if (nameElement) {
      nameElement.textContent = state.name || "Игрок";
    }

    updateUpgradeButtons();
  }

  function updateUpgradeButtons() {
    $$("[data-upgrade]").forEach((button) => {
      const type = button.dataset.upgrade;
      const cost = getUpgradeCost(type);

      button.disabled = Number(state.coins) < cost;
    });
  }

  function getUpgradeCost(type) {
    if (type === "click" || type === "power") {
      return Math.floor(
        50 * Math.pow(1.65, Math.max(0, Number(state.power || 1) - 1))
      );
    }

    if (type === "auto") {
      return Math.floor(
        250 * Math.pow(1.8, Number(state.autoLevel || 0))
      );
    }

    if (type === "multiplier") {
      const level = Number(
        state.multiplierLevel || Math.max(0, Number(state.multiplier || 1) - 1)
      );

      return Math.floor(1000 * Math.pow(2.1, level));
    }

    return 0;
  }

  async function loadState() {
    try {
      const data = await api("/api/state");
      mergeState(data);
    } catch (error) {
      console.error("Не удалось загрузить состояние:", error);
      notify("Не удалось загрузить данные");
    }
  }

  async function clickCoin() {
    const now = Date.now();

    if (busy || now - lastClick < 80) return;

    lastClick = now;
    busy = true;

    const button = $("#cookie-button");

    if (button) {
      button.classList.remove("pop");
      void button.offsetWidth;
      button.classList.add("pop");
    }

    try {
      tg?.HapticFeedback?.impactOccurred("light");

      const data = await api("/api/click", {
        method: "POST",
        body: JSON.stringify({}),
      });

      mergeState(data);

      const gain = Number(
        data.gain ?? data.earned ?? state.clickPower ?? state.power ?? 1
      );

      showFloatingGain(button, gain);
    } catch (error) {
      console.error("Ошибка клика:", error);
      notify(error.message || "Не удалось начислить монеты");
    } finally {
      busy = false;
    }
  }

  function showFloatingGain(button, amount) {
    if (!button) return;

    const gain = document.createElement("span");
    gain.className = "floating-gain";
    gain.textContent = `+${formatNumber(amount)}`;

    button.appendChild(gain);

    setTimeout(() => gain.remove(), 1000);
  }

  async function buyUpgrade(type) {
    try {
      const data = await api("/api/buy", {
        method: "POST",
        body: JSON.stringify({ type }),
      });

      mergeState(data);

      tg?.HapticFeedback?.notificationOccurred("success");
      notify("Улучшение куплено!");
    } catch (error) {
      tg?.HapticFeedback?.notificationOccurred("error");
      notify(error.message || "Не удалось купить улучшение");
    }
  }

  async function claimDaily() {
    const button = $("#daily-button");

    if (button?.disabled) return;

    if (button) button.disabled = true;

    try {
      const data = await api("/api/daily", {
        method: "POST",
        body: JSON.stringify({}),
      });

      mergeState(data);

      tg?.HapticFeedback?.notificationOccurred("success");
      notify(data.message || "Ежедневная награда получена!");
    } catch (error) {
      notify(error.message || "Награда пока недоступна");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function switchTab(tabName) {
    $$(".nav-button[data-tab]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.tab === tabName
      );
    });

    $$(".tab-content").forEach((panel) => {
      panel.hidden = panel.id !== `tab-${tabName}`;
    });

    if (tabName === "top") loadLeaderboard();
  }

  async function loadLeaderboard() {
    const container = $("#leaderboard");
    if (!container) return;

    container.innerHTML = "<p>Загрузка рейтинга...</p>";

    try {
      const period =
        $('[data-period].active')?.dataset.period || "all";

      const data = await api(
        `/api/leaderboard?period=${encodeURIComponent(period)}`
      );

      const players = Array.isArray(data)
        ? data
        : data.players || data.leaderboard || [];

      container.replaceChildren();

      if (!players.length) {
        container.textContent = "Пока нет игроков в рейтинге.";
        return;
      }

      players.forEach((player, index) => {
        const row = document.createElement("div");
        row.className = "leaderboard-item";

        const rank = document.createElement("span");
        rank.textContent = `#${player.rank ?? index + 1}`;

        const name = document.createElement("span");
        name.textContent = player.name || "Игрок";

        const score = document.createElement("span");
        score.textContent = formatNumber(
          player.score ?? player.coins ?? 0
        );

        row.append(rank, name, score);
        container.appendChild(row);
      });
    } catch (error) {
      console.error("Ошибка рейтинга:", error);
      container.textContent = "Не удалось загрузить рейтинг.";
    }
  }

  function setTheme(theme) {
    const allowedThemes = [
      "crimson",
      "midnight",
      "ocean",
      "emerald",
    ];

    if (!allowedThemes.includes(theme)) return;

    document.documentElement.dataset.theme = theme;

    try {
      localStorage.setItem("akira-theme", theme);
    } catch {}

    $$(".theme-option[data-theme]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.theme === theme
      );
    });
  }

  function initTheme() {
    let savedTheme = "crimson";

    try {
      savedTheme = localStorage.getItem("akira-theme") || savedTheme;
    } catch {}

    setTheme(savedTheme);
  }

  function initEvents() {
    $("#cookie-button")?.addEventListener("click", clickCoin);

    $$("[data-upgrade]").forEach((button) => {
      button.addEventListener("click", () => {
        buyUpgrade(button.dataset.upgrade);
      });
    });

    $("#daily-button")?.addEventListener("click", claimDaily);

    $$(".nav-button[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        switchTab(button.dataset.tab);
      });
    });

    $$(".theme-option[data-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        setTheme(button.dataset.theme);
      });
    });

    $$("[data-period]").forEach((button) => {
      button.addEventListener("click", () => {
        $$("[data-period]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });

        loadLeaderboard();
      });
    });
  }

  async function init() {
    initEvents();
    initTheme();
    updateUI();
    await loadState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
