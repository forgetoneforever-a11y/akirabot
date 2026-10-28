require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN =
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN ||
  "";
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || "";
const CHANNEL_URL = process.env.REQUIRED_CHANNEL_URL || "";

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL &&
    !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

const DAILY_REWARDS = [100, 150, 200, 250, 300, 400, 500];

const UPGRADES = {
  click: {
    base: 50,
    factor: 1.65,
    max: 100,
    column: "click_power"
  },
  auto: {
    base: 250,
    factor: 1.8,
    max: 50,
    column: "auto_level"
  },
  multiplier: {
    base: 1000,
    factor: 2.1,
    max: 25,
    column: "multiplier_level"
  }
};

function levelFromXp(xp) {
  let level = 1;
  let remaining = Math.max(0, Number(xp) || 0);

  while (level < 10000 && remaining >= level * 100) {
    remaining -= level * 100;
    level++;
  }

  return {
    level,
    currentXp: remaining,
    nextXp: level * 100
  };
}

function safePlayer(p) {
  if (!p) return null;

  const xp = Number(p.xp || 0);
  const progression = levelFromXp(xp);
  const clickPower = Math.max(1, Number(p.click_power || 1));
  const multiplierLevel = Number(p.multiplier_level || 0);
  const autoLevel = Number(p.auto_level || 0);

  return {
    id: String(p.telegram_id),
    name: p.name || "Игрок",
    coins: Number(p.coins || 0),
    totalEarned: Number(p.total_earned || 0),
    clickPower,
    power: clickPower,
    autoLevel,
    multiplierLevel,
    multiplier: Math.pow(2, multiplierLevel),
    streak: Number(p.streak || 0),
    xp,
    level: progression.level,
    levelXp: progression.currentXp,
    nextLevelXp: progression.nextXp,
    totalClicks: Number(p.total_clicks || 0)
  };
}

// Проверка подлинности Telegram WebApp initData
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      return null;
    }

    params.delete("hash");

    const authDate = Number(params.get("auth_date") || 0);
    const now = Math.floor(Date.now() / 1000);

    if (!authDate || now - authDate > 86400 || authDate - now > 60) {
      return null;
    }

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculated = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const suppliedBuffer = Buffer.from(hash, "hex");
    const calculatedBuffer = Buffer.from(calculated, "hex");

    if (
      suppliedBuffer.length !== calculatedBuffer.length ||
      !crypto.timingSafeEqual(suppliedBuffer, calculatedBuffer)
    ) {
      return null;
    }

    const user = JSON.parse(params.get("user") || "{}");

    return user.id ? user : null;
  } catch {
    return null;
  }
}

// Авторизация игрока
async function auth(req, res, next) {
  const initData =
    req.get("X-Telegram-Init-Data") ||
    req.body?.initData ||
    "";

  const telegramUser = verifyTelegramInitData(initData);

  if (telegramUser) {
    try {
      const id = String(telegramUser.id);

      const name =
        [
          telegramUser.first_name,
          telegramUser.last_name
        ]
          .filter(Boolean)
          .join(" ") ||
        telegramUser.username ||
        "Игрок";

      const result = await pool.query(
        `INSERT INTO players (telegram_id, name)
         VALUES ($1, $2)
         ON CONFLICT (telegram_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = NOW()
         RETURNING *`,
        [id, name]
      );

      req.player = result.rows[0];
      return next();
    } catch (e) {
      console.error("auth db:", e.message);

      return res.status(500).json({
        error: "Ошибка базы данных."
      });
    }
  }

  // Разрешено только для локальной разработки
  if (
    process.env.ALLOW_DEV_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    const id = String(req.get("X-Dev-Player") || "100000001");

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        error: "Неверный тестовый ID."
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO players (telegram_id, name)
         VALUES ($1, 'Тестовый игрок')
         ON CONFLICT (telegram_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [id]
      );

      req.player = result.rows[0];
      return next();
    } catch (e) {
      console.error("dev auth:", e.message);

      return res.status(500).json({
        error: "Ошибка базы данных."
      });
    }
  }

  return res.status(401).json({
    error: "Открой AKIRA через Telegram-бота."
  });
}

// Инициализация и миграция базы данных
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id BIGINT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Игрок',
      coins BIGINT NOT NULL DEFAULT 0,
      total_earned BIGINT NOT NULL DEFAULT 0,
      click_power INTEGER NOT NULL DEFAULT 1,
      auto_level INTEGER NOT NULL DEFAULT 0,
      multiplier_level INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      last_daily DATE,
      xp BIGINT NOT NULL DEFAULT 0,
      total_clicks BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Игрок';

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS coins BIGINT NOT NULL DEFAULT 0;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS total_earned BIGINT NOT NULL DEFAULT 0;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS click_power INTEGER NOT NULL DEFAULT 1;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS auto_level INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS multiplier_level INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS streak INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS last_daily DATE;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS total_clicks BIGINT NOT NULL DEFAULT 0;

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS earnings (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL
        REFERENCES players(telegram_id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS task_claims (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL
        REFERENCES players(telegram_id) ON DELETE CASCADE,
      task_key TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (telegram_id, task_key)
    );

    CREATE INDEX IF NOT EXISTS earnings_player_date_idx
      ON earnings (telegram_id, created_at DESC);
  `);

  console.log("AKIRA database initialized");
}

async function getPlayer(id) {
  const result = await pool.query(
    "SELECT * FROM players WHERE telegram_id = $1",
    [String(id)]
  );

  return result.rows[0];
}

function clickReward(player) {
  return (
    Math.max(1, Number(player.click_power || 1)) *
    Math.max(1, Math.pow(2, Number(player.multiplier_level || 0)))
  );
}

// Состояние игрока
app.get("/api/state", auth, async (req, res) => {
  try {
    const player = await getPlayer(req.player.telegram_id);
    res.json(safePlayer(player));
  } catch (e) {
    console.error("state:", e.message);

    res.status(500).json({
      error: "Не удалось загрузить данные игрока."
    });
  }
});

// Клик
app.post("/api/click", auth, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const selected = await client.query(
      `SELECT * FROM players
       WHERE telegram_id = $1
       FOR UPDATE`,
      [String(req.player.telegram_id)]
    );

    const player = selected.rows[0];

    if (!player) {
      throw new Error("Игрок не найден.");
    }

    const reward = clickReward(player);

    const result = await client.query(
      `UPDATE players
       SET coins = coins + $2,
           total_earned = total_earned + $2,
           xp = xp + 1,
           total_clicks = total_clicks + 1,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [String(req.player.telegram_id), reward]
    );

    await client.query(
      `INSERT INTO earnings (telegram_id, amount)
       VALUES ($1, $2)`,
      [String(req.player.telegram_id), reward]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(result.rows[0]),
      gained: reward,
      gainedXp: 1
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("click:", e.message);

    res.status(500).json({
      error: "Не удалось сохранить клик."
    });
  } finally {
    client.release();
  }
});

// Информация об улучшениях
app.get("/api/upgrades", auth, async (req, res) => {
  try {
    const p = await getPlayer(req.player.telegram_id);

    if (!p) {
      return res.status(404).json({
        error: "Игрок не найден."
      });
    }

    const levels = {
      click: Math.max(0, Number(p.click_power || 1) - 1),
      auto: Number(p.auto_level || 0),
      multiplier: Number(p.multiplier_level || 0)
    };

    const result = {};

    for (const [key, config] of Object.entries(UPGRADES)) {
      const level = levels[key];
      const cost = Math.floor(
        config.base * Math.pow(config.factor, level)
      );

      result[key] = {
        level,
        cost,
        max: level >= config.max,
        affordable: Number(p.coins) >= cost
      };
    }

    res.json(result);
  } catch (e) {
    console.error("upgrades:", e.message);

    res.status(500).json({
      error: "Не удалось загрузить улучшения."
    });
  }
});

// Покупка улучшения
app.post("/api/buy", auth, async (req, res) => {
  const key = String(req.body?.upgrade || req.body?.type || "");
  const config = UPGRADES[key];

  if (!config) {
    return res.status(400).json({
      error: "Неизвестное улучшение."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r = await client.query(
      `SELECT * FROM players
       WHERE telegram_id = $1
       FOR UPDATE`,
      [String(req.player.telegram_id)]
    );

    const p = r.rows[0];

    if (!p) {
      throw new Error("Игрок не найден.");
    }

    const level =
      key === "click"
        ? Math.max(0, Number(p.click_power || 1) - 1)
        : key === "auto"
          ? Number(p.auto_level || 0)
          : Number(p.multiplier_level || 0);

    if (level >= config.max) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Уже достигнут максимальный уровень."
      });
    }

    const cost = Math.floor(
      config.base * Math.pow(config.factor, level)
    );

    if (Number(p.coins) < cost) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Недостаточно монет."
      });
    }

    // Имя столбца берётся только из серверной конфигурации
    const updated = await client.query(
      `UPDATE players
       SET coins = coins - $2,
           ${config.column} = ${config.column} + 1,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [String(req.player.telegram_id), cost]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(updated.rows[0]),
      message: "Улучшение куплено!"
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("buy:", e.message);

    res.status(500).json({
      error: "Не удалось купить улучшение."
    });
  } finally {
    client.release();
  }
});

// Ежедневная награда
app.post("/api/daily", auth, async (req, res) => {
  const id = String(req.player.telegram_id);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r = await client.query(
      `SELECT *,
              CURRENT_DATE AS today
       FROM players
       WHERE telegram_id = $1
       FOR UPDATE`,
      [id]
    );

    const p = r.rows[0];

    if (!p) {
      throw new Error("Игрок не найден.");
    }

    const today = String(p.today).slice(0, 10);
    const last = p.last_daily
      ? String(p.last_daily).slice(0, 10)
      : null;

    if (last === today) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Ежедневная награда уже получена."
      });
    }

    const yesterday = await client.query(
      "SELECT ($1::date - $2::date) AS difference",
      [today, last || today]
    );

    const streak =
      last && Number(yesterday.rows[0].difference) === 1
        ? Number(p.streak) + 1
        : 1;

    const reward =
      DAILY_REWARDS[(streak - 1) % DAILY_REWARDS.length];

    const updated = await client.query(
      `UPDATE players
       SET coins = coins + $2,
           total_earned = total_earned + $2,
           xp = xp + 25,
           streak = $3,
           last_daily = $4,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [id, reward, streak, today]
    );

    await client.query(
      `INSERT INTO earnings (telegram_id, amount)
       VALUES ($1, $2)`,
      [id, reward]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(updated.rows[0]),
      gained: reward,
      gainedXp: 25,
      message: `+${reward} монет и +25 XP!`
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("daily:", e.message);

    res.status(500).json({
      error: "Не удалось получить награду."
    });
  } finally {
    client.release();
  }
});

// Рейтинг
app.get("/api/leaderboard", auth, async (req, res) => {
  const period = String(req.query.period || "week");

  const intervals = {
    week: "7 days",
    month: "30 days",
    year: "365 days"
  };

  const interval = intervals[period];

  if (!interval) {
    return res.status(400).json({
      error: "Неверный период рейтинга."
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         p.telegram_id,
         p.name,
         COALESCE(SUM(e.amount), 0) AS score
       FROM players p
       LEFT JOIN earnings e
         ON e.telegram_id = p.telegram_id
         AND e.created_at >= NOW() - $1::interval
       GROUP BY p.telegram_id, p.name
       ORDER BY score DESC, p.name ASC
       LIMIT 100`,
      [interval]
    );

    res.json(
      result.rows.map((p, i) => ({
        rank: i + 1,
        name: p.name,
        score: Number(p.score)
      }))
    );
  } catch (e) {
    console.error("leaderboard:", e.message);

    res.status(500).json({
      error: "Не удалось загрузить рейтинг."
    });
  }
});

// Задания
function taskList(p, claims) {
  const claimed = new Set(claims);
  const level = levelFromXp(Number(p.xp)).level;

  return [
    {
      key: "click_50",
      title: "Разминка",
      description: "Сделай 50 кликов",
      progress: Math.min(50, Number(p.total_clicks)),
      goal: 50,
      coins: 100,
      xp: 50,
      completed: Number(p.total_clicks) >= 50
    },
    {
      key: "earn_1000",
      title: "Первая тысяча",
      description: "Заработай 1 000 монет за всё время",
      progress: Math.min(1000, Number(p.total_earned)),
      goal: 1000,
      coins: 250,
      xp: 100,
      completed: Number(p.total_earned) >= 1000
    },
    {
      key: "subscribe_channel",
      title: "Поддержи AKIRA",
      description: "Подпишись на Telegram-канал",
      progress: 0,
      goal: 1,
      coins: 500,
      xp: 300,
      completed: false,
      subscription: true
    },
    {
      key: "level_5",
      title: "Новичок",
      description: "Достигни 5 уровня",
      progress: Math.min(5, level),
      goal: 5,
      coins: 500,
      xp: 150,
      completed: level >= 5
    }
  ].map(task => ({
    ...task,
    claimed: claimed.has(task.key)
  }));
}

// Получение заданий
app.get("/api/tasks", auth, async (req, res) => {
  try {
    const p = await getPlayer(req.player.telegram_id);

    const claims = await pool.query(
      `SELECT task_key
       FROM task_claims
       WHERE telegram_id = $1`,
      [String(req.player.telegram_id)]
    );

    res.json({
      tasks: taskList(
        p,
        claims.rows.map(r => r.task_key)
      ),
      channelUrl: CHANNEL_URL
    });
  } catch (e) {
    console.error("tasks:", e.message);

    res.status(500).json({
      error: "Не удалось загрузить задания."
    });
  }
});

// Получение награды за задание
app.post("/api/tasks/claim", auth, async (req, res) => {
  const key = String(req.body?.key || "");
  const id = String(req.player.telegram_id);

  const rewards = {
    click_50: { coins: 100, xp: 50 },
    earn_1000: { coins: 250, xp: 100 },
    subscribe_channel: { coins: 500, xp: 300 },
    level_5: { coins: 500, xp: 150 }
  };

  if (!rewards[key]) {
    return res.status(400).json({
      error: "Неизвестное задание."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r = await client.query(
      `SELECT * FROM players
       WHERE telegram_id = $1
       FOR UPDATE`,
      [id]
    );

    const p = r.rows[0];

    if (!p) {
      throw new Error("Игрок не найден.");
    }

    const existing = await client.query(
      `SELECT 1 FROM task_claims
       WHERE telegram_id = $1 AND task_key = $2`,
      [id, key]
    );

    if (existing.rowCount) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Награда за это задание уже получена."
      });
    }

    if (key === "click_50" && Number(p.total_clicks) < 50) {
      throw new Error("Сначала сделай 50 кликов.");
    }

    if (key === "earn_1000" && Number(p.total_earned) < 1000) {
      throw new Error("Сначала заработай 1 000 монет.");
    }

    if (key === "level_5" && levelFromXp(Number(p.xp)).level < 5) {
      throw new Error("Сначала достигни 5 уровня.");
    }

    if (key === "subscribe_channel") {
      if (!BOT_TOKEN || !REQUIRED_CHANNEL) {
        throw new Error(
          "Администратору нужно настроить REQUIRED_CHANNEL в Render."
        );
      }

      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember` +
        `?chat_id=${encodeURIComponent(REQUIRED_CHANNEL)}` +
        `&user_id=${encodeURIComponent(id)}`
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          "Не удалось проверить подписку. Проверь настройки канала."
        );
      }

      const status = data.result?.status;
      const subscribed =
        ["member", "administrator", "creator"].includes(status) ||
        (status === "restricted" && data.result?.is_member === true);

      if (!subscribed) {
        throw new Error(
          "Подпишись на канал и нажми проверить ещё раз."
        );
      }
    }

    const reward = rewards[key];

    await client.query(
      `INSERT INTO task_claims (telegram_id, task_key)
       VALUES ($1, $2)`,
      [id, key]
    );

    const updated = await client.query(
      `UPDATE players
       SET coins = coins + $2,
           total_earned = total_earned + $2,
           xp = xp + $3,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [id, reward.coins, reward.xp]
    );

    await client.query(
      `INSERT INTO earnings (telegram_id, amount)
       VALUES ($1, $2)`,
      [id, reward.coins]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(updated.rows[0]),
      gained: reward.coins,
      gainedXp: reward.xp,
      message: `+${reward.coins} монет и +${reward.xp} XP!`
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("task claim:", e.message);

    const clientError =
      /Сначала|Подпишись|настроить REQUIRED_CHANNEL|Не удалось проверить подписку/.test(
        e.message
      );

    res.status(clientError ? 400 : 500).json({
      error: e.message || "Не удалось получить награду."
    });
  } finally {
    client.release();
  }
});

// Мини-игра: начало раунда
const activeGames = new Map();

app.post("/api/minigame/start", auth, async (req, res) => {
  const id = String(req.player.telegram_id);
  const challengeId = crypto.randomBytes(16).toString("hex");
  const waitMs = crypto.randomInt(1800, 4500);

  activeGames.set(id, {
    challengeId,
    readyAt: Date.now() + waitMs,
    expiresAt: Date.now() + waitMs + 10000
  });

  res.json({
    challengeId,
    waitMs
  });
});

// Мини-игра: завершение раунда
app.post("/api/minigame/finish", auth, async (req, res) => {
  const id = String(req.player.telegram_id);
  const game = activeGames.get(id);

  if (!game || req.body?.challengeId !== game.challengeId) {
    return res.status(400).json({
      error: "Начни новый раунд."
    });
  }

  if (Date.now() < game.readyAt) {
    return res.status(400).json({
      error: "Слишком рано! Дождись сигнала."
    });
  }

  if (Date.now() > game.expiresAt) {
    activeGames.delete(id);

    return res.status(400).json({
      error: "Время раунда истекло."
    });
  }

  activeGames.delete(id);

  const coins = crypto.randomInt(40, 101);
  const xp = 15;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE players
       SET coins = coins + $2,
           total_earned = total_earned + $2,
           xp = xp + $3,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [id, coins, xp]
    );

    if (!result.rows[0]) {
      throw new Error("Игрок не найден.");
    }

    await client.query(
      `INSERT INTO earnings (telegram_id, amount)
       VALUES ($1, $2)`,
      [id, coins]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(result.rows[0]),
      gained: coins,
      gainedXp: xp,
      message: `+${coins} монет и +${xp} XP!`
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("minigame finish:", e.message);

    res.status(500).json({
      error: "Не удалось сохранить награду."
    });
  } finally {
    client.release();
  }
});

// Проверка сервера для Render
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Главная страница
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Обработка ошибок Express
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Внутренняя ошибка сервера."
  });
});

// Запуск после успешной инициализации БД
initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`AKIRA listening on ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
