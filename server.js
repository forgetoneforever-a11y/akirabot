
"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";

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

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function upgradePrice(type, player) {
  const config = UPGRADES[type];
  if (!config) return 0;

  const level = Number(player[config.column] || 0);
  return Math.floor(config.base * Math.pow(config.factor, level));
}

function publicPlayer(player) {
  const multiplier = Number(player.multiplier_level || 0);
  const clickPower = Number(player.click_power || 1);

  return {
    ...player,
    balance: Number(player.balance || 0),
    total_earned: Number(player.total_earned || 0),
    click_power: clickPower,
    auto_level: Number(player.auto_level || 0),
    auto_power: Number(player.auto_level || 0),
    multiplier_level: multiplier,
    level: Math.max(
      1,
      Math.floor(Math.sqrt(Number(player.total_earned || 0) / 1000)) + 1
    ),
    click_price: upgradePrice("click", player),
    auto_price: upgradePrice("auto", player),
    multiplier_price: upgradePrice("multiplier", player)
  };
}

/*
 * Telegram WebApp authentication.
 * If BOT_TOKEN is configured, requests carrying initData are verified.
 * For production, configure BOT_TOKEN in Render environment variables.
 */
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) return { valid: true, user: null };
  if (!initData) return { valid: false, user: null };

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash) return { valid: false, user: null };

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secret = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");

    const a = Buffer.from(calculatedHash, "hex");
    const b = Buffer.from(receivedHash, "hex");

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, user: null };
    }

    const authDate = Number(params.get("auth_date") || 0);

    if (!authDate || Date.now() / 1000 - authDate > 86400) {
      return { valid: false, user: null };
    }

    const user = JSON.parse(params.get("user") || "null");
    if (!user?.id) return { valid: false, user: null };

    return { valid: true, user };
  } catch {
    return { valid: false, user: null };
  }
}

async function getPlayer(req, res, next) {
  try {
    const initData = req.get("X-Telegram-Init-Data") || "";
    const auth = verifyTelegramInitData(initData);

    if (!auth.valid) {
      return res.status(401).json({
        error: "Не удалось подтвердить Telegram-пользователя. Перезапусти Mini App."
      });
    }

    let telegramId;
    let username = "Игрок";
    let firstName = "Игрок";

    if (auth.user) {
      telegramId = String(auth.user.id);
      username = auth.user.username || auth.user.first_name || "Игрок";
      firstName = auth.user.first_name || username;
    } else {
      // Режим локальной проверки без настроенного BOT_TOKEN.
      telegramId = String(
        req.body?.telegram_id ||
        req.query?.telegram_id ||
        req.get("X-Player-Id") ||
        "local-player"
      );
    }

    await pool.query(
      `INSERT INTO players
        (telegram_id, username, name, balance, total_earned,
         click_power, auto_level, multiplier_level)
       VALUES ($1, $2, $3, 0, 0, 1, 0, 0)
       ON CONFLICT (telegram_id) DO UPDATE
       SET username = CASE
         WHEN players.username IS NULL OR players.username = ''
         THEN EXCLUDED.username ELSE players.username END,
       name = CASE
         WHEN players.name IS NULL OR players.name = ''
         THEN EXCLUDED.name ELSE players.name END`,
      [telegramId, username, firstName]
    );

    const result = await pool.query(
      "SELECT * FROM players WHERE telegram_id = $1",
      [telegramId]
    );

    req.player = result.rows[0];
    req.telegramUser = auth.user;
    next();
  } catch (error) {
    next(error);
  }
}

app.use("/api", getPlayer);

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "AKIRA" });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(500).json({ ok: false, database: "error" });
  }
});

app.get("/api/state", (req, res) => {
  res.json({
    ok: true,
    player: publicPlayer(req.player)
  });
});

app.post("/api/click", async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [req.player.telegram_id]
    );

    const player = result.rows[0];
    const reward =
      Number(player.click_power || 1) *
      Math.pow(2, Number(player.multiplier_level || 0));

    const updated = await client.query(
      `UPDATE players
       SET balance = balance + $1,
           total_earned = total_earned + $1
       WHERE telegram_id = $2
       RETURNING *`,
      [reward, player.telegram_id]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      reward,
      player: publicPlayer(updated.rows[0])
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

async function purchaseUpgrade(req, res, next) {
  const type = req.body?.upgrade || req.body?.type;

  if (!UPGRADES[type]) {
    return res.status(400).json({ error: "Неизвестное улучшение" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [req.player.telegram_id]
    );

    const player = result.rows[0];
    const config = UPGRADES[type];
    const level = Number(player[config.column] || 0);

    if (level >= config.max) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Улучшение уже достигло максимального уровня"
      });
    }

    const cost = upgradePrice(type, player);

    if (Number(player.balance || 0) < cost) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Недостаточно монет",
        price: cost,
        balance: Number(player.balance || 0)
      });
    }

    // Название столбца берётся только из фиксированной конфигурации.
    const updated = await client.query(
      `UPDATE players
       SET balance = balance - $1,
           ${config.column} = ${config.column} + 1
       WHERE telegram_id = $2
       RETURNING *`,
      [cost, player.telegram_id]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      message: "Улучшение куплено!",
      cost,
      player: publicPlayer(updated.rows[0])
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

// Поддерживаем оба адреса, чтобы старый клиент не получал 404.
app.post("/api/buy", purchaseUpgrade);
app.post("/api/upgrades", purchaseUpgrade);

app.post("/api/daily", async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [req.player.telegram_id]
    );

    const player = result.rows[0];
    const today = new Date().toISOString().slice(0, 10);

    if (player.last_daily && String(player.last_daily).slice(0, 10) === today) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Ежедневная награда уже получена сегодня"
      });
    }

    const reward = 500;

    const updated = await client.query(
      `UPDATE players
       SET balance = balance + $1,
           total_earned = total_earned + $1,
           last_daily = CURRENT_DATE
       WHERE telegram_id = $2
       RETURNING *`,
      [reward, player.telegram_id]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      reward,
      message: `Получено ${reward} монет!`,
      player: publicPlayer(updated.rows[0])
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/leaderboard", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT name, username, balance, total_earned
       FROM players
       ORDER BY total_earned DESC, balance DESC
       LIMIT 50`
    );

    res.json({
      ok: true,
      players: result.rows.map((player, index) => ({
        rank: index + 1,
        name: player.name || player.username || "Игрок",
        balance: Number(player.balance || 0),
        total_earned: Number(player.total_earned || 0),
        score: Number(player.total_earned || 0)
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", (req, res) => {
  res.json({ ok: true, tasks: [] });
});

app.post("/api/tasks/claim", (req, res) => {
  res.status(501).json({ error: "Задания пока не настроены" });
});

app.post("/api/minigame/start", (req, res) => {
  res.status(501).json({ error: "Мини-игра пока не настроена" });
});

app.post("/api/minigame/finish", (req, res) => {
  res.status(501).json({ error: "Мини-игра пока не настроена" });
});

// Статические файлы Mini App.
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => {
  res.status(404).json({
    error: "Маршрут не найден",
    path: req.path
  });
});

app.use((error, req, res, next) => {
  console.error("[AKIRA SERVER]", error);

  if (res.headersSent) return next(error);

  res.status(500).json({
    error: "Внутренняя ошибка сервера"
  });
});

async function start() {
  // Создаём таблицу, если её ещё нет.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT DEFAULT 'Игрок',
      name TEXT DEFAULT 'Игрок',
      balance BIGINT NOT NULL DEFAULT 0,
      total_earned BIGINT NOT NULL DEFAULT 0,
      click_power INTEGER NOT NULL DEFAULT 1,
      auto_level INTEGER NOT NULL DEFAULT 0,
      multiplier_level INTEGER NOT NULL DEFAULT 0,
      last_daily DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Добавляем отсутствующие поля, не удаляя данные.
  await pool.query(`
    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS telegram_id TEXT,
      ADD COLUMN IF NOT EXISTS username TEXT DEFAULT 'Игрок',
      ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Игрок',
      ADD COLUMN IF NOT EXISTS balance BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_earned BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS click_power INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS auto_level INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS multiplier_level INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_daily DATE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS players_telegram_id_unique
    ON players (telegram_id)
    WHERE telegram_id IS NOT NULL
  `);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AKIRA server started on port ${PORT}`);
  });
}

start().catch(error => {
  console.error("Failed to start AKIRA:", error);
  process.exit(1);
});
