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
      throw new Error(
        data.error || data.message || "Ошибка сервера"
      );
    }

    return data;
  }

  function toast(msg) {
    const el = $("#toast");

    if (!el) {
      console.log(msg);
      return;
    }

    el.hidden = false;
    el.textContent = msg;
    el.classList.add("show");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      el.classList.remove("show");
      el.hidden = true;
    }, 2600);
  }

  function applyPlayer(d) {
    const p = d?.player || d?.state || d;

    if (!p || typeof p !== "object") return;

    for (const k of [
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
      if (p[k] !== undefined) state[k] = p[k];
    }

    render();
  }

  function levelFromXp(xp) {
    let level = 1;
    let rest = Math.max(0, Number(xp) || 0);

    while (level < 10000 && rest >= level * 100) {
      rest -= level * 100;
      level++;
    }

    return level;
  }

  function render() {
    const lvl = Number(state.level) || levelFromXp(state.xp);

    const remaining = Math.max(
      0,
      lvl * 100 -
        (Number(state.xp) || 0) % Math.max(1, lvl * 100)
    );

    const map = {
      "#balance": fmt(state.coins),
      "#total-earned": fmt(state.totalEarned),
      "#click-power": fmt(
        state.clickPower ?? state.power ?? 1
      ),
      "#auto-power": fmt(state.autoLevel || 0),
      "#level": fmt(lvl),
      "#player-name": state.name || "Игрок",
      "#profile-balance": fmt(state.coins),
      "#profile-earned": fmt(state.totalEarned),
      "#profile-click": fmt(state.clickPower ?? 1),
      "#profile-auto": `${fmt(state.autoLevel || 0)}/с`,
      "#akira-xp": fmt(state.xp || 0),
      "#akira-next-xp": fmt(remaining)
    };

    Object.entries(map).forEach(([s, v]) => {
      const e = $(s);
      if (e) e.textContent = v;
    });

    const xpBar = $("#akira-xp-fill");

    if (xpBar) {
      xpBar.style.width = `${
        Math.min(
          100,
          ((Number(state.xp) || 0) %
            Math.max(1, lvl * 100)) /
            Math.max(1, lvl * 100) *
            100
        )
      }%`;
    }

    updatePrices();
    renderTasks();
  }

  function price(key) {
    const level =
      key === "click"
        ? Math.max(0, Number(state.clickPower || 1) - 1)
        : key === "auto"
          ? Number(state.autoLevel || 0)
          : Number(state.multiplierLevel || 0);

    const cfg = {
      click: [50, 1.65, 100],
      auto: [250, 1.8, 50],
      multiplier: [1000, 2.1, 25]
    }[key];

    return cfg
      ? {
          cost: Math.floor(cfg[0] * Math.pow(cfg[1], level)),
          max: level >= cfg[2]
        }
      : { cost: 0, max: false };
  }

  function updatePrices() {
    for (const key of ["click", "auto", "multiplier"]) {
      const p = price(key);

      const el = $(
        `#${key === "click" ? "finger" : key}-price`
      );

      if (el) el.textContent = p.max ? "MAX" : fmt(p.cost);

      const btn = $(`[data-upgrade="${key}"]`);

      if (btn) {
        btn.disabled = p.max || Number(state.coins) < p.cost;
        btn.title = p.max
          ? "Максимальный уровень"
          : `Цена: ${fmt(p.cost)}`;
      }
    }
  }

  async function loadState() {
    try {
      applyPlayer(await api("/api/state"));
    } catch (e) {
      console.error(e);
      toast(e.message);
    }
  }

  async function clickCookie() {
    if (busy || Date.now() - lastClick < 80) return;

    lastClick = Date.now();
    busy = true;

    const b = $("#cookie-button");

    if (b) {
      b.classList.remove("pop");
      void b.offsetWidth;
      b.classList.add("pop");
    }

    try {
      tg?.HapticFeedback?.impactOccurred("light");

      applyPlayer(
        await api("/api/click", {
          method: "POST",
          body: "{}"
        })
      );
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  async function buy(key) {
    try {
      const d = await api("/api/buy", {
        method: "POST",
        body: JSON.stringify({ upgrade: key })
      });

      applyPlayer(d);
      toast(d.message || "Улучшение куплено!");
    } catch (e) {
      toast(e.message);
    }
  }

  async function daily() {
    const b = $("#daily-button");

    if (b) b.disabled = true;

    try {
      const d = await api("/api/daily", {
        method: "POST",
        body: "{}"
      });

      applyPlayer(d);
      toast(d.message || "Награда получена!");
    } catch (e) {
      toast(e.message);
    } finally {
      if (b) b.disabled = false;
    }
  }

  async function leaderboard() {
    const root = $("#leaderboard");

    if (!root) return;

    root.innerHTML =
      '<p class="section-description">Загружаем рейтинг...</p>';

    const period =
      $("[data-period].active")?.dataset.period || "week";

    try {
      const rows = await api(
        `/api/leaderboard?period=${encodeURIComponent(period)}`
      );

      root.replaceChildren();

      if (!Array.isArray(rows) || !rows.length) {
        root.textContent = "Пока нет игроков в этом рейтинге.";
        return;
      }

      rows.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "leaderboard-item";

        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = String(p.rank ?? i + 1);

        const name = document.createElement("span");
        name.className = "player-name";
        name.textContent = p.name || "Игрок";

        const score = document.createElement("strong");
        score.textContent = fmt(p.score ?? 0);

        row.append(rank, name, score);
        root.append(row);
      });
    } catch (e) {
      root.textContent = e.message || "Не удалось загрузить топ.";
    }
  }

  function mountStyle() {
    if ($("#akira-extra-css")) return;

    const s = document.createElement("style");
    s.id = "akira-extra-css";

    s.textContent = `
      :root {
        --akira-accent: #ff477e;
      }

      .akira-panel {
        margin: 16px 0;
        padding: 20px;
        border: 1px solid var(--border, rgba(255,79,121,.25));
        border-radius: 24px;
        background: linear-gradient(
          145deg,
          rgba(53,16,32,.88),
          rgba(22,7,15,.94)
        );
        box-shadow: 0 14px 36px #0003;
        backdrop-filter: blur(18px);
      }

      .akira-kicker {
        font-size: 11px;
        letter-spacing: .2em;
        color: var(--muted, #bd9aa7);
        font-weight: 800;
      }

      .akira-heading {
        font-size: 22px;
        font-weight: 900;
        margin: 6px 0 14px;
      }

      .akira-xpbar {
        height: 9px;
        border-radius: 99px;
        background: #ffffff12;
        overflow: hidden;
        margin: 12px 0;
      }

      .akira-xpbar span {
        display: block;
        height: 100%;
        width: 0;
        background: linear-gradient(90deg, #ff477e, #ffb19b);
        transition: width .25s;
      }

      .akira-mini-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .akira-mini {
        padding: 15px;
        border-radius: 18px;
        background: #ffffff06;
        border: 1px solid #ffffff0d;
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
        background: linear-gradient(110deg, #ff477e, #ff8a72);
      }

      .akira-task {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 13px 0;
        border-bottom: 1px solid #ffffff10;
      }

      .akira-task:last-child {
        border: 0;
      }

      .akira-task-main {
        flex: 1;
        min-width: 0;
      }

      .akira-task small {
        display: block;
        color: var(--muted, #bd9aa7);
        margin-top: 3px;
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
        border: 1px solid #ff477e44;
        background: #ffffff05;
        color: inherit;
      }

      .akira-periods button.active {
        background: #ff477e;
        color: white;
      }

      .theme-option.active {
        outline: 2px solid #ff477e;
        outline-offset: 2px;
      }

      @media(max-width:380px) {
        .akira-panel {
          padding: 15px;
        }

        .akira-mini-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.append(s);
  }

  function mountNewSections() {
    const main = $("main");

    if (!main) return;

    const level = document.createElement("section");
    level.className = "akira-panel";
    level.id = "akira-level-panel";

    level.innerHTML = `
      <div class="akira-kicker">PLAYER PROGRESSION</div>

      <div class="akira-heading">
        Уровень <span id="akira-level-copy">1</span>
      </div>

      <div>
        <b><span id="akira-xp">0</span> XP</b>
        <span style="color:var(--muted)">
          · до следующего уровня
          <span id="akira-next-xp">100</span>
        </span>
      </div>

      <div class="akira-xpbar">
        <span id="akira-xp-fill"></span>
      </div>

      <small style="color:var(--muted)">
        Кликай, проходи задания и получай XP.
        Каждые 100 × текущий уровень XP открывают следующий уровень.
      </small>
    `;

    const missions = document.createElement("section");
    missions.className = "tab-content";
    missions.id = "tab-tasks";
    missions.hidden = true;

    missions.innerHTML = `
      <div class="akira-panel">
        <div class="akira-kicker">DAILY & PERMANENT</div>
        <div class="akira-heading">Задания</div>

        <p class="section-description">
          Выполняй задания и забирай награды в монетах и XP.
        </p>

        <div id="akira-tasks-list">
          Загрузка заданий...
        </div>
      </div>
    `;

    const games = document.createElement("section");
    games.className = "tab-content";
    games.id = "tab-games";
    games.hidden = true;

    games.innerHTML = `
      <div class="akira-panel">
        <div class="akira-kicker">ARCADE</div>
        <div class="akira-heading">Мини-игры</div>

        <p class="section-description">
          Проверь реакцию и получи небольшую награду.
        </p>

        <div class="akira-mini-grid">
          <div class="akira-mini">
            <div style="font-size:28px">⚡</div>
            <b>Реакция</b>

            <p class="section-description">
              Дождись сигнала и нажми вовремя.
            </p>

            <button id="akira-reaction-start">
              Начать раунд
            </button>

            <button id="akira-reaction-hit" hidden>
              ЖМИ!
            </button>

            <small id="akira-game-status"></small>
          </div>

          <div class="akira-mini">
            <div style="font-size:28px">🎁</div>
            <b>Ежедневный бонус</b>

            <p class="section-description">
              Не пропускай ежедневную награду в профиле.
            </p>

            <button id="akira-game-daily">
              Забрать бонус
            </button>
          </div>
        </div>
      </div>
    `;

    main.append(level, missions, games);

    const nav = $(".navbar");

    if (nav && !$('[data-tab="tasks"]')) {
      const b = document.createElement("button");
      b.className = "nav-button";
      b.dataset.tab = "tasks";
      b.type = "button";
      b.innerHTML = "<span>🎯</span> Задания";
      nav.append(b);

      const g = document.createElement("button");
      g.className = "nav-button";
      g.dataset.tab = "games";
      g.type = "button";
      g.innerHTML = "<span>🎮</span> Игры";
      nav.append(g);
    }

    const top = $("#tab-top");

    if (top && !$("[data-period]", top)) {
      const p = document.createElement("div");
      p.className = "akira-periods";

      p.innerHTML = `
        <button data-period="week" class="active">Неделя</button>
        <button data-period="month">Месяц</button>
        <button data-period="year">Год</button>
      `;

      top.querySelector(".card")?.insertBefore(
        p,
        $("#leaderboard")
      );
    }

    $("#akira-level-copy")?.replaceChildren(
      document.createTextNode(String(state.level || 1))
    );
  }

  async function loadTasks() {
    const root = $("#akira-tasks-list");

    if (!root) return;

    root.textContent = "Загрузка...";

    try {
      const d = await api("/api/tasks");
      tasks = d.tasks || [];
      renderTasks();
    } catch (e) {
      root.textContent =
        e.message || "Задания пока недоступны. Обнови сервер.";
    }
  }

  function renderTasks() {
    const root = $("#akira-tasks-list");

    if (!root || !tasks.length) return;

    root.replaceChildren();

    tasks.forEach(t => {
      const row = document.createElement("div");
      row.className = "akira-task";

      const main = document.createElement("div");
      main.className = "akira-task-main";

      const title = document.createElement("b");
      title.textContent = t.title;

      const desc = document.createElement("small");
      desc.textContent = t.description;

      const rewards = document.createElement("small");
      rewards.textContent =
        `Награда: ${t.coins} монет · ${t.xp} XP`;

      main.append(title, desc, rewards);

      if (t.goal > 1) {
        const prog = document.createElement("small");
        prog.textContent =
          `${fmt(t.progress)} / ${fmt(t.goal)}`;

        main.append(prog);
      }

      const button = document.createElement("button");

      button.textContent = t.claimed
        ? "Получено"
        : t.completed
          ? "Забрать"
          : "Проверить";

      button.disabled =
        !!t.claimed || (!t.completed && !t.subscription);

      button.addEventListener("click", async () => {
        if (t.subscription) {
          const channel = window.AKIRA_CHANNEL_URL;

          if (channel) {
            tg?.openTelegramLink?.(channel);
          }
        }

        try {
          const d = await api("/api/tasks/claim", {
            method: "POST",
            body: JSON.stringify({ key: t.key })
          });

          applyPlayer(d);
          toast(d.message || "Награда получена!");
          await loadTasks();
        } catch (e) {
          toast(e.message);
        }
      });

      row.append(main, button);
      root.append(row);
    });
  }

  let challengeId = null;
  let gameTimeout = null;

  async function startReaction() {
    const start = $("#akira-reaction-start");
    const hit = $("#akira-reaction-hit");
    const status = $("#akira-game-status");

    try {
      const d = await api("/api/minigame/start", {
        method: "POST",
        body: "{}"
      });

      challengeId = d.challengeId;

      start.hidden = true;
      hit.hidden = false;
      hit.disabled = true;

      status.textContent = "Жди зелёный сигнал...";

      gameTimeout = setTimeout(() => {
        if (hit.hidden) return;

        hit.disabled = false;
        status.textContent = "СЕЙЧАС!";
      }, Number(d.waitMs) || 2500);
    } catch (e) {
      toast(e.message);
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
      const d = await api("/api/minigame/finish", {
        method: "POST",
        body: JSON.stringify({ challengeId })
      });

      applyPlayer(d);
      status.textContent = d.message || "Раунд завершён!";
    } catch (e) {
      status.textContent = e.message;
    } finally {
      hit.hidden = true;
      start.hidden = false;
      challengeId = null;
    }
  }

  function switchTab(tab) {
    $$(".nav-button[data-tab]").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });

    $$(".tab-content").forEach(p => {
      p.hidden = p.id !== `tab-${tab}`;
    });

    if (tab === "top") leaderboard();
    if (tab === "tasks") loadTasks();
  }

  function setTheme(theme) {
    const vars = {
      crimson: [
        "#10060b",
        "#ff4f79",
        "#ff879f",
        "#bd9aa7"
      ],
      midnight: [
        "#090914",
        "#8b7cff",
        "#b8aaff",
        "#aaa8c7"
      ],
      ocean: [
        "#06131b",
        "#16b8b0",
        "#79e4df",
        "#9abfc8"
      ],
      emerald: [
        "#07150f",
        "#42d392",
        "#8cf0bd",
        "#9bc8b0"
      ]
    }[theme];

    if (!vars) return;

    const root = document.documentElement;
    root.dataset.theme = theme;

    root.style.setProperty("--bg", vars[0]);
    root.style.setProperty("--pink", vars[1]);
    root.style.setProperty("--pink-light", vars[2]);
    root.style.setProperty("--muted", vars[3]);

    try {
      localStorage.setItem("akira-theme", theme);
    } catch {}

    $$(".theme-option").forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.theme === theme
      );
    });
  }

  function events() {
    $("#cookie-button")?.addEventListener(
      "click",
      clickCookie
    );

    $$("[data-upgrade]").forEach(b => {
      b.addEventListener("click", () => {
        buy(b.dataset.upgrade);
      });
    });

    $("#daily-button")?.addEventListener("click", daily);

    document.addEventListener("click", e => {
      const nav = e.target.closest(
        ".nav-button[data-tab]"
      );

      if (nav) switchTab(nav.dataset.tab);

      const period = e.target.closest("[data-period]");

      if (period) {
        $$("[data-period]").forEach(b => {
          b.classList.toggle("active", b === period);
        });

        leaderboard();
      }

      const theme = e.target.closest(
        ".theme-option[data-theme]"
      );

      if (theme) setTheme(theme.dataset.theme);
    });

    $("#akira-reaction-start")?.addEventListener(
      "click",
      startReaction
    );

    $("#akira-reaction-hit")?.addEventListener(
      "click",
      finishReaction
    );

    $("#akira-game-daily")?.addEventListener(
      "click",
      daily
    );
  }

  async function init() {
    mountStyle();
    mountNewSections();
    events();

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
