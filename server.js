"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";

app.set("trust proxy", 1);

const WEB_APP_URL = process.env.WEB_APP_URL || process.env.RENDER_EXTERNAL_URL || "https://akirabot-krl0.onrender.com/";
const SUPPORT_URL = process.env.SUPPORT_URL || "tg://user?id=8617178928";
const BOT_API = BOT_TOKEN ? "https://api.telegram.org/bot" + BOT_TOKEN : "";
let telegramOffset = 0;
let pollingStarted = false;
async function telegramCall(method, payload) {
  if (!BOT_API) throw new Error("BOT_TOKEN is not configured");
  const response = await fetch(BOT_API + "/" + method, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || ("Telegram API " + method + " failed"));
  return data.result;
}
async function handleBotUpdate(update) {
  const message = update.message;
  if (!message || !message.text) return;
  const command = message.text.trim().split(/\\s+/)[0].split("@")[0];
  if (command === "/start") {
    const name = message.from && message.from.first_name ? message.from.first_name : "Император";
    await telegramCall("sendMessage", {
      chat_id: message.chat.id,
      text: "🍪 Привет, " + name + "! Добро пожаловать в AKIRA — Cookie Empire.\\n\\nЗарабатывай печеньки, улучшай свою империю, соревнуйся в рейтинге и играй в мини-игры.\\n\\nГотов начать?",
      reply_markup: { inline_keyboard: [[
        { text: "🎮 Играть", web_app: { url: WEB_APP_URL } },
        { text: "🛟 Поддержка", url: SUPPORT_URL }
      ]] }
    });
  }
}
async function telegramPollingLoop() {
  if (!BOT_API || pollingStarted) return;
  pollingStarted = true;
  console.log("[AKIRA BOT] Telegram polling started");
  while (true) {
    try {
      const updates = await telegramCall("getUpdates", { offset: telegramOffset, timeout: 25, allowed_updates: ["message"] });
      for (const update of updates) {
        telegramOffset = update.update_id + 1;
        try { await handleBotUpdate(update); } catch (error) { console.error("[AKIRA BOT] Update error:", error.message); }
      }
    } catch (error) {
      console.error("[AKIRA BOT] Polling error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
  }
}

app.use(express.json({ limit: "2mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});

const SKINS = [
 {id:"classic",name:"Классика",emoji:"🍪",rarity:"common",label:"Обычный",color:"#d8b08a"},
 {id:"choco",name:"Шоколадная",emoji:"🍫",rarity:"common",label:"Обычный",color:"#b77a54"},
 {id:"mint",name:"Мятная",emoji:"🍃",rarity:"rare",label:"Редкий",color:"#69e0c1"},
 {id:"galaxy",name:"Галактика",emoji:"🌌",rarity:"epic",label:"Эпический",color:"#b49aff"},
 {id:"golden",name:"Золотая",emoji:"🌟",rarity:"epic",label:"Эпический",color:"#ffd36b"},
 {id:"dragon",name:"Драконья",emoji:"🐉",rarity:"legendary",label:"Легендарный",color:"#ff79c8"}
];
const CASES = {
 basic:{id:"basic",name:"Печеньковый кейс",emoji:"📦",price:2500,description:"Первый шаг к коллекции"},
 royal:{id:"royal",name:"Королевский кейс",emoji:"👑",price:12000,description:"Больше шансов на редкие скины"}
};
function rollSkin(caseId) {
 const roll=Math.random()*100;
 let rarity;
 if(caseId==="royal") rarity=roll<40?"rare":roll<78?"epic":roll<90?"legendary":"common";
 else rarity=roll<62?"common":roll<88?"rare":roll<98?"epic":"legendary";
 const pool=SKINS.filter(s=>s.rarity===rarity);
 return pool[Math.floor(Math.random()*pool.length)];
}

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
    prestige_level: Number(player.prestige_level || 0),
    prestige_crystals: Number(player.prestige_crystals || 0),
    prestige_multiplier: 1 + Number(player.prestige_level || 0) * 0.1,
    multiplier_level: Number(player.multiplier_level || 0),
    rank_title: rankForEarned(Number(player.total_earned || 0)).title,
    rank_id: rankForEarned(Number(player.total_earned || 0)).rank,
    rank_frame: rankForEarned(Number(player.total_earned || 0)).frame,
    rank_multiplier: rankForEarned(Number(player.total_earned || 0)).multiplier,
    level: Math.max(1, Math.floor(Math.sqrt(Number(player.total_earned || 0) / 1000)) + 1),
    click_price: upgradePrice("click", player),
    auto_price: upgradePrice("auto", player),
    multiplier_price: upgradePrice("multiplier", player),
    last_daily_at: player.last_daily_at || null,
    next_daily_at: player.last_daily_at ? new Date(new Date(player.last_daily_at).getTime() + 24 * 60 * 60 * 1000).toISOString() : null
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

app.get("/api/collection", async (req,res,next)=>{
 try {
  const result=await pool.query("SELECT skin_id, equipped, obtained_at FROM player_skins WHERE telegram_id=$1 ORDER BY obtained_at",[req.player.telegram_id]);
  const owned=result.rows.map(row=>({...row,skin:SKINS.find(s=>s.id===row.skin_id)})).filter(row=>row.skin);
  res.json({ok:true,skins:SKINS,owned,cases:Object.values(CASES),equipped:owned.find(s=>s.equipped)?.skin_id||"classic"});
 } catch(error){console.error("Ошибка загрузки коллекции:",error);next(error);}
});
app.post("/api/cases/open", async (req,res,next)=>{
 const caseId=String(req.body?.case_id||"basic");
 const cfg=CASES[caseId];
 if(!cfg)return res.status(400).json({error:"Неизвестный кейс"});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const found=await client.query("SELECT * FROM players WHERE telegram_id=$1 FOR UPDATE",[req.player.telegram_id]);
  const player=found.rows[0];
  if(Number(player.balance||0)<cfg.price){await client.query("ROLLBACK");return res.status(400).json({error:"Не хватает печенек для открытия кейса"});}
  const skin=rollSkin(caseId);
  const already=await client.query("SELECT 1 FROM player_skins WHERE telegram_id=$1 AND skin_id=$2",[req.player.telegram_id,skin.id]);
  await client.query("UPDATE players SET balance=balance-$1 WHERE telegram_id=$2",[cfg.price,req.player.telegram_id]);
  await client.query("INSERT INTO player_case_history (telegram_id,case_id,skin_id,rarity) VALUES ($1,$2,$3,$4)",[req.player.telegram_id,caseId,skin.id,skin.rarity]);
  await client.query("INSERT INTO player_skins (telegram_id,skin_id,equipped) VALUES ($1,$2,FALSE) ON CONFLICT (telegram_id,skin_id) DO NOTHING",[req.player.telegram_id,skin.id]);
  const updated=await client.query("SELECT * FROM players WHERE telegram_id=$1",[req.player.telegram_id]);
  await client.query("COMMIT");
  res.json({ok:true,skin,duplicate:Boolean(already.rowCount),message:already.rowCount?"Повторный скин! Он добавлен в историю кейсов.":"Новый скин добавлен в коллекцию!",player:publicPlayer(updated.rows[0])});
 }catch(error){await client.query("ROLLBACK");console.error("Ошибка открытия кейса:",error);next(error);}finally{client.release();}
});
app.post("/api/skins/equip", async (req,res,next)=>{
 const skinId=String(req.body?.skin_id||"");
 if(!SKINS.some(s=>s.id===skinId))return res.status(400).json({error:"Неизвестный скин"});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const owned=await client.query("SELECT 1 FROM player_skins WHERE telegram_id=$1 AND skin_id=$2",[req.player.telegram_id,skinId]);
  if(!owned.rowCount){await client.query("ROLLBACK");return res.status(403).json({error:"Сначала найди этот скин в кейсе"});}
  await client.query("UPDATE player_skins SET equipped=(skin_id=$2) WHERE telegram_id=$1",[req.player.telegram_id,skinId]);
  await client.query("COMMIT");
  res.json({ok:true,equipped:skinId});
 }catch(error){await client.query("ROLLBACK");next(error);}finally{client.release();}
});

app.get("/api/state", async (req, res, next) => {
  try {
    // Accrue automatic-cookie income on the server, never trust client-side totals.
    const result = await pool.query(
      `UPDATE players
       SET balance = balance + FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_auto_at, NOW()))))::BIGINT * auto_level * (1 + COALESCE(prestige_level, 0) * 0.1),
           total_earned = total_earned + FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_auto_at, NOW()))))::BIGINT * auto_level * (1 + COALESCE(prestige_level, 0) * 0.1),
           last_auto_at = NOW()
       WHERE telegram_id = $1
       RETURNING *`,
      [req.player.telegram_id]
    );
    res.json({ ok: true, player: publicPlayer(result.rows[0] || req.player) });
  } catch (error) {
    next(error);
  }
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
    const rankBoost = rankForEarned(Number(player.total_earned || 0)).multiplier;
    const reward = Math.floor(Number(player.click_power || 1) * Math.pow(2, Number(player.multiplier_level || 0)) * rankBoost * (1 + Number(player.prestige_level || 0) * 0.1));

    const updated = await client.query(
      `UPDATE players
       SET balance = balance + $1, total_earned = total_earned + $1
       WHERE telegram_id = $2 RETURNING *`,
      [reward, player.telegram_id]
    );

    const rankResult = await grantRankRewards(client, updated.rows[0]);
    await client.query("COMMIT");
    res.json({ ok: true, reward, rank_bonus: rankResult.bonus, player: publicPlayer(rankResult.player) });
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

app.post("/api/prestige", async (req,res,next)=>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const found=await client.query("SELECT * FROM players WHERE telegram_id=$1 FOR UPDATE",[req.player.telegram_id]);
  const player=found.rows[0];
  const level=Number(player.prestige_level||0);
  const required=Math.floor(1000000*Math.pow(2,level));
  const balance=Number(player.balance||0);
  if(balance<required){await client.query("ROLLBACK");return res.status(400).json({error:"Нужно накопить "+required.toLocaleString("ru-RU")+" печенек для перерождения",required,balance});}
  const crystals=Math.max(1,level+1);
  const updated=await client.query("UPDATE players SET balance=0, click_power=1, auto_level=0, multiplier_level=0, prestige_level=prestige_level+1, prestige_crystals=prestige_crystals+$1, last_auto_at=NOW() WHERE telegram_id=$2 RETURNING *",[crystals,player.telegram_id]);
  await client.query("INSERT INTO player_prestige_history (telegram_id, prestige_level, crystals_awarded, balance_before) VALUES ($1,$2,$3,$4)",[player.telegram_id,level+1,crystals,balance]);
  await client.query("COMMIT");
  res.json({ok:true,crystals_awarded:crystals,required,player:publicPlayer(updated.rows[0]),message:"Перерождение завершено! Постоянный бонус к заработку увеличен."});
 }catch(error){await client.query("ROLLBACK");next(error);}finally{client.release();}
});

app.post("/api/daily", async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE",
      [req.player.telegram_id]
    );

    const player = result.rows[0];
    const lastClaim = player.last_daily_at ? new Date(player.last_daily_at).getTime() : 0;
    const cooldownMs = 24 * 60 * 60 * 1000;
    const remainingMs = lastClaim ? lastClaim + cooldownMs - Date.now() : 0;

    if (remainingMs > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Награда будет доступна через " + Math.ceil(remainingMs / 1000) + " сек.",
        remaining_seconds: Math.ceil(remainingMs / 1000),
        next_daily_at: new Date(lastClaim + cooldownMs).toISOString()
      });
    }

    const updated = await client.query(
      `UPDATE players
       SET balance = balance + 500,
           total_earned = total_earned + 500,
           last_daily = CURRENT_DATE,
           last_daily_at = NOW()
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

const RANK_REWARDS = [
 {rank:"experienced",title:"Опытный",threshold:5000,reward:1000,multiplier:1.05,frame:"frame-experienced"},
 {rank:"veteran",title:"Ветеран",threshold:25000,reward:5000,multiplier:1.10,frame:"frame-veteran"},
 {rank:"master",title:"Мастер",threshold:100000,reward:20000,multiplier:1.15,frame:"frame-master"},
 {rank:"emperor",title:"Император",threshold:250000,reward:50000,multiplier:1.25,frame:"frame-emperor"},
 {rank:"legend",title:"Легенда",threshold:1000000,reward:250000,multiplier:1.50,frame:"frame-legend"}
];
function rankForEarned(total) {
 return [...RANK_REWARDS].reverse().find(r=>total>=r.threshold)||{rank:"rookie",title:"Новичок",threshold:0,reward:0,multiplier:1,frame:"frame-rookie"};
}
async function grantRankRewards(client, player) {
 let bonus=0;
 for(const rank of RANK_REWARDS.filter(r=>Number(player.total_earned||0)>=r.threshold)){
  const claimed=await client.query("INSERT INTO player_rank_rewards (telegram_id,rank_id,reward) VALUES ($1,$2,$3) ON CONFLICT (telegram_id,rank_id) DO NOTHING RETURNING reward",[player.telegram_id,rank.rank,rank.reward]);
  if(claimed.rowCount) bonus+=rank.reward;
 }
 if(!bonus)return {player,bonus};
 const updated=await client.query("UPDATE players SET balance=balance+$1 WHERE telegram_id=$2 RETURNING *",[bonus,player.telegram_id]);
 return {player:updated.rows[0],bonus};
}
function rankTitle(totalEarned) {
  if (totalEarned >= 1000000) return "Легенда";
  if (totalEarned >= 250000) return "Император";
  if (totalEarned >= 100000) return "Мастер";
  if (totalEarned >= 25000) return "Ветеран";
  if (totalEarned >= 5000) return "Опытный";
  return "Новичок";
}

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
        level: Math.max(1, Math.floor(Math.sqrt(Number(player.total_earned || 0) / 1000)) + 1),
        rank_title: rankTitle(Number(player.total_earned || 0)),
        score: Number(player.total_earned || 0)
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/profile", async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? req.player.name ?? "").trim();
    const body = req.body || {};
    const hasAvatarField =
      Object.prototype.hasOwnProperty.call(body, "avatar_url") ||
      Object.prototype.hasOwnProperty.call(body, "avatar") ||
      body.resetAvatar === true;

    let avatarUrl;
    if (body.resetAvatar === true) {
      avatarUrl = null;
    } else if (Object.prototype.hasOwnProperty.call(body, "avatar_url")) {
      avatarUrl = body.avatar_url == null ? null : String(body.avatar_url);
    } else if (Object.prototype.hasOwnProperty.call(body, "avatar")) {
      avatarUrl = body.avatar == null ? null : String(body.avatar);
    }

    if (!name || name.length > 24) {
      return res.status(400).json({ error: "Имя должно содержать от 1 до 24 символов" });
    }

    if (avatarUrl && avatarUrl.length > 1500000) {
      return res.status(413).json({ error: "Изображение слишком большое" });
    }

    if (
      avatarUrl &&
      !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(avatarUrl)
    ) {
      return res.status(400).json({ error: "Поддерживаются PNG, JPG, WEBP и GIF" });
    }

    const result = await pool.query(
      `UPDATE players
       SET name = $1,
           avatar_url = CASE WHEN $2 THEN $3 ELSE avatar_url END
       WHERE telegram_id = $4
       RETURNING *`,
      [name, hasAvatarField, avatarUrl ?? null, req.player.telegram_id]
    );

    res.json({ ok: true, player: publicPlayer(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

const DAILY_TASKS = [
  { id: "earn-1000", title: "Первые заработки", description: "Заработай всего 1 000 печенек", reward: 250, goal: 1000, metric: "total_earned" },
  { id: "earn-10000", title: "Печеньковый магнат", description: "Заработай всего 10 000 печенек", reward: 1000, goal: 10000, metric: "total_earned" },
  { id: "upgrade-auto", title: "Автоматизация", description: "Купи хотя бы 1 уровень автокликера", reward: 300, goal: 1, metric: "auto_level" },
  { id: "upgrade-click", title: "Сильный палец", description: "Прокачай силу клика до 5", reward: 500, goal: 5, metric: "click_power" }
];

app.get("/api/tasks", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM players WHERE telegram_id = $1",
      [req.player.telegram_id]
    );
    const player = result.rows[0] || req.player;
    const claimed = await pool.query(
      "SELECT task_id FROM player_task_claims WHERE telegram_id = $1 AND claim_date = CURRENT_DATE",
      [req.player.telegram_id]
    );
    const claimedIds = new Set(claimed.rows.map(row => row.task_id));
    const tasks = DAILY_TASKS.map(task => ({
      ...task,
      progress: Math.min(Number(player[task.metric] || 0), task.goal),
      completed: Number(player[task.metric] || 0) >= task.goal,
      claimed: claimedIds.has(task.id)
    }));
    const achievements = [
      { id: "first-cookie", title: "Первая печенька", description: "Заработай 1 000 печенек", goal: 1000, progress: Number(player.total_earned || 0), unlocked: Number(player.total_earned || 0) >= 1000 },
      { id: "cookie-king", title: "Король печенек", description: "Заработай 100 000 печенек", goal: 100000, progress: Number(player.total_earned || 0), unlocked: Number(player.total_earned || 0) >= 100000 },
      { id: "auto-master", title: "Повелитель автоматики", description: "Достигни 5 уровня автокликера", goal: 5, progress: Number(player.auto_level || 0), unlocked: Number(player.auto_level || 0) >= 5 },
      { id: "click-master", title: "Мощный клик", description: "Достигни силы клика 10", goal: 10, progress: Number(player.click_power || 1), unlocked: Number(player.click_power || 1) >= 10 }
    ];
    res.json({ ok: true, tasks, achievements });
  } catch (error) { next(error); }
});

app.post("/api/tasks/claim", async (req, res, next) => {
  const taskId = String(req.body?.task_id || "");
  const task = DAILY_TASKS.find(item => item.id === taskId);
  if (!task) return res.status(400).json({ error: "Неизвестное задание" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE", [req.player.telegram_id]);
    const player = result.rows[0];
    if (!player || Number(player[task.metric] || 0) < task.goal) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Задание ещё не выполнено" });
    }
    const already = await client.query(
      "SELECT 1 FROM player_task_claims WHERE telegram_id = $1 AND task_id = $2 AND claim_date = CURRENT_DATE",
      [req.player.telegram_id, task.id]
    );
    if (already.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Награда за это задание уже получена сегодня" });
    }
    await client.query(
      "INSERT INTO player_task_claims (telegram_id, task_id, claim_date) VALUES ($1, $2, CURRENT_DATE)",
      [req.player.telegram_id, task.id]
    );
    const updated = await client.query(
      "UPDATE players SET balance = balance + $1, total_earned = total_earned + $1 WHERE telegram_id = $2 RETURNING *",
      [task.reward, req.player.telegram_id]
    );
    await client.query("COMMIT");
    res.json({ ok: true, reward: task.reward, player: publicPlayer(updated.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(400).json({ error: "Награда уже получена сегодня" });
    next(error);
  } finally { client.release(); }
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
      prestige_level INTEGER NOT NULL DEFAULT 0,
      prestige_crystals BIGINT NOT NULL DEFAULT 0,
      last_daily DATE,
      last_auto_at TIMESTAMPTZ,
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
      ADD COLUMN IF NOT EXISTS prestige_level INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prestige_crystals BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_daily DATE,
      ADD COLUMN IF NOT EXISTS last_daily_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_auto_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    UPDATE players
    SET last_daily_at = CASE
      WHEN last_daily = CURRENT_DATE THEN NOW()
      ELSE last_daily::timestamptz
    END
    WHERE last_daily IS NOT NULL AND last_daily_at IS NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_prestige_history (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      prestige_level INTEGER NOT NULL,
      crystals_awarded BIGINT NOT NULL,
      balance_before BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_skins (
      telegram_id TEXT NOT NULL,
      skin_id TEXT NOT NULL,
      equipped BOOLEAN NOT NULL DEFAULT FALSE,
      obtained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (telegram_id, skin_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_case_history (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      skin_id TEXT NOT NULL,
      rarity TEXT NOT NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO player_skins (telegram_id, skin_id, equipped)
    SELECT telegram_id, 'classic', TRUE FROM players
    ON CONFLICT (telegram_id, skin_id) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_rank_rewards (
      id BIGSERIAL PRIMARY KEY, telegram_id TEXT NOT NULL, rank_id TEXT NOT NULL, reward BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (telegram_id, rank_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_task_claims (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (telegram_id, task_id, claim_date)
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS players_telegram_id_unique
    ON players (telegram_id) WHERE telegram_id IS NOT NULL
  `);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AKIRA server started on port ${PORT}`);
  });
  telegramPollingLoop();
}

start().catch(error => {
  console.error("Failed to start AKIRA:", error);
  process.exit(1);
});
