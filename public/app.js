(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const state = {
    coins: 0,
    earned: 0,
    totalEarned: 0,
    power: 1,
    clickPower: 1,
    autoLevel: 0,
    multiplier: 1,
    multiplierLevel: 0,
    level: 1,
    streak: 0,
    name: "Игрок"
  };

  let clickPending = false;
  let toastTimer;
  let leaderboardRequest = 0;
  let leaderboardPeriod = "week";

  function format(value) {
    const n = Number(value);
    return Math.floor(Number.isFinite(n) ? n : 0)
      .toLocaleString("ru-RU");
  }

  function toast(message) {
    const el = $("#toast");
    if (!el) return;

    el.textContent = message;
    el.hidden = false;
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
      el.hidden = true;
    }, 2400);
  }

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (tg?.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }

    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin"
    });

    let data = {};

    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      throw new Error(
        data.error || data.message || `Ошибка ${response.status}`
      );
    }

    return data;
  }

  function mergeState(data) {
    const incoming = data?.state || data?.player || data || {};

    Object.assign(state, incoming);

    state.coins = Number(state.coins) || 0;
    state.earned = Number(
      state.earned ?? state.totalEarned
    ) || 0;
    state.totalEarned = Number(
      state.totalEarned ?? state.earned
    ) || 0;

    state.power = Number(
      state.power ?? state.clickPower
    ) || 1;
    state.clickPower = Number(
      state.clickPower ?? state.power
    ) || 1;

    state.autoLevel = Number(state.autoLevel) || 0;
    state.multiplier = Number(state.multiplier) || 1;
    state.multiplierLevel = Number(state.multiplierLevel) || 0;
    state.level = Number(state.level) || 1;
    state.streak = Number(state.streak) || 0;
    state.name = state.name || "Игрок";

    updateUI();
  }

  function updateUI() {
    const set = (selector, value) => {
      const el = $(selector);
      if (el) el.textContent = value;
    };

    set("#balance", format(state.coins));
    set("#total-earned", format(state.totalEarned || state.earned));
    set("#click-power", format(state.power));
    set("#auto-power", format(state.autoLevel));

    set(
      "#level",
      format(
        state.level ||
        Math.max(
          1,
          Math.floor(
            (state.totalEarned || state.earned) / 1000
          ) + 1
        )
      )
    );

    set("#player-name", state.name);
    set("#profile-balance", format(state.coins));
    set("#profile-earned", format(state.totalEarned || state.earned));
    set("#profile-click", format(state.power));
    set("#profile-auto", `${format(state.autoLevel)}/с`);

    const upgradeLevels = {
      click: Math.max(0, state.power - 1),
      auto: state.autoLevel,
      multiplier: state.multiplierLevel
    };

    const config = {
      click: { base: 50, factor: 1.65, max: 100 },
      auto: { base: 250, factor: 1.8, max: 50 },
      multiplier: { base: 1000, factor: 2.1, max: 25 }
    };

    $$(".upgrade-item").forEach((card) => {
      const button = card.querySelector("[data-upgrade]");
      if (!button) return;

      const key = button.dataset.upgrade;
      const item = config[key];
      if (!item) return;

      const level = upgradeLevels[key] || 0;
      const price = Math.floor(
        item.base * Math.pow(item.factor, level)
      );

      const priceEl = card.querySelector(".upgrade-price span");

      if (priceEl) {
        priceEl.textContent = format(price);
      }

      button.disabled =
        state.coins < price || level >= item.max;

      button.textContent =
        level >= item.max ? "Макс." : "Купить";
    });
  }

  async function loadState() {
    try {
      mergeState(await api("/api/state"));
    } catch (error) {
      console.error("Не удалось загрузить состояние:", error);
      toast(error.message || "Не удалось загрузить игру");
    }
  }

  // Анимация монет при клике.
  // Показывает именно количество, выданное сервером.
  function showFloatingGain(amount, clientX, clientY) {
    const area = $("#click-area");
    const button = $("#cookie-button");

    if (!area) return;

    const rect = area.getBoundingClientRect();

    // Если координаты нажатия недоступны,
    // показываем число в центре кнопки.
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY)
    ) {
      const buttonRect = button
        ? button.getBoundingClientRect()
        : rect;

      clientX = buttonRect.left + buttonRect.width / 2;
      clientY = buttonRect.top + buttonRect.height / 2;
    }

    const el = document.createElement("span");

    el.className = "floating-gain";
    el.textContent = `+${format(amount)}`;
    el.setAttribute("aria-hidden", "true");

    // Координаты относительно области клика.
    el.style.position = "absolute";
    el.style.left = `${clientX - rect.left}px`;
    el.style.top = `${clientY - rect.top}px`;
    el.style.transform = "translate(-50%, -50%)";
    el.style.pointerEvents = "none";
    el.style.zIndex = "100";
    el.style.fontWeight = "900";
    el.style.fontSize = "24px";
    el.style.color = "#ffffff";
    el.style.textShadow = "0 2px 12px rgba(255,255,255,.45)";
    el.style.whiteSpace = "nowrap";

    // Анимация работает даже без отдельного CSS-файла.
    el.animate(
      [
        {
          opacity: 0,
          transform: "translate(-50%, 0) scale(.65)"
        },
        {
          opacity: 1,
          transform: "translate(-50%, -15px) scale(1.2)",
          offset: 0.18
        },
        {
          opacity: 0,
          transform: "translate(-50%, -85px) scale(.9)"
        }
      ],
      {
        duration: 850,
        easing: "ease-out",
        fill: "forwards"
      }
    );

    area.appendChild(el);

    setTimeout(() => el.remove(), 900);
  }

  async function clickCookie(event) {
    if (clickPending) return;

    clickPending = true;

    const button = $("#cookie-button");

    // Запоминаем место нажатия до запроса к серверу.
    const clientX = event?.clientX;
    const clientY = event?.clientY;

    button?.classList.remove("pop");

    if (button) {
      void button.offsetWidth;
      button.classList.add("pop");
    }

    tg?.HapticFeedback?.impactOccurred("light");

    try {
      const data = await api("/api/click", {
        method: "POST",
        body: JSON.stringify({})
      });

      mergeState(data);

      // Показываем число только после подтверждения сервера.
      if (Number(data.gained) > 0) {
        showFloatingGain(data.gained, clientX, clientY);
      }
    } catch (error) {
      console.error("Ошибка клика:", error);
      toast(error.message || "Не удалось сохранить клик");
    } finally {
      clickPending = false;
    }
  }

  $("#cookie-button")?.addEventListener("click", clickCookie);

  // Навигация между разделами.
  $$(".nav-button[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      openTab(button.dataset.tab);
    });
  });

  function openTab(name) {
    $$(".nav-button[data-tab]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.tab === name
      );
    });

    $$(".tab-content").forEach((panel) => {
      panel.hidden = panel.id !== `tab-${name}`;
    });

    if (name === "top") {
      loadLeaderboard(leaderboardPeriod);
    }

    if (name === "profile") {
      loadState();
    }

    tg?.HapticFeedback?.selectionChanged();
  }

  // Покупка улучшений.
  $$("[data-upgrade]").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.upgrade;
      if (button.disabled) return;

      button.disabled = true;

      try {
        const data = await api("/api/buy", {
          method: "POST",
          body: JSON.stringify({ upgrade: type })
        });

        mergeState(data);

        toast(data.message || "Улучшение куплено!");

        tg?.HapticFeedback?.notificationOccurred("success");
      } catch (error) {
        toast(error.message || "Не удалось купить улучшение");
        await loadState();
      } finally {
        updateUI();
      }
    });
  });

  // Таблица лидеров.
  async function loadLeaderboard(period = "week") {
    const container = $("#leaderboard");
    if (!container) return;

    leaderboardPeriod = period;

    const requestId = ++leaderboardRequest;
    container.textContent = "Загружаем рейтинг…";

    try {
      const data = await api(
        `/api/leaderboard?period=${encodeURIComponent(period)}`
      );

      if (requestId !== leaderboardRequest) return;

      const entries = Array.isArray(data)
        ? data
        : data.leaderboard || data.players || [];

      container.replaceChildren();

      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "section-description";
        empty.textContent = "Пока нет участников рейтинга";
        container.appendChild(empty);
        return;
      }

      entries.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "leader-row";

        const rank = document.createElement("div");
        rank.className = "leader-rank";
        rank.textContent = String(entry.rank || index + 1);

        const name = document.createElement("div");
        name.className = "leader-name";
        name.textContent =
          entry.name || entry.username || "Игрок";

        const score = document.createElement("div");
        score.className = "leader-score";
        score.textContent =
          `◎ ${format(
            entry.score ?? entry.earned ?? entry.coins ?? 0
          )}`;

        row.append(rank, name, score);
        container.appendChild(row);
      });
    } catch (error) {
      if (requestId !== leaderboardRequest) return;

      container.textContent =
        error.message || "Не удалось загрузить рейтинг";
    }
  }

  // Периоды рейтинга, если они есть в HTML.
  $$("[data-period]").forEach((button) => {
    button.addEventListener("click", () => {
      const period = button.dataset.period;

      if (!["week", "month", "year"].includes(period)) {
        return;
      }

      $$("[data-period]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      loadLeaderboard(period);
    });
  });

  // Ежедневная награда.
  $("#daily-button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      const data = await api("/api/daily", {
        method: "POST",
        body: JSON.stringify({})
      });

      mergeState(data);

      toast(
        data.message ||
        `Получено ${format(data.gained || 0)} монет!`
      );

      tg?.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
      toast(error.message || "Не удалось получить награду");
    } finally {
      button.disabled = false;
    }
  });

  // Темы оформления.
  const themeNames = {
    crimson: "Crimson",
    midnight: "Midnight",
    ocean: "Ocean",
    emerald: "Emerald"
  };

  function applyTheme(theme) {
    if (!themeNames[theme]) return;

    document.documentElement.dataset.theme = theme;

    try {
      localStorage.setItem("akira-theme", theme);
    } catch (_) {}

    $$(".theme-option[data-theme]").forEach((button) => {
      const active = button.dataset.theme === theme;

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  $$(".theme-option[data-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.theme);
      tg?.HapticFeedback?.selectionChanged();
    });
  });

  try {
    const savedTheme = localStorage.getItem("akira-theme");
    applyTheme(savedTheme || "crimson");
  } catch (_) {
    applyTheme("crimson");
  }

  // Первичная отрисовка и загрузка состояния.
  updateUI();
  loadState();
})();
