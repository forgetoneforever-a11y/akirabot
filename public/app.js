
(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const THEMES = {
    "neon-purple": "Neon Purple",
    midnight: "Midnight",
    emerald: "Emerald",
    crimson: "Crimson",
    light: "Light"
  };

  const THEME_KEY = "akira-theme";
  let toastTimer;
  let state = {
    coins: 0,
    earned: 0,
    power: 1,
    autoLevel: 0,
    multiplier: 1,
    level: 1,
    streak: 0
  };

  let leaderboardPeriod = "week";
  let leaderboardRequest = 0;

  // ---------- Уведомления ----------

  function toast(message) {
    const el = $("#toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  // ---------- Темы ----------

  function applyTheme(theme, save = true) {
    if (!Object.hasOwn(THEMES, theme)) {
      theme = "neon-purple";
    }

    document.documentElement.dataset.theme = theme;

    const themeColor = {
      "neon-purple": "#100b20",
      midnight: "#070d18",
      emerald: "#06140f",
      crimson: "#16080e",
      light: "#f2f3fa"
    }[theme];

    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", themeColor);

    $$("[data-theme-choice]").forEach((button) => {
      const selected = button.dataset.themeChoice === theme;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    const status = $("#themeStatus");
    if (status) status.textContent = `Выбрана тема: ${THEMES[theme]}`;

    if (save) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (_) {
        // Тема останется активной до закрытия страницы.
      }
    }
  }

  function initTheme() {
    let saved = "neon-purple";

    try {
      saved = localStorage.getItem(THEME_KEY) || saved;
    } catch (_) {}

    applyTheme(saved, false);

    $("#themeGrid")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-choice]");
      if (!button) return;

      applyTheme(button.dataset.themeChoice);
      tg?.HapticFeedback?.selectionChanged();
    });
  }

  // ---------- API ----------

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    // Telegram передаёт данные WebApp серверу для проверки пользователя.
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
      throw new Error(data.error || data.message || `Ошибка ${response.status}`);
    }

    return data;
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function format(value) {
    return Math.floor(number(value)).toLocaleString("ru-RU");
  }

  // ---------- Отображение состояния ----------

  function updateUI() {
    $("#coins") && ($("#coins").textContent = format(state.coins));
    $("#earned") && ($("#earned").textContent = format(state.earned));
    $("#profileEarned") &&
      ($("#profileEarned").textContent = format(state.earned));
    $("#power") && ($("#power").textContent = format(state.power));
    $("#autoRate") &&
      ($("#autoRate").textContent = format(state.autoLevel));
    $("#level") &&
      ($("#level").textContent = `LVL ${format(state.level)}`);
    $("#streak") &&
      ($("#streak").textContent = format(state.streak));

    $$(".upgrade").forEach((card) => {
      const type = card.dataset.upgrade;
      const button = card.querySelector(".buy");
      const priceEl = card.querySelector(".price");

      const levels = state.upgrades || {};
      const level = number(levels[type]);

      const basePrices = {
        click: 50,
        auto: 250,
        multiplier: 1000
      };

      const price = Math.floor(
        (basePrices[type] || 50) * Math.pow(1.65, level)
      );

      if (priceEl) priceEl.textContent = format(price);
      if (button) button.disabled = number(state.coins) < price;
    });
  }

  async function loadState() {
    try {
      const data = await api("/api/state");

      // Поддерживает ответ сервера как с объектом state, так и без него.
      const incoming = data.state || data.player || data;
      state = { ...state, ...incoming };

      if (data.upgrades) state.upgrades = data.upgrades;

      updateUI();
    } catch (error) {
      console.error("Не удалось загрузить состояние:", error);
      toast("Не удалось загрузить игру. Проверь сервер.");
    }
  }

  // ---------- Клики по печеньке ----------

  let clickPending = false;

  async function clickCookie() {
    if (clickPending) return;
    clickPending = true;

    const cookie = $("#cookie");
    if (cookie) {
      cookie.classList.remove("pop");
      void cookie.offsetWidth;
      cookie.classList.add("pop");
    }

    tg?.HapticFeedback?.impactOccurred("light");

    try {
      const data = await api("/api/click", {
        method: "POST",
        body: JSON.stringify({})
      });

      const incoming = data.state || data.player || data;
      state = { ...state, ...incoming };
      updateUI();

      if (data.error) toast(data.error);
    } catch (error) {
      console.error("Ошибка клика:", error);
      toast("Не удалось сохранить клик");
    } finally {
      clickPending = false;
    }
  }

  $("#cookieButton")?.addEventListener("click", clickCookie);

  $("#cookieButton")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      clickCookie();
    }
  });

  // ---------- Вкладки ----------

  function openTab(name) {
    if (!$("#" + name)) return;

    $$(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === name);
    });

    ["shop", "top", "profile", "settings"].forEach((id) => {
      $("#" + id)?.classList.toggle("hidden", id !== name);
    });

    if (name === "top") loadLeaderboard(leaderboardPeriod);
    if (name === "profile") loadState();

    tg?.HapticFeedback?.selectionChanged();
  }

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => openTab(button.dataset.tab));
  });

  // ---------- Магазин ----------

  $$(".upgrade").forEach((card) => {
    card.querySelector(".buy")?.addEventListener("click", async () => {
      const type = card.dataset.upgrade;
      const button = card.querySelector(".buy");

      if (button.disabled) return;
      button.disabled = true;

      try {
        const data = await api("/api/buy", {
          method: "POST",
          body: JSON.stringify({ upgrade: type, type })
        });

        if (data.state || data.player) {
          state = { ...state, ...(data.state || data.player) };
        } else {
          await loadState();
        }

        updateUI();
        toast(data.message || "Улучшение куплено!");
        tg?.HapticFeedback?.notificationOccurred("success");
      } catch (error) {
        toast(error.message || "Не удалось купить улучшение");
        await loadState();
      } finally {
        button.disabled = false;
      }
    });
  });

  // ---------- Рейтинг ----------

  async function loadLeaderboard(period) {
    const container = $("#leaderboard");
    if (!container) return;

    const requestId = ++leaderboardRequest;
    container.innerHTML = '<div class="empty">Загружаем рейтинг…</div>';

    try {
      const data = await api(
        `/api/leaderboard?period=${encodeURIComponent(period)}`
      );

      if (requestId !== leaderboardRequest) return;

      const entries = Array.isArray(data)
        ? data
        : data.leaderboard || data.players || data.rows || [];

      container.replaceChildren();

      if (!entries.length) {
        container.innerHTML =
          '<div class="empty">Пока нет участников рейтинга</div>';
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
          entry.username || entry.nickname || entry.name || "Игрок";

        const score = document.createElement("div");
        score.className = "leader-score";
        score.textContent = `◉ ${format(
          entry.earned ?? entry.coins ?? entry.score ?? entry.total ?? 0
        )}`;

        row.append(rank, name, score);
        container.appendChild(row);
      });
    } catch (error) {
      if (requestId !== leaderboardRequest) return;
      console.error("Ошибка рейтинга:", error);
      container.innerHTML =
        '<div class="empty">Не удалось загрузить рейтинг</div>';
    }
  }

  $$(".period").forEach((button) => {
    button.addEventListener("click", () => {
      leaderboardPeriod = button.dataset.period;

      $$(".period").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      loadLeaderboard(leaderboardPeriod);
    });
  });

  // ---------- Ежедневная награда ----------

  $("#daily")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      const data = await api("/api/daily", {
        method: "POST",
        body: JSON.stringify({})
      });

      if (data.state || data.player) {
        state = { ...state, ...(data.state || data.player) };
      } else {
        await loadState();
      }

      updateUI();
      toast(data.message || "Ежедневная награда получена!");
      tg?.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
      toast(error.message || "Награду пока нельзя получить");
    } finally {
      button.disabled = false;
    }
  });

  // ---------- Запуск ----------

  initTheme();
  updateUI();
  loadState();

})();
