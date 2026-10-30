"use strict";

const API_BASE = "/api";

const THEMES = ["classic", "crimson", "midnight", "ocean", "emerald"];
const DEFAULT_THEME = "classic";
const TABS = ["home", "shop", "top", "profile", "themes", "games"];

const state = {
  player: {},
  prices: {},
  loading: false,
  currentTab: "home",
  selectedGame: null,
  gameMode: "bot",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function number(value) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function formatNumber(value) {
  return Math.floor(number(value)).toLocaleString("ru-RU");
}

function showToast(message) {
  const toast = $("#toast");

  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = String(message);
  toast.hidden = false;
  toast.classList.add("show", "active");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.classList.remove("show", "active");
    if (!toast.classList.contains("akira-toast")) {
      toast.hidden = true;
    }
  }, 2400);
}

async function api(path, options = {}) {
  const telegram = window.Telegram?.WebApp;
  const initData = telegram?.initData || "";

  const headers = {
    "Content-Type": "application/json",
    ...(initData ? { "X-Telegram-Init-Data": initData } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : (typeof options.body === "string" ? options.body : JSON.stringify(options.body)),
  });

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Сервер вернул неверный ответ (HTTP ${response.status})`);
    }
  }

  if (!response.ok) {
    throw new Error(
      data.error || data.message || `Ошибка сервера: HTTP ${response.status}`
    );
  }

  return data;
}

/* =========================
   ТЕМЫ
========================= */

function normalizeTheme(theme) {
  return THEMES.includes(theme) ? theme : DEFAULT_THEME;
}

function applyTheme(theme, notify = false) {
  const selectedTheme = normalizeTheme(theme);

  document.documentElement.dataset.theme = selectedTheme;
  document.body.dataset.theme = selectedTheme;

  try {
    localStorage.setItem("akira-theme", selectedTheme);
  } catch (error) {
    console.warn("Не удалось сохранить тему:", error);
  }

  $$(".theme-option").forEach((button) => {
    const selected = button.dataset.theme === selectedTheme;

    button.classList.toggle("active", selected);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  if (notify) showToast("Тема изменена");
}

function initThemes() {
  let savedTheme = DEFAULT_THEME;

  try {
    savedTheme = localStorage.getItem("akira-theme") || DEFAULT_THEME;
  } catch (error) {
    console.warn("Не удалось прочитать тему:", error);
  }

  applyTheme(savedTheme);

  $$(".theme-option").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.theme, true);
    });
  });
}

/* =========================
   ИГРОК И СОСТОЯНИЕ
========================= */

function getPlayer() {
  return state.player || {};
}

function getBalance() {
  return number(getPlayer().balance);
}

function getClickPower() {
  const player = getPlayer();
  const power = number(player.click_power ?? player.clickPower ?? 1);
  const multiplierLevel = number(
    player.multiplier_level ?? player.multiplierLevel
  );

  return Math.floor(power * Math.pow(2, multiplierLevel) * number(player.rank_multiplier ?? 1));
}

function getAutoPower() {
  const player = getPlayer();

  return number(
    player.auto_power ??
    player.autoPower ??
    player.auto_level ??
    player.autoLevel
  );
}

function getAvatarUrl(player = getPlayer()) {
  return player.avatar_url || player.avatarUrl || "/avatar-default.svg";
}

function updateDailyRewardButton() {
  const button = $("#daily-button");
  if (!button) return;
  const next = getPlayer().next_daily_at;
  const remaining = next ? new Date(next).getTime() - Date.now() : 0;
  if (remaining > 0) {
    const totalSeconds = Math.ceil(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    button.disabled = true;
    button.textContent = `🎁 Следующая награда через ${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
    button.setAttribute("aria-label", "Ежедневная награда будет доступна через 24 часа после получения");
  } else {
    button.disabled = false;
    button.textContent = "🎁 Забрать ежедневную награду";
    button.removeAttribute("aria-label");
  }
}

async function loadTasks() {
  const tasksContainer = $("#daily-tasks-list");
  const achievementsContainer = $("#achievements-list");
  if (!tasksContainer || !achievementsContainer) return;
  try {
    const data = await api("/tasks");
    tasksContainer.replaceChildren();
    (data.tasks || []).forEach(task => {
      const card = document.createElement("article");
      card.className = "task-card";
      const title = document.createElement("strong");
      title.textContent = task.title;
      const description = document.createElement("p");
      description.textContent = task.description;
      const progress = document.createElement("div");
      progress.className = "task-progress";
      progress.textContent = `${formatNumber(task.progress)} / ${formatNumber(task.goal)}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-secondary";
      button.textContent = task.claimed ? "Получено сегодня" : task.completed ? `Забрать +${formatNumber(task.reward)} 🍪` : `Награда: ${formatNumber(task.reward)} 🍪`;
      button.disabled = task.claimed || !task.completed;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const claimed = await api("/tasks/claim", { method: "POST", body: { task_id: task.id } });
          if (claimed.player) renderState({ player: claimed.player });
          showToast(`Получено ${formatNumber(claimed.reward)} печенек!`);
          await loadTasks();
        } catch (error) {
          showToast(error.message || "Не удалось получить награду");
          await loadTasks();
        }
      });
      card.append(title, description, progress, button);
      tasksContainer.append(card);
    });
    achievementsContainer.replaceChildren();
    (data.achievements || []).forEach(item => {
      const card = document.createElement("article");
      card.className = "achievement-card" + (item.unlocked ? " unlocked" : "");
      const title = document.createElement("strong");
      title.textContent = (item.unlocked ? "🏆 " : "🔒 ") + item.title;
      const description = document.createElement("p");
      description.textContent = item.description;
      const progress = document.createElement("div");
      progress.className = "task-progress";
      progress.textContent = `${formatNumber(Math.min(item.progress, item.goal))} / ${formatNumber(item.goal)}`;
      card.append(title, description, progress);
      achievementsContainer.append(card);
    });
  } catch (error) {
    tasksContainer.textContent = "Не удалось загрузить задания.";
    achievementsContainer.textContent = "Не удалось загрузить достижения.";
  }
}


async function loadCollection(){
 const casesEl=$("#case-list"), collectionEl=$("#skin-collection");
 if(!casesEl||!collectionEl)return;
 try{
  const data=await api("/collection");
  casesEl.replaceChildren();
  data.cases.forEach(item=>{
   const card=document.createElement("div");card.className="case-item";
   const art=document.createElement("div");art.className="case-art";art.textContent=item.emoji;
   const info=document.createElement("div");info.className="case-info";
   const title=document.createElement("strong");title.textContent=item.name;
   const desc=document.createElement("span");desc.textContent=item.description;
   const price=document.createElement("span");price.className="case-price";price.textContent=formatNumber(item.price)+" 🍪";
   info.append(title,desc,price);
   const button=document.createElement("button");button.className="buy-button";button.type="button";button.textContent="Открыть";
   button.addEventListener("click",()=>openCase(item.id,button));
   card.append(art,info,button);casesEl.append(card);
  });
  collectionEl.replaceChildren();
  const owned=new Set(data.owned.map(item=>item.skin_id));
  const equipped=data.equipped;
  const currentSkin=data.skins.find(s=>s.id===equipped);
  const cookieButton=$("#cookie-button");
  if(cookieButton&&currentSkin)cookieButton.textContent=currentSkin.emoji;
  const count=$("#collection-count");if(count)count.textContent=owned.size+" / "+data.skins.length;
  const shards=$("#shards-balance");if(shards)shards.textContent=formatNumber(data.shards||0);
  const setBonus=$("#skin-set-bonus");if(setBonus)setBonus.textContent="Бонус коллекции: ×"+Number(data.set_bonus||1).toFixed(2);
  data.skins.forEach(skin=>{
   const item=data.owned.find(row=>row.skin_id===skin.id);
   const card=document.createElement("div");card.className="skin-card rarity-"+skin.rarity+(item?" owned":" locked")+(skin.id===equipped?" equipped":"");
   const icon=document.createElement("div");icon.className="skin-icon";icon.textContent=item?skin.emoji:"❔";
   const name=document.createElement("strong");name.textContent=item?skin.name:"Не найден";
   const rarity=document.createElement("span");rarity.textContent=skin.label;
   const button=document.createElement("button");button.type="button";button.className="skin-equip";
   button.textContent=!item?"Закрыто":skin.id===equipped?"Надет":"Надеть";button.disabled=!item||skin.id===equipped;
   button.addEventListener("click",()=>equipSkin(skin.id));
   card.append(icon,name,rarity,button);collectionEl.append(card);
  });
 }catch(error){casesEl.textContent="Не удалось загрузить кейсы.";collectionEl.textContent=error.message||"Не удалось загрузить коллекцию.";}
}
async function openCase(caseId,button){
 const result=$("#case-result");if(button)button.disabled=true;
 try{
  const data=await api("/cases/open",{method:"POST",body:JSON.stringify({case_id:caseId})});
  renderState({player:data.player});
  if(result){result.className="case-result rarity-"+data.skin.rarity;result.textContent=(data.duplicate?"🔁 Дубликат! +"+(data.shards_awarded||0)+" 💠 ":"✨ Новый предмет! ")+data.skin.emoji+" "+data.skin.name+" — "+data.skin.label;}
  await loadCollection();
 }catch(error){if(result){result.className="case-result error";result.textContent=error.message||"Не удалось открыть кейс";}else showToast(error.message);}
 finally{if(button)button.disabled=false;}
}
async function equipSkin(skinId){
 try{await api("/skins/equip",{method:"POST",body:JSON.stringify({skin_id:skinId})});await loadCollection();showToast("Скин экипирован!");}
 catch(error){showToast(error.message||"Не удалось надеть скин");}
}

async function loadFriends() {
  const el = $("#friends-list");
  if (!el) return;
  el.textContent = "Загрузка друзей…";
  try {
    const data = await api("/friends");
    const friends = Array.isArray(data.friends) ? data.friends : [];
    el.replaceChildren();
    if (!friends.length) {
      const empty = document.createElement("div");
      empty.className = "friends-empty";
      empty.textContent = "Пока нет друзей. Найди игрока по Telegram username или пригласи его в AKIRA.";
      el.append(empty);
      return;
    }
    friends.forEach((friend) => {
      const row = document.createElement("div");
      row.className = "friend-row";
      const avatar = document.createElement("img");
      avatar.className = "friend-avatar";
      avatar.src = friend.avatar_url || "/avatar-default.svg";
      avatar.alt = "";
      avatar.loading = "lazy";
      avatar.onerror = () => { avatar.onerror = null; avatar.src = "/avatar-default.svg"; };
      const info = document.createElement("div");
      info.className = "friend-info";
      const name = document.createElement("strong");
      name.textContent = friend.name || friend.username || "Игрок";
      const detail = document.createElement("span");
      detail.textContent = (friend.username ? "@" + friend.username + " · " : "") + formatNumber(friend.balance) + " 🍪";
      info.append(name, detail);
      const gift = document.createElement("button");
      gift.className = "buy-button";
      gift.type = "button";
      gift.textContent = "🎁 Подарить";
      gift.addEventListener("click", async () => {
        const raw = prompt("Сколько печенек подарить? От 100 до 100 000.", "500");
        if (raw === null) return;
        const amount = Number(raw.trim());
        if (!Number.isSafeInteger(amount) || amount < 100 || amount > 100000) {
          showToast("Укажи целое число от 100 до 100 000");
          return;
        }
        if (amount > getBalance()) {
          showToast("У тебя недостаточно печенек");
          return;
        }
        gift.disabled = true;
        try {
          const requestId = (window.crypto?.randomUUID?.() || ("gift-" + Date.now() + "-" + Math.random().toString(36).slice(2))).slice(0,64);
          const result = await api("/friends/gift", { method: "POST", body: { telegram_id: friend.telegram_id, amount, request_id: requestId } });
          if (result.player) renderState({ player: result.player });
          showToast("Подарок отправлен: " + formatNumber(amount) + " 🍪");
          await loadFriends();
        } catch (error) {
          showToast(error.message || "Не удалось отправить подарок");
        } finally {
          gift.disabled = false;
        }
      });
      row.append(avatar, info, gift);
      el.append(row);
    });
  } catch (error) {
    el.textContent = error.message || "Не удалось загрузить друзей";
  }
}

async function searchFriend() {
  const input = $("#friend-username");
  const out = $("#friend-search-result");
  if (!input || !out) return;
  const username = input.value.trim().replace(/^@/, "");
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    out.textContent = "Введи Telegram username от 3 символов, без пробелов.";
    return;
  }
  const searchButton = $("#friend-search-button");
  if (searchButton) searchButton.disabled = true;
  out.textContent = "Ищем игрока…";
  try {
    const data = await api("/friends/search?username=" + encodeURIComponent(username));
    out.replaceChildren();
    if (!data.player) {
      out.textContent = "Игрок не найден. Он должен хотя бы раз открыть AKIRA.";
      return;
    }
    const player = data.player;
    const row = document.createElement("div");
    row.className = "friend-row friend-search-card";
    const avatar = document.createElement("img");
    avatar.className = "friend-avatar";
    avatar.src = player.avatar_url || "/avatar-default.svg";
    avatar.alt = "";
    avatar.onerror = () => { avatar.onerror = null; avatar.src = "/avatar-default.svg"; };
    const info = document.createElement("div");
    info.className = "friend-info";
    const name = document.createElement("strong");
    name.textContent = player.name || player.username || "Игрок";
    const detail = document.createElement("span");
    detail.textContent = player.username ? "@" + player.username : "Игрок AKIRA";
    info.append(name, detail);
    const add = document.createElement("button");
    add.className = "buy-button";
    add.type = "button";
    add.textContent = player.is_friend ? "✓ Уже друг" : "＋ Добавить";
    add.disabled = Boolean(player.is_friend);
    add.addEventListener("click", async () => {
      add.disabled = true;
      try {
        await api("/friends/add", { method: "POST", body: { telegram_id: player.telegram_id } });
        add.textContent = "✓ Добавлен";
        showToast("Игрок добавлен в друзья");
        await loadFriends();
      } catch (error) {
        add.disabled = false;
        showToast(error.message || "Не удалось добавить друга");
      }
    });
    row.append(avatar, info, add);
    out.append(row);
  } catch (error) {
    out.textContent = error.message || "Ошибка поиска";
  } finally {
    if (searchButton) searchButton.disabled = false;
  }
}

async function inviteFriend() {
  const telegram = window.Telegram?.WebApp;
  const url = window.location.href.split("#")[0];
  const text = "Заходи в AKIRA! Будем играть и соревноваться 🍪";
  const shareUrl = "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text);
  try {
    if (telegram?.openTelegramLink) telegram.openTelegramLink(shareUrl);
    else if (navigator.share) await navigator.share({ title: "AKIRA", text, url });
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      showToast("Ссылка на AKIRA скопирована");
    } else {
      window.prompt("Скопируй ссылку на AKIRA:", url);
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Не удалось открыть отправку ссылки");
  }
}
async function performPrestige(){
 const player=getPlayer();const required=Math.floor(1000000*Math.pow(2,Number(player.prestige_level||0)));
 if(Number(player.balance||0)<required){showToast("Пока недостаточно печенек");return;}
 if(!window.confirm("Переродиться? Баланс и уровни улучшений сбросятся, а ранг, общий заработок и скины сохранятся."))return;
 const button=$("#prestige-button");if(button)button.disabled=true;
 try{const data=await api("/prestige",{method:"POST",body:{}});renderState({player:data.player});showToast(data.message+" Получено 💠 "+data.crystals_awarded);loadCollection();}
 catch(error){showToast(error.message||"Не удалось переродиться");}
 finally{if(button)button.disabled=false;}
}

function renderState(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Сервер вернул пустое состояние игры");
  }

  state.player = data.player || data;
  state.prices = data.prices || state.player.prices || {};

  const player = getPlayer();

  setText("#balance", formatNumber(player.balance));
  setText("#total-earned", formatNumber(player.total_earned ?? player.totalEarned));
  setText("#level", player.level ?? 1);
  const levelNow = Math.max(1, Number(player.level || 1));
  const earned = Math.max(0, Number(player.total_earned || 0));
  const currentLevelFloor = Math.pow(levelNow - 1, 2) * 1000;
  const nextLevelFloor = Math.pow(levelNow, 2) * 1000;
  const levelProgress = Math.max(0, Math.min(100, (earned - currentLevelFloor) / Math.max(1, nextLevelFloor - currentLevelFloor) * 100));
  setText("#level-progress-label", `${formatNumber(earned)} / ${formatNumber(nextLevelFloor)} до уровня ${levelNow + 1}`);
  const levelProgressBar = $("#level-progress-fill");
  if (levelProgressBar) levelProgressBar.style.width = `${levelProgress}%`;
  setText("#click-power", formatNumber(getClickPower()));
  setText("#auto-power", formatNumber(getAutoPower()));

  setText("#profile-balance", formatNumber(player.balance));
  setText("#profile-earned", formatNumber(player.total_earned ?? player.totalEarned));
  setText("#profile-click", formatNumber(getClickPower()));
  setText("#profile-auto", `${formatNumber(getAutoPower())}/с`);

  setText(
    "#player-name",
    player.name || player.username || "Игрок AKIRA"
  );

  const nameInput = $("#profile-name-input");
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = player.name || player.username || "";
  }

  const avatar = $("#profile-avatar");
  if (avatar) {
    avatar.classList.remove("frame-rookie","frame-experienced","frame-veteran","frame-master","frame-emperor","frame-legend");
    avatar.classList.add(player.rank_frame || "frame-rookie");
    avatar.src = getAvatarUrl(player);
    avatar.onerror = () => {
      avatar.onerror = null;
      avatar.src = "/avatar-default.svg";
    };
  }

  updateUpgradePrices();
  updateDailyRewardButton();
  setText("#prestige-level", player.prestige_level ?? 0);
  setText("#prestige-crystals", formatNumber(player.prestige_crystals ?? 0));
  setText("#prestige-multiplier", "×" + Number(player.prestige_multiplier || 1).toFixed(2));
  const prestigeRequired = Math.floor(1000000 * Math.pow(2, Number(player.prestige_level || 0)));
  setText("#prestige-requirement", "Нужно накопить " + formatNumber(prestigeRequired) + " печенек на балансе. Награда: " + Math.max(1, Number(player.prestige_level || 0) + 1) + " 💠");
  const prestigeButton = $("#prestige-button");
  if (prestigeButton) { prestigeButton.disabled = Number(player.balance || 0) < prestigeRequired; prestigeButton.textContent = Number(player.balance || 0) < prestigeRequired ? "Нужно ещё " + formatNumber(prestigeRequired - Number(player.balance || 0)) + " 🍪" : "✨ Переродиться"; }
  if (state.currentTab === "shop") loadCollection();
  if (state.currentTab === "profile") loadTasks();

  document.dispatchEvent(
    new CustomEvent("akira:state-updated", { detail: { player } })
  );
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = String(value ?? "");
}

function normalizeUpgradeCards() {
  document.querySelectorAll("#tab-shop .upgrade-item").forEach((card) => {
    const info = card.querySelector(".upgrade-info");
    if (!info) return;
    const levels = info.querySelectorAll(".upgrade-level");
    levels.forEach((item, index) => {
      if (index > 0) item.remove();
    });
  });
}

function updateUpgradePrices() {
  normalizeUpgradeCards();
  const player = getPlayer();
  const aliases = {
    click: { price: "#finger-price", key: "click_price", level: "click_upgrade_level", fallback: Math.max(0, Number(player.click_power || 1) - 1) },
    auto: { price: "#auto-price", key: "auto_price", level: "auto_upgrade_level", fallback: Number(player.auto_level || 0) },
    multiplier: { price: "#multiplier-price", key: "multiplier_price", level: "multiplier_upgrade_level", fallback: Number(player.multiplier_level || 0) }
  };
  for (const [type, config] of Object.entries(aliases)) {
    const priceElement = $(config.price);
    const levelElement = $("#" + type + "-upgrade-level");
    const button = $('[data-upgrade="' + type + '"]');
    const level = Math.min(20, Math.max(0, Number(player[config.level] ?? config.fallback)));
    if (levelElement) levelElement.textContent = String(level);
    const price = state.prices[type]?.price ?? state.prices[type] ?? player[config.key];
    if (priceElement && price !== undefined && price !== null) priceElement.textContent = formatNumber(price);
    if (button) {
      const maxed = level >= 20;
      button.disabled = maxed || state.loading;
      button.textContent = maxed ? "Максимум" : "Купить";
      button.classList.toggle("upgrade-maxed", maxed);
    }
  }
}
let stateLoadPromise = null;
let stateSyncVersion = 0;
async function loadState() {
  if (stateLoadPromise) return stateLoadPromise;
  const requestVersion = stateSyncVersion;
  stateLoadPromise = (async () => {
    try {
      const data = await api("/state");
      // Ignore a background snapshot that started before a newer click response.
      if (requestVersion === stateSyncVersion) renderState(data);
    } catch (error) {
      console.error("Ошибка загрузки состояния:", error);
      showToast(error.message || "Не удалось загрузить игру");
    } finally {
      stateLoadPromise = null;
    }
  })();
  return stateLoadPromise;
}

/* =========================
   КЛИКЕР
========================= */

function animateCookie() {
  const button = $("#cookie-button");
  if (!button) return;

  button.classList.remove("clicked", "click-bounce");
  void button.offsetWidth;
  button.classList.add("clicked", "click-bounce");

  setTimeout(() => {
    button.classList.remove("clicked", "click-bounce");
  }, 180);
}

function createClickPopup(event, reward) {
  const popup = document.createElement("div");
  popup.className = "click-popup";
  popup.textContent = `+${formatNumber(reward)}`;

  const button = $("#cookie-button");
  const rect = button?.getBoundingClientRect();

  popup.style.left = `${event?.clientX || (rect ? rect.left + rect.width / 2 : window.innerWidth / 2)}px`;
  popup.style.top = `${event?.clientY || (rect ? rect.top + rect.height / 2 : window.innerHeight / 2)}px`;

  document.body.appendChild(popup);

  requestAnimationFrame(() => popup.classList.add("animate"));
  setTimeout(() => popup.remove(), 800);
}

function animateCookieClick(e){const b=$("#cookie-button");if(!b)return;b.classList.remove("akira-click-pop");void b.offsetWidth;b.classList.add("akira-click-pop");const r=b.getBoundingClientRect(),x=e?.clientX??r.left+r.width/2,y=e?.clientY??r.top+r.height/2,s=document.createElement("span");s.className="akira-click-spark";s.textContent=["✨","+🍪","✦","💫"][Math.floor(Math.random()*4)];s.style.left=x+"px";s.style.top=y+"px";s.style.setProperty("--dx",(Math.random()*70-35)+"px");s.style.setProperty("--dy",(Math.random()*65+30)+"px");document.body.append(s);setTimeout(()=>s.remove(),750);}
let queuedClickCount = 0;
let clickFlushTimer = null;
let clickRequestInFlight = false;

function scheduleClickFlush() {
  if (clickFlushTimer || clickRequestInFlight) return;
  clickFlushTimer = setTimeout(() => {
    clickFlushTimer = null;
    flushClickQueue();
  }, 110);
}

async function flushClickQueue() {
  if (clickRequestInFlight || queuedClickCount <= 0) return;
  const count = Math.min(25, queuedClickCount);
  queuedClickCount -= count;
  clickRequestInFlight = true;
  stateSyncVersion++;

  try {
    const data = await api("/click", {
      method: "POST",
      body: { count },
    });
    stateSyncVersion++;
    if (data.player) renderState(data);
    else await loadState();
    createClickPopup(null, data.reward ?? getClickPower() * count);
  } catch (error) {
    console.error("Ошибка клика:", error);
    showToast(error.message || "Не удалось выполнить клик");
    // Restore unsent taps so a temporary network failure doesn't silently eat them.
    queuedClickCount += count;
  } finally {
    clickRequestInFlight = false;
    if (queuedClickCount > 0) setTimeout(scheduleClickFlush, 1200);
  }
}

function clickCookie(event) {
  if (state.loading) return;
  animateCookie();
  queuedClickCount += 1;
  scheduleClickFlush();
}

/* =========================
   УЛУЧШЕНИЯ
========================= */

const UPGRADE_COUNTDOWN_SECONDS = { click: 3, auto: 5, multiplier: 600 };
const upgradeCountdowns = new Map();

function formatUpgradeCountdown(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
    : String(secs);
}

function startUpgradeCountdown(type, button) {
  if (upgradeCountdowns.has(type)) {
    clearInterval(upgradeCountdowns.get(type).timer);
    upgradeCountdowns.delete(type);
    button.textContent = "Купить";
    button.classList.remove("counting");
    button.disabled = false;
    showToast("Покупка отменена");
    return;
  }

  const duration = UPGRADE_COUNTDOWN_SECONDS[type];
  if (!duration) return;
  const finishAt = Date.now() + duration * 1000;
  button.disabled = false;
  button.classList.add("counting");
  button.setAttribute("aria-live", "polite");

  const tick = () => {
    const remaining = Math.max(0, Math.ceil((finishAt - Date.now()) / 1000));
    button.textContent = remaining > 0
      ? "Отмена · " + formatUpgradeCountdown(remaining)
      : "Покупка…";
    if (remaining <= 0) {
      clearInterval(upgradeCountdowns.get(type)?.timer);
      upgradeCountdowns.delete(type);
      button.classList.remove("counting");
      button.disabled = false;
      buyUpgrade(type);
    }
  };

  const timer = setInterval(tick, 250);
  upgradeCountdowns.set(type, { timer, button });
  tick();
}

async function buyUpgrade(type) {
  if (state.loading) return;

  state.loading = true;
  const buttons = $$("[data-upgrade]");
  buttons.forEach((item) => { item.disabled = true; });

  try {
    const data = await api("/upgrades", {
      method: "POST",
      body: { type, upgrade: type },
    });

    if (data.player || data.balance !== undefined) {
      renderState(data);
    } else {
      await loadState();
    }
    showToast(data.message || "Улучшение куплено!");
  } catch (error) {
    console.error("Ошибка покупки:", error);
    showToast(error.message || "Не удалось купить улучшение");
  } finally {
    state.loading = false;
    buttons.forEach((item) => {
      if (!upgradeCountdowns.has(item.dataset.upgrade)) item.disabled = false;
    });
  }
}

/* =========================
   ЕЖЕДНЕВНАЯ НАГРАДА
========================= */

async function claimDailyReward() {
  const button = $("#daily-button");
  if (button?.disabled) return;

  if (button) button.disabled = true;

  try {
    const data = await api("/daily", {
      method: "POST",
      body: {},
    });

    if (data.player || data.balance !== undefined) {
      renderState(data);
    } else {
      await loadState();
    }

    showToast(data.message || "Ежедневная награда получена!");
  } catch (error) {
    console.error("Ошибка ежедневной награды:", error);
    showToast(error.message || "Не удалось получить награду");
  } finally {
    updateDailyRewardButton();
  }
}

/* =========================
   ВКЛАДКИ И СВАЙПЫ
========================= */

// Делаем переключение вкладок доступным и другим модулям приложения.
window.switchTab = switchTab;

function switchTab(tabName, direction = 0) {
  if (!TABS.includes(tabName)) return;

  const oldIndex = TABS.indexOf(state.currentTab);
  const newIndex = TABS.indexOf(tabName);

  // Не выходим при повторном выборе вкладки: при запуске нужно
  // обязательно синхронизировать видимость панелей и кнопок навигации.

  state.currentTab = tabName;
  document.body.classList.toggle("games-fullscreen", tabName === "games");

  $$(".nav-button[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  TABS.forEach((name) => {
    const panel = $(`#tab-${name}`);
    if (!panel) return;

    const visible = name === tabName;
    panel.hidden = !visible;
    panel.classList.toggle("active", visible);
    panel.style.display = visible ? "" : "none";

    panel.classList.remove("tab-enter-left", "tab-enter-right");

    if (visible) {
      const sign = direction || (newIndex >= oldIndex ? 1 : -1);
      panel.classList.add(sign >= 0 ? "tab-enter-right" : "tab-enter-left");
    }
  });

  if (tabName === "top") { loadLeaderboard(); loadMonthlyLeaderboard(); }
  if (tabName === "profile") { loadState(); loadFriends(); }
  if (tabName === "themes") loadCollection();
}

function initSwipeNavigation() {
  const app = $("#app");
  if (!app) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  app.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) {
      tracking = false;
      return;
    }

    const target = event.target;
    if (
      target.closest("button, input, textarea, select, a, label, .chess-board, .durak-table")
    ) {
      tracking = false;
      return;
    }

    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  app.addEventListener("touchend", (event) => {
    if (!tracking || !event.changedTouches.length) return;
    tracking = false;

    const dx = event.changedTouches[0].clientX - startX;
    const dy = event.changedTouches[0].clientY - startY;

    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return;

    const index = TABS.indexOf(state.currentTab);
    const nextIndex = dx < 0
      ? Math.min(TABS.length - 1, index + 1)
      : Math.max(0, index - 1);

    if (nextIndex !== index) {
      switchTab(TABS[nextIndex], dx < 0 ? 1 : -1);
    }
  }, { passive: true });
}

/* =========================
   РЕЙТИНГ
========================= */

function updateMonthlyCountdown() {
  const el = $("#monthly-countdown");
  if (!el) return;
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  let remaining = Math.max(0, nextMonth.getTime() - now.getTime());
  const days = Math.floor(remaining / 86400000); remaining %= 86400000;
  const hours = Math.floor(remaining / 3600000); remaining %= 3600000;
  const minutes = Math.floor(remaining / 60000); remaining %= 60000;
  const seconds = Math.floor(remaining / 1000);
  const parts = [];
  if (days) parts.push(days + " д");
  parts.push(String(hours).padStart(2, "0") + " ч");
  parts.push(String(minutes).padStart(2, "0") + " мин");
  parts.push(String(seconds).padStart(2, "0") + " сек");
  el.textContent = "До сброса: " + parts.join(" ");
}

async function loadMonthlyLeaderboard() {
  const container = $("#monthly-leaderboard");
  if (!container) return;
  container.textContent = "Загрузка месячного рейтинга…";
  try {
    const data = await api("/leaderboard/monthly");
    const players = Array.isArray(data.players) ? data.players : [];
    const label = $("#monthly-period-label");
    if (label) label.textContent = data.period || "Текущий месяц";
    container.replaceChildren();
    if (!players.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "В этом месяце пока никто не набрал очки. Стань первым!";
      container.append(empty);
      return;
    }
    players.forEach((player, index) => {
      const position = player.monthly_top_rank || index + 1;
      const row = document.createElement("div");
      row.className = "leaderboard-row monthly-leaderboard-row";
      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = "#" + position;
      const avatar = document.createElement("img");
      avatar.className = "leaderboard-avatar";
      avatar.src = getAvatarUrl(player);
      avatar.alt = "";
      avatar.loading = "lazy";
      avatar.onerror = () => { avatar.onerror = null; avatar.src = "/avatar-default.svg"; };
      const details = document.createElement("div");
      details.className = "leaderboard-details";
      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = (player.name || player.username || "Игрок") + " [топ #" + position + "]";
      const level = document.createElement("span");
      level.className = "leaderboard-level";
      level.textContent = "LVL " + (player.level || 1) + " · " + (player.rank_title || "Новичок");
      details.append(name, level);
      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(Number(player.monthly_earned || 0)) + " за месяц";
      row.append(rank, avatar, details, score);
      container.append(row);
    });
  } catch (error) {
    container.textContent = error.message || "Не удалось загрузить месячный рейтинг";
  }
}

async function loadLeaderboard() {
  const container = $("#leaderboard");
  if (!container) return;

  container.replaceChildren();

  const loading = document.createElement("p");
  loading.className = "section-description";
  loading.textContent = "Загрузка рейтинга…";
  container.appendChild(loading);

  try {
    const data = await api("/leaderboard");
    const players = Array.isArray(data)
      ? data
      : data.players || data.leaderboard || [];

    container.replaceChildren();

    if (!players.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Пока нет игроков в рейтинге";
      container.appendChild(empty);
      return;
    }

    players.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `#${player.rank ?? index + 1}`;

      const avatar = document.createElement("img");
      avatar.className = "leaderboard-avatar";
      avatar.src = getAvatarUrl(player);
      avatar.alt = "";
      avatar.loading = "lazy";
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = "/avatar-default.svg";
      };

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = player.name || player.username || "Игрок";

      const details = document.createElement("div");
      details.className = "leaderboard-details";
      const level = document.createElement("span");
      level.className = "leaderboard-level";
      level.textContent = `LVL ${player.level ?? 1} · ${player.rank_title || "Новичок"}`;
      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = formatNumber(
        player.total_earned ?? player.totalEarned ?? player.score ?? player.balance
      );

      details.append(name, level);
      row.append(rank, avatar, details, score);
      container.appendChild(row);
    });
  } catch (error) {
    console.error("Ошибка рейтинга:", error);
    container.replaceChildren();

    const message = document.createElement("div");
    message.className = "empty-state";
    message.textContent = error.message || "Не удалось загрузить рейтинг";
    container.appendChild(message);
  }
}

/* =========================
   ПРОФИЛЬ
========================= */

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));

    reader.readAsDataURL(file);
  });
}

async function saveProfile(event) {
  event?.preventDefault();

  const nameInput = $("#profile-name-input");
  const avatarInput = $("#profile-avatar-input");
  const saveButton = $("#profile-save-button");

  const name = String(nameInput?.value || "").trim();

  if (!name || name.length > 24) {
    showToast("Имя должно содержать от 1 до 24 символов");
    nameInput?.focus();
    return;
  }

  let avatarUrl = getPlayer().avatar_url || null;
  const file = avatarInput?.files?.[0];

  if (file) {
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      showToast("Выбери PNG, JPG, WEBP или GIF");
      return;
    }

    if (file.size > 1024 * 1024) {
      showToast("Изображение должно быть меньше 1 МБ");
      return;
    }

    try {
      avatarUrl = await fileToDataUrl(file);
    } catch (error) {
      showToast(error.message);
      return;
    }
  }

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Сохраняем…";
  }

  try {
    const data = await api("/profile", {
      method: "PATCH",
      body: { name, avatar_url: avatarUrl },
    });

    if (data.player) renderState(data);
    else await loadState();

    if (avatarInput) avatarInput.value = "";

    showToast("Профиль сохранён");
  } catch (error) {
    console.error("Ошибка сохранения профиля:", error);
    showToast(error.message || "Не удалось сохранить профиль");
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "💾 Сохранить профиль";
    }
  }
}

async function resetAvatar() {
  const name = String($("#profile-name-input")?.value || getPlayer().name || "").trim();

  try {
    const data = await api("/profile", {
      method: "PATCH",
      body: { name: name || "Игрок", avatar_url: null },
    });

    if (data.player) renderState(data);
    else await loadState();

    const input = $("#profile-avatar-input");
    if (input) input.value = "";

    showToast("Установлена стандартная аватарка");
  } catch (error) {
    console.error("Ошибка сброса аватарки:", error);
    showToast(error.message || "Не удалось изменить аватарку");
  }
}

/* =========================
   МИНИ-ИГРЫ — МЕНЮ
========================= */

function openGameMenu(game) {
  state.selectedGame = game;

  const title = $("#game-menu-title");
  const description = $("#game-menu-description");
  const panel = $("#game-menu-panel");

  if (title) title.textContent = game === "durak" ? "🃏 Дурак" : "♟️ Шахматы";

  if (description) {
    description.textContent = game === "durak"
      ? "Выбери подкидной или переводной режим, затем игру с ботом или онлайн."
      : "Играй против бота или найди соперника онлайн.";
  }

  if (panel) panel.hidden = false;

  const durakSettings = $("#durak-mode")?.closest("label") || $("#durak-mode");
  const chessSettings = $("#chess-color")?.closest("label") || $("#chess-color");

  if (durakSettings) durakSettings.hidden = game !== "durak";
  if ($("#durak-mode")) $("#durak-mode").hidden = game !== "durak";
  if ($("#chess-color")) $("#chess-color").hidden = game !== "chess";

  const diff = $("#game-difficulty");
  if (diff) diff.hidden = false;

  $("#durak-game-panel")?.setAttribute("hidden", "");
  $("#chess-game-panel")?.setAttribute("hidden", "");
  panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function startSelectedGame(mode) {
  state.gameMode = mode;

  if (!state.selectedGame) {
    showToast("Сначала выбери игру");
    return;
  }

  const detail = {
    game: state.selectedGame,
    mode,
    difficulty: $("#game-difficulty")?.value || "easy",
    durakMode: $("#durak-mode")?.value || "throw-in",
    chessColor: $("#chess-color")?.value || "white",
  };

  document.dispatchEvent(new CustomEvent("akira:start-game", { detail }));

  if (state.selectedGame === "durak") {
    if (typeof window.startDurakGame === "function") {
      window.startDurakGame(detail);
    } else {
      showToast("Модуль «Дурак» ещё не загружен");
    }
  } else if (state.selectedGame === "chess") {
    if (typeof window.startChessGame === "function") {
      window.startChessGame(detail);
    } else {
      showToast("Шахматный модуль ещё не загружен");
    }
  }
}

/* =========================
   ОБРАБОТЧИКИ
========================= */

function initEventHandlers() {
  $("#cookie-button")?.addEventListener("click", e => clickCookie(e));

  $$("[data-upgrade]").forEach((button) => {
    button.addEventListener("click", () => startUpgradeCountdown(button.dataset.upgrade, button));
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".subtab-button[data-subtab-group][data-subtab]");
    if (!button) return;
    event.preventDefault();
    const group = button.dataset.subtabGroup;
    const target = button.dataset.subtab;
    const section = document.querySelector(`#tab-${group}`);
    if (!section) return;
    section.querySelectorAll(".subtab-button[data-subtab-group]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    });
    section.querySelectorAll("[data-subtab-panel]").forEach((panel) => {
      const active = panel.dataset.subtabPanel === `${group}:${target}`;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    try { sessionStorage.setItem(`akira-subtab-${group}`, target); } catch (_) {}
    if (group === "shop" && target === "cases") loadCollection();
    if (group === "shop" && target === "friends") loadFriends();
    if (group === "profile" && target === "tasks") loadTasks();
  });

  // Делегирование кликов: навигация продолжит работать даже после обновления DOM.
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-button[data-tab]");
    if (!button) return;
    event.preventDefault();
    switchTab(button.dataset.tab);
  });

  $("#daily-button")?.addEventListener("click", claimDailyReward);
  $("#prestige-button")?.addEventListener("click", performPrestige);
  $("#daily-shop-button")?.addEventListener("click", () => switchTab("profile"));
  $("#friend-search-button")?.addEventListener("click", searchFriend);
  $("#invite-friend-button")?.addEventListener("click", inviteFriend);
  $("#friend-username")?.addEventListener("keydown",e=>{if(e.key==="Enter")searchFriend();});
  $("#friends-refresh")?.addEventListener("click",loadFriends);
}

/* =========================
   ЗАПУСК
========================= */

function restoreSubtabs() {
  ["home", "shop", "profile"].forEach((group) => {
    let saved = null;
    try { saved = sessionStorage.getItem(`akira-subtab-${group}`); } catch (_) {}
    if (!saved) return;
    const button = document.querySelector(`.subtab-button[data-subtab-group="${group}"][data-subtab="${saved}"]`);
    if (button) button.click();
  });
}

function init() {
  restoreSubtabs();
  if (!window.akiraDailyTimer) window.akiraDailyTimer = setInterval(updateDailyRewardButton, 1000);
  updateMonthlyCountdown();
  if (!window.akiraMonthlyCountdown) window.akiraMonthlyCountdown = setInterval(updateMonthlyCountdown, 1000);
  // Refresh authoritative balance less aggressively; never overlap requests.
  if (!window.akiraAutoRefresh) window.akiraAutoRefresh = setInterval(() => {
    if (!document.hidden && !state.loading && state.currentTab === "home") loadState();
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.currentTab === "home") loadState();
  });
  const telegram = window.Telegram?.WebApp;

  try {
    telegram?.ready();
    telegram?.expand();
    telegram?.setHeaderColor?.("#170b12");
    telegram?.setBackgroundColor?.("#170b12");
  } catch (error) {
    console.warn("Telegram WebApp init:", error);
  }

  initThemes();
  initEventHandlers();
  // Load secondary data only when the corresponding tab is opened.
  initSwipeNavigation();

  switchTab("home");
  loadState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
