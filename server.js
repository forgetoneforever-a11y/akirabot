require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static("public"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
});
const token = process.env.BOT_TOKEN;
const webappUrl = process.env.WEBAPP_URL;
let bot = null;

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
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS earnings_user_date_idx ON earnings(telegram_id, created_at);
    CREATE TABLE IF NOT EXISTS purchases (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES players(telegram_id) ON DELETE CASCADE,
      upgrade TEXT NOT NULL,
      cost BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function validateInitData(initData) {
  if (!token || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (calculated.length !== hash.length ||
      !crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now()/1000 - authDate > 86400) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !user.id) return null;
    return user;
  } catch { return null; }
}

async function ensurePlayer(user) {
  const result = await pool.query(
    `INSERT INTO players (telegram_id, username, first_name)
     VALUES ($1,$2,$3)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username=EXCLUDED.username, first_name=EXCLUDED.first_name, updated_at=NOW()
     RETURNING *`,
    [String(user.id), user.username || null, user.first_name || "Игрок"]
  );
  return result.rows[0];
}
async function auth(req, res, next) {
  const user = validateInitData(req.get("x-telegram-init-data"));
  if (!user) return res.status(401).json({ error: "Открой AKIRA через Telegram-бота." });
  try { req.player = await ensurePlayer(user); next(); }
  catch (e) { console.error(e); res.status(500).json({ error: "Ошибка базы данных." }); }
}
const safePlayer = p => ({
  coins: Number(p.coins), totalEarned: Number(p.total_earned),
  clickPower: p.click_power, autoLevel: p.auto_level,
  multiplierLevel: p.multiplier_level, streak: p.streak,
  name: p.first_name || p.username || "Игрок"
});
const multiplier = p => 1 + Number(p.multiplier_level);

app.get("/health", (_req,res) => res.json({ ok:true, app:"AKIRA" }));
app.get("/api/state", auth, async (req,res) => {
  const p = (await pool.query("SELECT * FROM players WHERE telegram_id=$1", [String(req.player.telegram_id)])).rows[0];
  res.json(safePlayer(p));
});
app.post("/api/click", auth, async (req,res) => {
  const id = String(req.player.telegram_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("SELECT * FROM players WHERE telegram_id=$1 FOR UPDATE", [id]);
    const p = r.rows[0];
    const amount = Math.max(1, Number(p.click_power) * multiplier(p));
    const upd = await client.query(
      "UPDATE players SET coins=coins+$2, total_earned=total_earned+$2, updated_at=NOW() WHERE telegram_id=$1 RETURNING *",
      [id, amount]);
    await client.query("INSERT INTO earnings (telegram_id,amount) VALUES ($1,$2)", [id, amount]);
    await client.query("COMMIT");
    res.json({ ...safePlayer(upd.rows[0]), gained:amount });
  } catch(e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({error:"Не удалось начислить монеты."}); }
  finally { client.release(); }
});
const upgrades = {
  click: { label:"Сильный палец", base:50, factor:1.65, max:100 },
  auto: { label:"Автокликер", base:250, factor:1.8, max:50 },
  multiplier: { label:"Множитель", base:1000, factor:2.1, max:25 }
};
app.post("/api/buy", auth, async (req,res) => {
  const key = req.body && req.body.upgrade;
  const cfg = upgrades[key];
  if (!cfg) return res.status(400).json({error:"Такого улучшения нет."});
  const id = String(req.player.telegram_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p = (await client.query("SELECT * FROM players WHERE telegram_id=$1 FOR UPDATE",[id])).rows[0];
    const level = key==="click" ? p.click_power-1 : key==="auto" ? p.auto_level : p.multiplier_level;
    if (level >= cfg.max) { await client.query("ROLLBACK"); return res.status(400).json({error:"Максимальный уровень уже достигнут."}); }
    const cost = Math.floor(cfg.base * Math.pow(cfg.factor, level));
    if (Number(p.coins) < cost) { await client.query("ROLLBACK"); return res.status(400).json({error:"Не хватает монет."}); }
    const field = key==="click" ? "click_power=click_power+1" : key==="auto" ? "auto_level=auto_level+1" : "multiplier_level=multiplier_level+1";
    await client.query(`UPDATE players SET coins=coins-$2, ${field}, updated_at=NOW() WHERE telegram_id=$1`,[id,cost]);
    await client.query("INSERT INTO purchases (telegram_id,upgrade,cost) VALUES ($1,$2,$3)",[id,key,cost]);
    const updated = (await client.query("SELECT * FROM players WHERE telegram_id=$1",[id])).rows[0];
    await client.query("COMMIT");
    res.json({ ...safePlayer(updated), bought:key, cost });
  } catch(e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({error:"Покупка не удалась."}); }
  finally { client.release(); }
});
app.post("/api/daily", auth, async (req,res) => {
  const id = String(req.player.telegram_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p=(await client.query("SELECT * FROM players WHERE telegram_id=$1 FOR UPDATE",[id])).rows[0];
    const today = new Date().toISOString().slice(0,10);
    if (p.last_daily && new Date(p.last_daily).toISOString().slice(0,10)===today) {
      await client.query("ROLLBACK"); return res.status(400).json({error:"Награда уже получена сегодня."});
    }
    const streak = p.last_daily && (Date.now()-new Date(p.last_daily).getTime()) < 48*3600*1000 ? p.streak+1 : 1;
    const reward = 100 + Math.min(streak,7)*50;
    const updated=(await client.query(
      "UPDATE players SET coins=coins+$2,total_earned=total_earned+$2,last_daily=$3,streak=$4,updated_at=NOW() WHERE telegram_id=$1 RETURNING *",
      [id,reward,today,streak])).rows[0];
    await client.query("INSERT INTO earnings (telegram_id,amount) VALUES ($1,$2)",[id,reward]);
    await client.query("COMMIT");
    res.json({...safePlayer(updated),gained:reward});
  } catch(e) { await client.query("ROLLBACK"); console.error(e); res.status(500).json({error:"Не удалось забрать награду."}); }
  finally { client.release(); }
});
app.get("/api/leaderboard", auth, async (req,res) => {
  const period = ["week","month","year"].includes(req.query.period) ? req.query.period : "week";
  const interval = period==="week" ? "7 days" : period==="month" ? "1 month" : "1 year";
  const result = await pool.query(`
    SELECT p.telegram_id, COALESCE(p.username,p.first_name,'Игрок') AS name,
           SUM(e.amount)::bigint AS score
    FROM earnings e JOIN players p ON p.telegram_id=e.telegram_id
    WHERE e.created_at >= NOW() - $1::interval
    GROUP BY p.telegram_id,p.username,p.first_name
    ORDER BY score DESC LIMIT 50`,[interval]);
  res.json(result.rows.map((r,i)=>({rank:i+1,name:r.name,score:Number(r.score)})));
});
app.get("/api/upgrades", auth, (_req,res) => res.json(Object.entries(upgrades).map(([key,u])=>({key,...u}))));

async function startBot() {
  if (!token) { console.warn("BOT_TOKEN не задан — запускается только веб-сервер."); return; }
  if (!webappUrl || !/^https:\/\/.+/.test(webappUrl)) {
    console.warn("WEBAPP_URL не задан HTTPS-адресом — бот не запускается.");
    return;
  }
  bot = new TelegramBot(token, { polling: true });
  bot.onText(/\/start/, async msg => {
    const opts = {
      reply_markup: { inline_keyboard: [[{text:"🍪 Играть в AKIRA", web_app:{url:webappUrl}}]] }
    };
    bot.sendMessage(msg.chat.id,
      `🔥 Добро пожаловать в AKIRA, ${msg.from.first_name || "игрок"}!\n\nКликай печеньку, прокачивай автокликер и залетай в топ лидеров.`,opts);
  });
  bot.onText(/\/help/, msg => bot.sendMessage(msg.chat.id,"Команды:\n/start — открыть игру\n/help — помощь"));
  bot.on("polling_error", e => console.error("Telegram polling:",e.message));
}
const port = process.env.PORT || 10000;
initDb().then(() => app.listen(port,"0.0.0.0",()=>console.log(`AKIRA listening on ${port}`)))
  .then(startBot).catch(e=>{console.error("Startup error:",e);process.exit(1);});
