
(() => {
  "use strict";

  const API = "/api";

  const state = {
    player: null,
    tasks: [],
    leaderboard: [],
    busy: false,
    minigame: null,
    refreshTimer: null
  };

  const $ = (selector) => document.querySelector(selector);

  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function formatNumber(value) {
    return Math.floor(Number(value) || 0).toLocaleString("ru-RU");
  }

  function getPlayer() {
    return state.player || {};
  }

  function getTelegram() {
    return window.Telegram?.WebApp || null;
  }

  function initTelegram() {
    const tg = getTelegram();

    if (!tg) return;

    tg.ready();
    tg.expand();

    try {
      tg.setHeaderColor("#090909");
      tg.setBackgroundColor("#090909");
    } catch (_) {}
  }

  async function api(path, options = {}) {
    const tg = getTelegram();

    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (tg?.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }

    const response = await fetch(`${API}${path}`, {
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
      throw new Error(data.error || data.message || `Ошибка ${response.status}`);
    }

    return data;
  }

  function setText(selectors, value) {
    selectors.forEach((selector) => {
      $$(selector).forEach((element) => {
        element.textContent = value;
      });
    });
  }

  function setHTML(selectors, html) {
    selectors.forEach((selector) => {
      $$(selector).forEach((element) => {
        element.innerHTML = html;
      });
    });
  }

  function setDisabled(selectors, disabled) {
    selectors.forEach((selector) => {
      $$(selector).forEach((element) => {
        if ("disabled" in element) element.disabled = disabled;
        element.classList.toggle("is-disabled", disabled);
      });
    });
  }

  function notify(message, type = "info") {
    let toast = $("#akira-toast");

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "akira-toast";
      toast.className = "akira-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("show");

    clearTimeout(notify.timer);

    notify.timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2400);
  }

  function haptic(style = "light") {
    const tg = getTelegram();

    try {
      if (style === "success") {
        tg?.HapticFeedback?.notificationOccurred("success");
      } else if (style === "error") {
        tg?.HapticFeedback?.notificationOccurred("error");
      } else {
        tg?.HapticFeedback?.impactOccurred(style);
      }
    } catch (_) {}
  }

  function renderPlayer() {
    const p = getPlayer();

    const coins = formatNumber(p.coins);
    const clickPower = formatNumber(p.clickReward ?? p.click_power ?? 1);
    const autoPower = formatNumber(p.autoPowerPerSecond ?? 0);

    setText(
      ["#coins", "#balance", "#coinBalance", "[data-coins]", ".coins-value"],
      coins
    );

    setText(
      ["#clickPower", "#click-power", "[data-click-power]"],
      clickPower
    );

    setText(
      ["#autoPower", "#auto-power", "[data-auto-power]"],
      `${autoPower}/сек`
    );

    setText(
      ["#totalEarned", "#total-earned", "[data-total-earned]"],
      formatNumber(p.total_earned)
    );

    setText(
      ["#totalClicks", "#total-clicks", "[data-total-clicks]"],
      formatNumber(p.total_clicks)
    );

    setText(
      ["#playerLevel", "#level", "[data-level]"],
      formatNumber(p.level ?? 1)
    );

    setText(
      ["#playerName", "#username", "[data-player-name]"],
      p.name || "Игрок"
    );

    setText(
      ["#streak", "#dailyStreak", "[data-streak]"],
      formatNumber(p.streak)
    );

    renderUpgrades();
  }

  function createFloatingText(x, y, text, element) {
    const popup = document.createElement("div");

    popup.className = "click-popup";
    popup.textContent = text;

    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;

    document.body.appendChild(popup);

    requestAnimationFrame(() => {
      popup.classList.add("animate");
    });

    setTimeout(() => popup.remove(), 1000);

    if (element) {
      element.classList.remove("click-bounce");
      void element.offsetWidth;
      element.classList.add("click-bounce");

      setTimeout(() => {
        element.classList.remove("click-bounce");
      }, 180);
    }
  }

  function floatingAtElement(element, text) {
    const rect = element.getBoundingClientRect();

    createFloatingText(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      text,
      element
    );
  }

  function renderUpgrades() {
    const p = getPlayer();

    const upgrades = [
      {
        type: "click",
        level: Number(p.click_power || 1),
        label: "Сила клика",
        description: "Больше монет за нажатие",
        base: 50,
        factor: 1.65,
        max: 100
      },
      {
        type: "auto",
        level: Number(p.auto_level || 0),
        label: "Авто-кликер",
        description: "Зарабатывает монеты со временем",
        base: 250,
        factor: 1.8,
        max: 50
      },
      {
        type: "multiplier",
        level: Number(p.multiplier_level || 0),
        label: "Множитель",
        description: "Увеличивает доход",
        base: 1000,
        factor: 2.1,
        max: 25
      }
    ];

    upgrades.forEach((upgrade) => {
      const cost = Math.floor(
        upgrade.base * Math.pow(upgrade.factor, upgrade.level)
      );

      const isMax = upgrade.level >= upgrade.max;

      const buttons = [
        ...$$(`[data-upgrade="${upgrade.type}"]`),
        ...$$(`#upgrade-${upgrade.type}`)
      ];

      buttons.forEach((button) => {
        const price = button.querySelector(
          "[data-upgrade-price], .upgrade-price, .price"
        );

        const level = button.querySelector(
          "[data-upgrade-level], .upgrade-level"
        );

        const title = button.querySelector(
          "[data-upgrade-title], .upgrade-title"
        );

        const description = button.querySelector(
          "[data-upgrade-description], .upgrade-description"
        );

        if (price) {
          price.textContent = isMax ? "МАКС." : formatNumber(cost);
        }

        if (level) {
          level.textContent = `Ур. ${upgrade.level}`;
        }

        if (title) {
          title.textContent = upgrade.label;
        }

        if (description) {
          description.textContent = upgrade.description;
        }

        button.classList.toggle("is-max", isMax);
        button.disabled = isMax || state.busy || Number(p.coins || 0) < cost;
      });
    });
  }

  function renderTasks() {
    const container =
      $("#tasksList") ||
      $("#tasks-list") ||
      $("#tasks") ||
      $("[data-tasks-list]");

    if (!container) return;

    if (!state.tasks.length) {
      container.innerHTML =
        '<div class="empty-state">Пока нет доступных заданий</div>';
      return;
    }

    container.innerHTML = "";

    state.tasks.forEach((task) => {
      const item = document.createElement("div");
      item.className = "task-card";

      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = task.title || task.name || "Задание";

      const reward = document.createElement("div");
      reward.className = "task-reward";
      reward.textContent = `+${formatNumber(task.reward || 0)} монет`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-claim";
      button.textContent = task.completed
        ? "Получено"
        : task.claimed
          ? "Получено"
          : "Забрать";

      button.disabled = Boolean(task.completed || task.claimed);

      button.addEventListener("click", async () => {
        await claimTask(task, button);
      });

      item.append(title, reward, button);
      container.appendChild(item);
    });
  }

  function renderLeaderboard() {
    const container =
      $("#leaderboardList") ||
      $("#leaderboard-list") ||
      $("#leaderboard") ||
      $("[data-leaderboard]");

    if (!container) return;

    container.innerHTML = "";

    if (!state.leaderboard.length) {
      container.innerHTML =
        '<div class="empty-state">Таблица лидеров пока пуста</div>';
      return;
    }

    state.leaderboard.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${index + 1}`;

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = player.name || `Игрок ${index + 1}`;

      const coins = document.createElement("span");
      coins.className = "leaderboard-coins";
      coins.textContent = formatNumber(player.coins);

      row.append(rank, name, coins);
      container.appendChild(row);
    });
  }

  async function loadState() {
    try {
      const data = await api("/state");

      state.player = data.player || data;
      state.tasks = Array.isArray(data.tasks) ? data.tasks : state.tasks;

      renderPlayer();
      renderTasks();

      return data;
    } catch (error) {
      console.error("AKIRA state:", error);
      notify(error.message || "Не удалось загрузить данные", "error");
      throw error;
    }
  }

  async function clickCoin(event) {
    if (state.busy) return;

    const coin =
      event.currentTarget ||
      $("#coin") ||
      $("#clicker") ||
      $("#clickButton");

    state.busy = true;

    if (coin) coin.classList.add("loading");

    try {
      const data = await api("/click", {
        method: "POST",
        body: JSON.stringify({})
      });

      if (data.player) {
        state.player = data.player;
      } else if (data.state?.player) {
        state.player = data.state.player;
      } else if (state.player) {
        state.player.coins =
          Number(state.player.coins || 0) +
          Number(data.reward ?? data.earned ?? data.amount ?? 0);
      }

      const reward = Number(
        data.reward ??
        data.earned ??
        data.amount ??
        data.clickReward ??
        0
      );

      renderPlayer();

      if (coin) {
        floatingAtElement(coin, `+${formatNumber(reward)}`);
      }

      haptic("light");
    } catch (error) {
      console.error("AKIRA click:", error);
      notify(error.message || "Не удалось начислить монеты", "error");
      haptic("error");
    } finally {
      state.busy = false;
      if (coin) coin.classList.remove("loading");
      renderUpgrades();
    }
  }

  async function buyUpgrade(type, button) {
    if (state.busy) return;

    state.busy = true;
    renderUpgrades();

    try {
      const data = await api("/upgrades", {
        method: "POST",
        body: JSON.stringify({ type })
      });

      if (data.player) state.player = data.player;
      else if (data.state?.player) state.player = data.state.player;

      await loadState();

      notify(data.message || "Улучшение куплено!", "success");
      haptic("success");
    } catch (error) {
      console.error("AKIRA upgrade:", error);
      notify(error.message || "Не удалось купить улучшение", "error");
    } finally {
      state.busy = false;
      if (button) button.classList.remove("loading");
      renderUpgrades();
    }
  }

  async function buyItem(item, button) {
    if (state.busy) return;

    state.busy = true;

    try {
      const data = await api("/buy", {
        method: "POST",
        body: JSON.stringify({ item })
      });

      if (data.player) state.player = data.player;

      await loadState();

      notify(data.message || "Покупка успешна!", "success");
      haptic("success");
    } catch (error) {
      notify(error.message || "Не удалось купить предмет", "error");
    } finally {
      state.busy = false;
      renderUpgrades();
    }
  }

  async function claimDaily(button) {
    if (state.busy) return;

    state.busy = true;

    try {
      const data = await api("/daily", {
        method: "POST",
        body: JSON.stringify({})
      });

      if (data.player) state.player = data.player;

      await loadState();

      const reward = data.reward ?? data.amount;

      notify(
        reward != null
          ? `Ежедневная награда: +${formatNumber(reward)} монет`
          : data.message || "Награда получена!",
        "success"
      );

      if (button) {
        button.textContent = "Получено";
        button.disabled = true;
      }

      haptic("success");
    } catch (error) {
      notify(error.message || "Награда пока недоступна", "error");
    } finally {
      state.busy = false;
    }
  }

  async function claimTask(task, button) {
    if (state.busy) return;

    state.busy = true;

    try {
      const taskId = task.id ?? task.task_id;

      const data = await api("/tasks/claim", {
        method: "POST",
        body: JSON.stringify({ taskId, id: taskId })
      });

      if (data.player) state.player = data.player;

      task.claimed = true;
      task.completed = true;

      await loadState();

      if (button) {
        button.textContent = "Получено";
        button.disabled = true;
      }

      notify(data.message || "Награда за задание получена!", "success");
      haptic("success");
    } catch (error) {
      notify(error.message || "Не удалось получить награду", "error");
    } finally {
      state.busy = false;
    }
  }

  async function loadLeaderboard() {
    try {
      const data = await api("/leaderboard");

      state.leaderboard = Array.isArray(data)
        ? data
        : data.leaderboard || data.players || [];

      renderLeaderboard();
    } catch (error) {
      console.error("AKIRA leaderboard:", error);
    }
  }

  async function loadTasks() {
    try {
      const data = await api("/tasks");

      state.tasks = Array.isArray(data)
        ? data
        : data.tasks || [];

      renderTasks();
    } catch (error) {
      console.error("AKIRA tasks:", error);
    }
  }

  async function startMinigame(button) {
    if (state.busy) return;

    state.busy = true;

    try {
      const data = await api("/minigame/start", {
        method: "POST",
        body: JSON.stringify({})
      });

      state.minigame = data;

      notify(data.message || "Мини-игра началась!", "success");

      document.dispatchEvent(
        new CustomEvent("akira:minigame-start", { detail: data })
      );
    } catch (error) {
      notify(error.message || "Не удалось запустить игру", "error");
    } finally {
      state.busy = false;
    }
  }

  async function finishMinigame(score = 0) {
    try {
      const data = await api("/minigame/finish", {
        method: "POST",
        body: JSON.stringify({
          score: Math.max(0, Math.floor(Number(score) || 0)),
          ...(state.minigame?.id != null
            ? { gameId: state.minigame.id }
            : {})
        })
      });

      if (data.player) state.player = data.player;

      await loadState();

      notify(data.message || "Мини-игра завершена!", "success");
      return data;
    } catch (error) {
      notify(error.message || "Не удалось завершить игру", "error");
      throw error;
    }
  }

  function bindClick(selector, callback) {
    $$(selector).forEach((element) => {
      element.addEventListener("click", callback);
    });
  }

  function bindEvents() {
    bindClick(
      "#coin, #clicker, #clickButton, #mainCoin, [data-clicker]",
      clickCoin
    );

    bindClick("[data-upgrade='click'], #upgrade-click", (event) => {
      buyUpgrade("click", event.currentTarget);
    });

    bindClick("[data-upgrade='auto'], #upgrade-auto", (event) => {
      buyUpgrade("auto", event.currentTarget);
    });

    bindClick(
      "[data-upgrade='multiplier'], #upgrade-multiplier",
      (event) => {
        buyUpgrade("multiplier", event.currentTarget);
      }
    );

    bindClick("#dailyButton, #daily-button, [data-daily]", (event) => {
      claimDaily(event.currentTarget);
    });

    bindClick("#refreshButton, [data-refresh]", async () => {
      await Promise.allSettled([
        loadState(),
        loadTasks(),
        loadLeaderboard()
      ]);

      notify("Данные обновлены", "success");
    });

    bindClick("#minigameButton, [data-minigame-start]", (event) => {
      startMinigame(event.currentTarget);
    });

    $$("[data-buy-item]").forEach((button) => {
      button.addEventListener("click", () => {
        buyItem(button.dataset.buyItem, button);
      });
    });

    $$("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const page = button.dataset.page;

        $$("[data-page]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });

        $$("[data-screen]").forEach((screen) => {
          screen.hidden = screen.dataset.screen !== page;
        });
      });
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        loadState().catch(() => {});
      }
    });

    window.addEventListener("online", () => {
      loadState().catch(() => {});
    });
  }

  async function init() {
    initTelegram();
    bindEvents();

    try {
      await loadState();

      await Promise.allSettled([
        loadTasks(),
        loadLeaderboard()
      ]);

      clearInterval(state.refreshTimer);

      state.refreshTimer = setInterval(() => {
        if (!document.hidden) {
          loadState().catch(() => {});
        }
      }, 15000);
    } catch (error) {
      console.error("AKIRA init:", error);
    }
  }

  window.AKIRA = {
    api,
    loadState,
    loadTasks,
    loadLeaderboard,
    clickCoin,
    buyUpgrade,
    claimDaily,
    claimTask,
    startMinigame,
    finishMinigame,
    notify,
    getState: () => state
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
