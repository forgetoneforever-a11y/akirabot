(() => {
  "use strict";

  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const state = {
    coins: 0,
    totalEarned: 0,
    clickPower: 1,
    power: 1,
    autoLevel: 0,
    multiplierLevel: 0,
    multiplier: 1,
    xp: 0,
    level: 1,
    totalClicks: 0,
    name: "Игрок"
  };

  let busy = false;
  let lastClick = 0;
  let tasks = [];
  let challengeId = null;
  let gameTimeout = null;

  const fmt = n =>
    new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 1
    }).format(Number(n) || 0);

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(tg?.initData
          ? { "X-Telegram-Init-Data": tg.initData }
          : {}),
        ...options.headers
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || "Ошибка сервера");
    }

    return data;
  }

  function toast(message) {
    const el = $("#toast");

    if (!el) {
      console.log(message);
      return;
    }

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      el.classList.remove("show");
    }, 2600);
  }

  function applyPlayer(data) {
    const player = data?.player || data?.state || data;

    if (!player || typeof player !== "object") return;

    for (const key of [
      "coins",
      "totalEarned",
      "clickPower",
      "power",
      "autoLevel",
      "multiplierLevel",
      "multiplier",
      "xp",
      "level",
      "totalClicks",
      "name"
    ]) {
      if (player[key] !== undefined) {
        state[key] = player[key];
      }
    }

    render();
  }

  function levelFromXp(xp) {
    let level = 1;
    let remaining = Math.max(0, Number(xp) || 0);

    while (level < 10000 && remaining >= level * 100) {
      remaining -= level * 100;
      level++;
    }

    return level;
  }

  function render() {
    const xp = Number(state.xp) || 0;
    const level = Number(state.level) || levelFromXp(xp);
    const xpForLevel = Math.max(100, level * 100);
    const xpProgress = xp % xpForLevel;

    const values = {
      "#balance": fmt(state.coins),
      "#total-earned": fmt(state.totalEarned),
      "#click-power": fmt(state.clickPower ?? state.power ?? 1),
      "#auto-power": fmt(state.autoLevel || 0),
      "#level": fmt(level),
      "#player-name": state.name || "Игрок",
      "#akira-level-copy": fmt(level),
      "#akira-xp": fmt(xp),
      "#akira-next-xp": fmt(xpForLevel - xpProgress)
    };

    Object.entries(values).forEach(([selector, value]) => {
      const element = $(selector);
      if (element) element.textContent = value;
    });

    const xpBar = $("#akira-xp-fill");

    if (xpBar) {
      xpBar.style.width =
        `${Math.min(100, xpProgress / xpForLevel * 100)}%`;
    }

    updatePrices();
    renderTasks();
  }

  function price(type) {
    const configs = {
      click: {
        base: 50,
        multiplier: 1.65,
        level: Math.max(0, Number(state.clickPower || 1) - 1),
        max: 100
      },
      auto: {
        base: 250,
        multiplier: 1.8,
        level: Number(state.autoLevel || 0),
        max: 50
      },
      multiplier: {
        base: 1000,
        multiplier: 2.1,
        level: Number(state.multiplierLevel || 0),
        max: 25
      }
    };

    const config = configs[type];

    if (!config) return { cost: 0, max: true };

    return {
      cost: Math.floor(
        config.base * Math.pow(config.multiplier, config.level)
      ),
      max: config.level >= config.max
    };
  }

  function updatePrices() {
    for (const type of ["click", "auto", "multiplier"]) {
      const info = price(type);
      const button = $(`[data-upgrade="${type}"]`);

      if (button) {
        button.disabled =
          info.max || Number(state.coins) < info.cost;

        button.title = info.max
          ? "Максимальный уровень"
          : `Цена: ${fmt(info.cost)}`;
      }
    }
  }

  async function loadState() {
    try {
      applyPlayer(await api("/api/state"));
    } catch (error) {
      console.error(error);
      toast("Не удалось загрузить данные");
    }
  }

  async function clickCookie() {
    if (busy || Date.now() - lastClick < 80) return;

    lastClick = Date.now();
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
        body: JSON.stringify({})
      });

      applyPlayer(data);
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
    }
  }

  async function buyUpgrade(type) {
    try {
      const data = await api("/api/buy", {
        method: "POST",
        body: JSON.stringify({ upgrade: type })
      });

      applyPlayer(data);
      toast(data.message || "Улучшение куплено!");
    } catch (error) {
      toast(error.message);
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

      applyPlayer(data);
      toast(data.message || "Ежедневная награда получена!");
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadLeaderboard() {
    const root = $("#leaderboard");
    if (!root) return;

    root.textContent = "Загрузка рейтинга...";

    const period =
      $('[data-period].active')?.dataset.period || "week";

    try {
      const result = await api(
        `/api/leaderboard?period=${encodeURIComponent(period)}`
      );

      const players = Array.isArray(result)
        ? result
        : result.players || result.leaderboard || [];

      root.replaceChildren();

      if (!players.length) {
        root.textContent = "Пока нет игроков в рейтинге.";
        return;
      }

      players.forEach((player, index) => {
        const row = document.createElement("div");
        row.className = "leaderboard-item";

        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = `#${player.rank ?? index + 1}`;

        const name = document.createElement("span");
        name.className = "player-name";
        name.textContent = player.name || "Игрок";

        const score = document.createElement("strong");
        score.textContent = fmt(player.score ?? 0);

        row.append(rank, name, score);
        root.appendChild(row);
      });
    } catch (error) {
      root.textContent = error.message || "Не удалось загрузить топ.";
    }
  }

  function mountStyle() {
    if ($("#akira-extra-css")) return;

    const style = document.createElement("style");
    style.id = "akira-extra-css";

    style.textContent = `
      :root {
        --akira-accent: #ff477e;
        --akira-pink: #ff8fb0;
        --akira-panel: rgba(36, 9, 22, .88);
      }

      body {
        background-image:
          radial-gradient(ellipse at 15% 0%, rgba(255,45,105,.13), transparent 42%),
          radial-gradient(ellipse at 90% 35%, rgba(110,18,55,.18), transparent 40%);
      }

      .akira-panel {
        margin: 16px 0;
        padding: 20px;
        border: 1px solid rgba(255,92,140,.24);
        border-radius: 24px;
        background: linear-gradient(145deg, rgba(52,13,31,.92), rgba(20,7,15,.96));
        box-shadow: 0 14px 38px rgba(0,0,0,.2), inset 0 1px rgba(255,255,255,.035);
        backdrop-filter: blur(18px);
      }

      .akira-kicker {
        color: #c99aa9;
        font-size: 11px;
        letter-spacing: .2em;
        font-weight: 800;
      }

      .akira-heading {
        margin: 8px 0 14px;
        font-size: 22px;
        font-weight: 900;
        color: #fff0f5;
      }

      .akira-xpbar {
        height: 9px;
        margin: 12px 0;
        overflow: hidden;
        border-radius: 99px;
        background: rgba(255,255,255,.08);
      }

      .akira-xpbar span {
        display: block;
        height: 100%;
        width: 0;
        border-radius: inherit;
        background: linear-gradient(90deg, #ff477e, #ffc0d2);
        transition: width .25s ease;
      }

      .akira-mini-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .akira-mini {
        padding: 15px;
        border-radius: 18px;
        background: rgba(255,255,255,.035);
        border: 1px solid rgba(255,255,255,.06);
      }

      .akira-mini button,
      .akira-task button {
        margin-top: 10px;
        width: 100%;
        border: 0;
        border-radius: 13px;
        padding: 12px;
        font-weight: 800;
        color: white;
        background: linear-gradient(110deg, #ff477e, #bc275b);
      }

      .akira-task {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 14px 0;
        border-bottom: 1px solid rgba(255,255,255,.07);
      }

      .akira-task:last-child {
        border-bottom: 0;
      }

      .akira-task-main {
        flex: 1;
        min-width: 0;
      }

      .akira-task small {
        display: block;
        margin-top: 4px;
        color: #bd98a7;
      }

      .akira-task button {
        width: auto;
        min-width: 100px;
        margin: 0;
      }

      .akira-task button:disabled {
        opacity: .45;
      }

      .akira-periods {
        display: flex;
        gap: 8px;
        margin: 16px 0;
      }

      .akira-periods button {
        flex: 1;
        padding: 10px;
        border-radius: 12px;
        border: 1px solid rgba(255,71,126,.3);
        background: rgba(255,255,255,.04);
        color: inherit;
      }

      .akira-periods button.active {
        background: #ff477e;
        color: white;
      }

      #cookie-button {
        transition: transform .16s ease, filter .2s ease;
      }

      #cookie-button:active {
        transform: scale(.965);
        filter: brightness(1.12);
      }

      #cookie-button.pop {
        animation: akira-pop .22s ease;
      }

      @keyframes akira-pop {
        0% { transform: scale(1); }
        45% { transform: scale(.96); }
        100% { transform: scale(1); }
      }

      .theme-option.active {
        outline: 2px solid #ff477e;
        outline-offset: 2px;
      }

      @media(max-width: 380px) {
        .akira-panel { padding: 15px; }
        .akira-mini-grid { grid-template-columns: 1fr; }
      }

      @media(prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: .01ms !important;
          transition-duration: .01ms !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function mountNewSections() {
    const main = $("main");
    if (!main || $("#akira-level-panel")) return;

    const levelPanel = document.createElement("section");
    levelPanel.className = "akira-panel";
    levelPanel.id = "akira-level-panel";

    levelPanel.innerHTML = `
      <div class="akira-kicker">PLAYER PROGRESSION</div>
      <div class="akira-heading">Уровень <span id="akira-level-copy">1</span></div>
      <div><b><span id="akira-xp">0</span> XP</b></div>
      <div class="akira-xpbar"><span id="akira-xp-fill"></span></div>
      <small style="color:var(--muted,#bd9aa7)">
        Выполняй задания, кликай и получай опыт для новых уровней.
      </small>
    `;

    const tasksPanel = document.createElement("section");
    tasksPanel.className = "tab-content";
    tasksPanel.id = "tab-tasks";
    tasksPanel.hidden = true;
    tasksPanel.innerHTML = `
      <div class="akira-panel">
        <div class="akira-kicker">MISSIONS</div>
        <div class="akira-heading">Задания</div>
        <div id="akira-tasks-list">Загрузка заданий...</div>
      </div>
    `;

    const gamesPanel = document.createElement("section");
    gamesPanel.className = "tab-content";
    gamesPanel.id = "tab-games";
    gamesPanel.hidden = true;
    gamesPanel.innerHTML = `
      <div class="akira-panel">
        <div class="akira-kicker">ARCADE</div>
        <div class="akira-heading">Мини-игры</div>
        <p>Проверь свою реакцию и получи награду.</p>
        <div class="akira-mini-grid">
          <div class="akira-mini">
            <div style="font-size:28px">⚡</div>
            <b>Реакция</b>
            <p>Дождись сигнала и нажми кнопку.</p>
            <button id="akira-reaction-start">Начать раунд</button>
            <button id="akira-reaction-hit" hidden>ЖМИ!</button>
            <small id="akira-game-status"></small>
          </div>
          <div class="akira-mini">
            <div style="font-size:28px">🎁</div>
            <b>Ежедневный бонус</b>
            <p>Забирай награду каждый день.</p>
            <button id="akira-game-daily">Забрать бонус</button>
          </div>
        </div>
      </div>
    `;

    main.append(levelPanel, tasksPanel, gamesPanel);

    const nav = $(".navbar");

    if (nav && !$('[data-tab="tasks"]')) {
      const tasksButton = document.createElement("button");
      tasksButton.type = "button";
      tasksButton.className = "nav-button";
      tasksButton.dataset.tab = "tasks";
      tasksButton.textContent = "🎯 Задания";
      nav.appendChild(tasksButton);

      const gamesButton = document.createElement("button");
      gamesButton.type = "button";
      gamesButton.className = "nav-button";
      gamesButton.dataset.tab = "games";
      gamesButton.textContent = "🎮 Игры";
      nav.appendChild(gamesButton);
    }

    const top = $("#tab-top");

    if (top && !$("#akira-periods")) {
      const periods = document.createElement("div");
      periods.className = "akira-periods";
      periods.id = "akira-periods";
      periods.innerHTML = `
        <button data-period="week" class="active">Неделя</button>
        <button data-period="month">Месяц</button>
        <button data-period="year">Год</button>
      `;

      top.prepend(periods);
    }
  }

  async function loadTasks() {
    const root = $("#akira-tasks-list");
    if (!root) return;

    root.textContent = "Загрузка заданий...";

    try {
      const data = await api("/api/tasks");
      tasks = data.tasks || [];
      renderTasks();
    } catch (error) {
      root.textContent = error.message || "Не удалось загрузить задания.";
    }
  }

  function renderTasks() {
    const root = $("#akira-tasks-list");
    if (!root || !tasks.length) return;

    root.replaceChildren();

    tasks.forEach(task => {
      const row = document.createElement("div");
      row.className = "akira-task";

      const main = document.createElement("div");
      main.className = "akira-task-main";

      const title = document.createElement("b");
      title.textContent = task.title;

      const description = document.createElement("small");
      description.textContent = task.description;

      const reward = document.createElement("small");
      reward.textContent = `Награда: ${task.coins} монет · ${task.xp} XP`;

      main.append(title, description, reward);

      if (task.goal > 1) {
        const progress = document.createElement("small");
        progress.textContent = `${fmt(task.progress)} / ${fmt(task.goal)}`;
        main.appendChild(progress);
      }

      const button = document.createElement("button");
      button.textContent = task.claimed
        ? "Получено"
        : task.completed
          ? "Забрать"
          : "Проверить";

      button.disabled =
        Boolean(task.claimed) ||
        (!task.completed && !task.subscription);

      button.addEventListener("click", async () => {
        try {
          const data = await api("/api/tasks/claim", {
            method: "POST",
            body: JSON.stringify({ key: task.key })
          });

          applyPlayer(data);
          toast(data.message || "Награда получена!");
          await loadTasks();
        } catch (error) {
          toast(error.message);
        }
      });

      row.append(main, button);
      root.appendChild(row);
    });
  }

  async function startReaction() {
    const start = $("#akira-reaction-start");
    const hit = $("#akira-reaction-hit");
    const status = $("#akira-game-status");

    try {
      const data = await api("/api/minigame/start", {
        method: "POST",
        body: JSON.stringify({})
      });

      challengeId = data.challengeId;
      start.hidden = true;
      hit.hidden = false;
      hit.disabled = true;
      status.textContent = "Жди сигнала...";

      gameTimeout = setTimeout(() => {
        if (hit.hidden) return;
        hit.disabled = false;
        status.textContent = "СЕЙЧАС!";
      }, Number(data.waitMs) || 2500);
    } catch (error) {
      toast(error.message);
    }
  }

  async function finishReaction() {
    const hit = $("#akira-reaction-hit");
    const start = $("#akira-reaction-start");
    const status = $("#akira-game-status");

    if (hit.disabled) return;

    clearTimeout(gameTimeout);
    hit.disabled = true;

    try {
      const data = await api("/api/minigame/finish", {
        method: "POST",
        body: JSON.stringify({ challengeId })
      });

      applyPlayer(data);
      status.textContent = data.message || "Раунд завершён!";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      hit.hidden = true;
      start.hidden = false;
      challengeId = null;
    }
  }

  function switchTab(tab) {
    $$(".nav-button[data-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });

    $$(".tab-content").forEach(panel => {
      panel.hidden = panel.id !== `tab-${tab}`;
    });

    if (tab === "top") loadLeaderboard();
    if (tab === "tasks") loadTasks();
  }

  function setTheme(theme) {
    const themes = {
      crimson: ["#10060b", "#ff4f79", "#ff879f", "#bd9aa7"],
      midnight: ["#090914", "#8b7cff", "#b8aaff", "#aaa8c7"],
      ocean: ["#06131b", "#16b8b0", "#79e4df", "#9abfc8"],
      emerald: ["#07150f", "#42d392", "#8cf0bd", "#9bc8b0"]
    };

    const values = themes[theme];
    if (!values) return;

    const root = document.documentElement;

    root.dataset.theme = theme;
    root.style.setProperty("--bg", values[0]);
    root.style.setProperty("--pink", values[1]);
    root.style.setProperty("--pink-light", values[2]);
    root.style.setProperty("--muted", values[3]);

    try {
      localStorage.setItem("akira-theme", theme);
    } catch {}

    $$(".theme-option[data-theme]").forEach(button => {
      button.classList.toggle("active", button.dataset.theme === theme);
    });
  }

  function initEvents() {
    $("#cookie-button")?.addEventListener("click", clickCookie);

    $$("[data-upgrade]").forEach(button => {
      button.addEventListener("click", () => {
        buyUpgrade(button.dataset.upgrade);
      });
    });

    $("#daily-button")?.addEventListener("click", claimDaily);
    $("#akira-game-daily")?.addEventListener("click", claimDaily);

    document.addEventListener("click", event => {
      const nav = event.target.closest(".nav-button[data-tab]");
      if (nav) switchTab(nav.dataset.tab);

      const period = event.target.closest("[data-period]");

      if (period) {
        $$("[data-period]").forEach(button => {
          button.classList.toggle("active", button === period);
        });

        loadLeaderboard();
      }

      const theme = event.target.closest(".theme-option[data-theme]");
      if (theme) setTheme(theme.dataset.theme);
    });

    $("#akira-reaction-start")?.addEventListener("click", startReaction);
    $("#akira-reaction-hit")?.addEventListener("click", finishReaction);
  }

  async function init() {
    mountStyle();
    mountNewSections();
    initEvents();

    let theme = "crimson";

    try {
      theme = localStorage.getItem("akira-theme") || theme;
    } catch {}

    setTheme(theme);

    await loadState();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
