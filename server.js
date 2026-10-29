"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";

app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});

const UPGRADES = {
  click: { base: 50, factor: 1.65, max: 100, column: "click_power" },
  auto: { base: 250, factor: 1.8, max: 50, column: "auto_level" },
  multiplier: { base: 1000, factor: 2.1, max: 25, column: "multiplier_level" }
};

function upgradePrice(type, player) {
  const cfg = UPGRADES[type];
  return cfg ? Math.floor(cfg.base * Math.pow(cfg.factor, Number(player[cfg.column] || 0))) : 0;
}

function publicPlayer(player) {
  return {
    id: player.id,
    telegram_id: player.telegram_id,
    username: player.username || "Игрок",
    name: player.name || player.username || "Игрок",
    avatar_url: player.avatar_url || null,
    balance: Number(player.balance || 0),
    total_earned: Number(player.total_earned || 0),
    click_power: Number(player.click_power || 1),
    auto_level: Number(player.auto_level || 0),
    auto_power: Number(player.auto_level || 0),
    multiplier_level: Number(player.multiplier_level || 0),
    level: Math.max(1, Math.floor(Math.sqrt(Number(player.total_earned || 0) / 1000)) + 1),
    click_price: upgradePrice("click", player),
    auto_price: upgradePrice("auto", player),
    multiplier_price: upgradePrice("multiplier", player)
  };
}

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return { valid: false, user: null };

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

    const expected = Buffer.from(calculatedHash, "hex");
    const received = Buffer.from(receivedHash, "hex");

    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return { valid: false, user: null };
    }

    const authDate = Number(params.get("auth_date") || 0);
    const age = Date.now() / 1000 - authDate;

    if (!authDate || age < -60 || age > 86400) {
      return { valid: false, user: null };
    }

    const user = JSON.parse(params.get("user") || "null");
    if (!user || !user.id) return { valid: false, user: null };

    return { valid: true, user };
  } catch {
    return { valid: false, user: null };
  }
}

async function getPlayer(req, res, next) {
  try {
    const auth = verifyTelegramInitData(req.get("X-Telegram-Init-Data") || "");

    if (!auth.valid) {
      return res.status(401).json({
        error: "Не удалось подтвердить Telegram-пользователя. Открой Mini App через Telegram."
      });
    }

    const telegramId = String(auth.user.id);
    const username = auth.user.username || auth.user.first_name || "Игрок";
    const firstName = auth.user.first_name || username;

    await pool.query(
      `INSERT INTO players (telegram_id, username, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE
       SET username = EXCLUDED.username`,
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

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "AKIRA" });
});

app.use("/api", getPlayer);

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(500).json({ ok: false, database: "error" });
  }
});

app.get("/api/state", (req, res) => {
  res.json({ ok: true, player: publicPlayer(req.player) });
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
    const reward = Number(player.click_power || 1) *
      Math.pow(2, Number(player.multiplier_level || 0));

    const updated = await client.query(
      `UPDATE players
       SET balance = balance + $1, total_earned = total_earned + $1
       WHERE telegram_id = $2 RETURNING *`,
      [reward, player.telegram_id]
    );

    await client.query("COMMIT");
    res.json({ ok: true, reward, player: publicPlayer(updated.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

async function purchaseUpgrade(req, res, next) {
  const type = req.body?.upgrade || req.body?.type;
  if (!UPGRADES[type]) return res.status(400).json({ error: "Неизвестное улучшение" });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [req.player.telegram_id]
    );

    const player = result.rows[0];
    const cfg = UPGRADES[type];
    const level = Number(player[cfg.column] || 0);

    if (level >= cfg.max) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Улучшение достигло максимального уровня" });
    }

    const cost = upgradePrice(type, player);
    if (Number(player.balance || 0) < cost) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Недостаточно монет", price: cost });
    }

    const updated = await client.query(
      `UPDATE players SET balance = balance - $1, ${cfg.column} = ${cfg.column} + 1
       WHERE telegram_id = $2 RETURNING *`,
      [cost, player.telegram_id]
    );

    await client.query("COMMIT");
    res.json({ ok: true, message: "Улучшение куплено!", cost, player: publicPlayer(updated.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
}

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
      return res.status(400).json({ error: "Ежедневная награда уже получена сегодня" });
    }

    const updated = await client.query(
      `UPDATE players
       SET balance = balance + 500,
           total_earned = total_earned + 500,
           last_daily = CURRENT_DATE
       WHERE telegram_id = $1 RETURNING *`,
      [player.telegram_id]
    );

    await client.query("COMMIT");
    res.json({ ok: true, reward: 500, message: "Получено 500 монет!", player: publicPlayer(updated.rows[0]) });
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
      `SELECT name, username, avatar_url, balance, total_earned
       FROM players ORDER BY total_earned DESC, balance DESC LIMIT 50`
    );

    res.json({
      ok: true,
      players: result.rows.map((player, index) => ({
        rank: index + 1,
        name: player.name || player.username || "Игрок",
        username: player.username || "Игрок",
        avatar_url: player.avatar_url || null,
        balance: Number(player.balance || 0),
        total_earned: Number(player.total_earned || 0),
        score: Number(player.total_earned || 0)
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/profile", async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const avatarUrl = req.body?.avatar_url == null ? null : String(req.body.avatar_url);

    if (!name || name.length > 24) {
      return res.status(400).json({ error: "Имя должно содержать от 1 до 24 символов" });
    }

    if (avatarUrl && avatarUrl.length > 1500000) {
      return res.status(413).json({ error: "Изображение слишком большое" });
    }

    if (avatarUrl && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(avatarUrl)) {
      return res.status(400).json({ error: "Поддерживаются PNG, JPG, WEBP и GIF" });
    }

    const result = await pool.query(
      `UPDATE players SET name = $1, avatar_url = $2
       WHERE telegram_id = $3 RETURNING *`,
      [name, avatarUrl, req.player.telegram_id]
    );

    res.json({ ok: true, player: publicPlayer(result.rows[0]) });
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

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "Маршрут не найден", path: req.path });
});

app.use((error, req, res, next) => {
  console.error("[AKIRA SERVER]", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT DEFAULT 'Игрок',
      name TEXT DEFAULT 'Игрок',
      avatar_url TEXT,
      balance BIGINT NOT NULL DEFAULT 0,
      total_earned BIGINT NOT NULL DEFAULT 0,
      click_power INTEGER NOT NULL DEFAULT 1,
      auto_level INTEGER NOT NULL DEFAULT 0,
      multiplier_level INTEGER NOT NULL DEFAULT 0,
      last_daily DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE players
      ADD COLUMN IF NOT EXISTS telegram_id TEXT,
      ADD COLUMN IF NOT EXISTS username TEXT DEFAULT 'Игрок',
      ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Игрок',
      ADD COLUMN IF NOT EXISTS avatar_url TEXT,
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
    ON players (telegram_id) WHERE telegram_id IS NOT NULL
  `);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AKIRA server started on port ${PORT}`);
  });
}

start().catch(error => {
  console.error("Failed to start AKIRA:", error);
  process.exit(1);
});
