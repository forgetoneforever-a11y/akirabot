
require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");

const app = express();

app.use(express.json({ limit: "32kb" }));
app.use(express.static("public"));

const token = process.env.BOT_TOKEN;
const webappUrl = process.env.WEBAPP_URL;
const port = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

let bot = null;

// -------------------- БАЗА ДАННЫХ --------------------

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      coins BIGINT NOT NULL DEFAULT 0,
      total_earned BIGINT NOT NULL DEFAULT 0,
      click_power INTEGER NOT NULL DEFAULT 1,
      auto_level INTEGER NOT NULL DEFAULT 0,
      multiplier_level INTEGER NOT NULL DEFAULT 0,
      last_daily DATE,
      streak INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS earnings (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL
        REFERENCES players(telegram_id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS earnings_user_date_idx
      ON earnings(telegram_id, created_at);

    CREATE TABLE IF NOT EXISTS purchases (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL
        REFERENCES players(telegram_id) ON DELETE CASCADE,
      upgrade TEXT NOT NULL,
      cost BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// -------------------- TELEGRAM AUTH --------------------

function validateInitData(initData) {
  if (!token || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(token)
    .digest();

  const calculated = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "hex");
  const calculatedBuffer = Buffer.from(calculated, "hex");

  if (
    hashBuffer.length !== calculatedBuffer.length ||
    !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)
  ) {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);
  const age = Date.now() / 1000 - authDate;

  if (!authDate || age < -60 || age > 86400) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");

    if (!user || !user.id) return null;

    return user;
  } catch {
    return null;
  }
}

async function ensurePlayer(user) {
  const result = await pool.query(
    `INSERT INTO players (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       updated_at = NOW()
     RETURNING *`,
    [
      String(user.id),
      user.username || null,
      user.first_name || "Игрок"
    ]
  );

  return result.rows[0];
}

async function auth(req, res, next) {
  const user = validateInitData(req.get("x-telegram-init-data"));

  if (!user) {
    return res.status(401).json({
      error: "Открой AKIRA через Telegram-бота."
    });
  }

  try {
    req.player = await ensurePlayer(user);
    next();
  } catch (error) {
    console.error("Ошибка авторизации:", error.message);

    return res.status(500).json({
      error: "Ошибка базы данных."
    });
  }
}

// Сохраняем старые названия полей и добавляем совместимость с app.js.
function safePlayer(player) {
  const coins = Number(player.coins);
  const earned = Number(player.total_earned);
  const power = Number(player.click_power);
  const autoLevel = Number(player.auto_level);
  const multiplierLevel = Number(player.multiplier_level);

  return {
    coins,
    totalEarned: earned,
    earned,
    clickPower: power,
    power,
    autoLevel,
    multiplierLevel,
    multiplier: 1 + multiplierLevel,
    streak: Number(player.streak),
    name: player.first_name || player.username || "Игрок"
  };
}

function getMultiplier(player) {
  return 1 + Number(player.multiplier_level);
}

// -------------------- СЛУЖЕБНЫЕ МАРШРУТЫ --------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "AKIRA" });
});

// -------------------- СОСТОЯНИЕ ИГРОКА --------------------

app.get("/api/state", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM players WHERE telegram_id = $1",
      [String(req.player.telegram_id)]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Игрок не найден." });
    }

    res.json(safePlayer(result.rows[0]));
  } catch (error) {
    console.error("Ошибка загрузки состояния:", error.message);
    res.status(500).json({ error: "Не удалось загрузить игру." });
  }
});

// -------------------- КЛИКИ --------------------

app.post("/api/click", auth, async (req, res) => {
  const id = String(req.player.telegram_id);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [id]
    );

    const player = result.rows[0];

    if (!player) {
      throw new Error("Игрок не найден.");
    }

    const amount = Math.max(
      1,
      Number(player.click_power) * getMultiplier(player)
    );

    const updated = await client.query(
      `UPDATE players
       SET coins = coins + $2,
           total_earned = total_earned + $2,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [id, amount]
    );

    await client.query(
      "INSERT INTO earnings (telegram_id, amount) VALUES ($1, $2)",
      [id, amount]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(updated.rows[0]),
      gained: amount
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Ошибка клика:", error.message);

    res.status(500).json({
      error: "Не удалось начислить монеты."
    });
  } finally {
    client.release();
  }
});

// -------------------- МАГАЗИН --------------------

const upgrades = {
  click: {
    label: "Сильный палец",
    base: 50,
    factor: 1.65,
    max: 100
  },
  auto: {
    label: "Автокликер",
    base: 250,
    factor: 1.8,
    max: 50
  },
  multiplier: {
    label: "Множитель",
    base: 1000,
    factor: 2.1,
    max: 25
  }
};

app.get("/api/upgrades", auth, (_req, res) => {
  res.json(
    Object.entries(upgrades).map(([key, upgrade]) => ({
      key,
      ...upgrade
    }))
  );
});

app.post("/api/buy", auth, async (req, res) => {
  const key = req.body && req.body.upgrade;
  const config = upgrades[key];

  if (!config) {
    return res.status(400).json({
      error: "Такого улучшения нет."
    });
  }

  const id = String(req.player.telegram_id);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [id]
    );

    const player = result.rows[0];

    if (!player) {
      throw new Error("Игрок не найден.");
    }

    const level =
      key === "click"
        ? player.click_power - 1
        : key === "auto"
          ? player.auto_level
          : player.multiplier_level;

    if (level >= config.max) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Максимальный уровень уже достигнут."
      });
    }

    const cost = Math.floor(
      config.base * Math.pow(config.factor, level)
    );

    if (Number(player.coins) < cost) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Не хватает монет."
      });
    }

    // Названия полей заданы сервером, а не пользовательским вводом.
    const updateField =
      key === "click"
        ? "click_power = click_power + 1"
        : key === "auto"
          ? "auto_level = auto_level + 1"
          : "multiplier_level = multiplier_level + 1";

    await client.query(
      `UPDATE players
       SET coins = coins - $2,
           ${updateField},
           updated_at = NOW()
       WHERE telegram_id = $1`,
      [id, cost]
    );

    await client.query(
      `INSERT INTO purchases (telegram_id, upgrade, cost)
       VALUES ($1, $2, $3)`,
      [id, key, cost]
    );

    const updated = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1",
      [id]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(updated.rows[0]),
      bought: key,
      cost,
      message: "Улучшение куплено!"
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Ошибка покупки:", error.message);

    res.status(500).json({
      error: "Покупка не удалась."
    });
  } finally {
    client.release();
  }
});

// -------------------- ЕЖЕДНЕВНАЯ НАГРАДА --------------------

app.post("/api/daily", auth, async (req, res) => {
  const id = String(req.player.telegram_id);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [id]
    );

    const player = result.rows[0];

    if (!player) {
      throw new Error("Игрок не найден.");
    }

    // Используем UTC-день, чтобы дата была стабильной на сервере.
    const today = new Date().toISOString().slice(0, 10);
    const lastDaily = player.last_daily
      ? new Date(player.last_daily).toISOString().slice(0, 10)
      : null;

    if (lastDaily === today) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Награда уже получена сегодня."
      });
    }

    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);

    const streak =
      lastDaily === yesterday ? Number(player.streak) + 1 : 1;

    const reward = 100 + Math.min(streak, 7) * 50;

    const updated = await client.query(
      `UPDATE players
       SET coins = coins + $2,
           total_earned = total_earned + $2,
           last_daily = $3,
           streak = $4,
           updated_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [id, reward, today, streak]
    );

    await client.query(
      "INSERT INTO earnings (telegram_id, amount) VALUES ($1, $2)",
      [id, reward]
    );

    await client.query("COMMIT");

    res.json({
      ...safePlayer(updated.rows[0]),
      gained: reward,
      message: `Получено ${reward} монет!`
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Ошибка ежедневной награды:", error.message);

    res.status(500).json({
      error: "Не удалось забрать награду."
    });
  } finally {
    client.release();
  }
});

// -------------------- РЕЙТИНГ --------------------

app.get("/api/leaderboard", auth, async (req, res) => {
  const period = ["week", "month", "year"].includes(req.query.period)
    ? req.query.period
    : "week";

  const interval =
    period === "week"
      ? "7 days"
      : period === "month"
        ? "1 month"
        : "1 year";

  try {
    const result = await pool.query(
      `SELECT
         p.telegram_id,
         COALESCE(p.username, p.first_name, 'Игрок') AS name,
         SUM(e.amount)::bigint AS score
       FROM earnings e
       JOIN players p ON p.telegram_id = e.telegram_id
       WHERE e.created_at >= NOW() - $1::interval
       GROUP BY p.telegram_id, p.username, p.first_name
       ORDER BY score DESC
       LIMIT 50`,
      [interval]
    );

    res.json(
      result.rows.map((row, index) => ({
        rank: index + 1,
        name: row.name,
        score: Number(row.score)
      }))
    );
  } catch (error) {
    console.error("Ошибка рейтинга:", error.message);

    res.status(500).json({
      error: "Не удалось загрузить рейтинг."
    });
  }
});

// -------------------- TELEGRAM BOT --------------------

async function setOpenMenuButton() {
  // Настраивает постоянную кнопку меню Mini App в личном чате.
  // Telegram отображает её в области рядом с полем ввода.
  const response = await fetch(
    `https://api.telegram.org/bot${token}/setChatMenuButton`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        menu_button: {
          type: "web_app",
          text: "OPEN",
          web_app: {
            url: webappUrl
          }
        }
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.description || `Telegram API error ${response.status}`
    );
  }

  console.log("Кнопка OPEN настроена.");
}

async function startBot() {
  if (!token) {
    console.warn("BOT_TOKEN не задан — бот не запускается.");
    return;
  }

  if (!webappUrl || !/^https:\/\/.+/.test(webappUrl)) {
    console.warn("WEBAPP_URL должен быть HTTPS-адресом.");
    return;
  }

  try {
    await setOpenMenuButton();
  } catch (error) {
    console.error(
      "Не удалось настроить кнопку OPEN:",
      error.message
    );
  }

  bot = new TelegramBot(token, {
    polling: true
  });

  bot.onText(/^\/start(?:@\w+)?(?:\s.*)?$/, async (msg) => {
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🍪 Играть в AKIRA",
              web_app: {
                url: webappUrl
              }
            }
          ]
        ]
      }
    };

    try {
      await bot.sendMessage(
        msg.chat.id,
        `🔥 Добро пожаловать в AKIRA, ${
          msg.from.first_name || "игрок"
        }!\n\nКликай печеньку, прокачивай автокликер и залетай в топ лидеров.`,
        opts
      );
    } catch (error) {
      console.error("Ошибка отправки приветствия:", error.message);
    }
  });

  bot.onText(/^\/help(?:@\w+)?$/, async (msg) => {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "Команды:\n/start — открыть игру\n/help — помощь"
      );
    } catch (error) {
      console.error("Ошибка отправки помощи:", error.message);
    }
  });

  bot.on("polling_error", (error) => {
    console.error("Telegram polling:", error.message);
  });

  console.log("Telegram-бот AKIRA запущен.");
}

// -------------------- ЗАПУСК СЕРВЕРА --------------------

async function startServer() {
  await initDb();

  app.listen(port, "0.0.0.0", () => {
    console.log(`AKIRA listening on ${port}`);
  });

  await startBot();
}

startServer().catch((error) => {
  console.error("Startup error:", error);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  console.log("Завершение работы AKIRA...");

  try {
    if (bot) {
      await bot.stopPolling();
    }

    await pool.end();
  } catch (error) {
    console.error("Ошибка завершения:", error.message);
  }

  process.exit(0);
});
