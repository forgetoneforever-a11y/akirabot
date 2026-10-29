"use strict";

/* Authenticated Socket.IO matchmaking for AKIRA online games. */
(() => {
  const state = { socket: null, roomCode: null, game: null, snapshot: null };
  const $ = (selector) => document.querySelector(selector);

  function getTelegramUser() {
    const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!user?.id) throw new Error("Открой AKIRA через Telegram, чтобы играть онлайн.");
    return user;
  }

  function status(message) {
    const id = state.game === "chess" ? "#chess-status" : "#durak-status";
    const el = $(id) || $("#game-mode-description");
    if (el) el.textContent = message;
    document.dispatchEvent(new CustomEvent("akira:game-status", {
      detail: { game: state.game, message }
    }));
  }

  function connect() {
    const user = getTelegramUser();
    const initData = window.Telegram?.WebApp?.initData || "";
    if (!initData) throw new Error("Не получены данные авторизации Telegram. Перезапусти Mini App.");
    if (typeof window.io !== "function") throw new Error("Онлайн-сервер не загружен. Обнови Mini App после деплоя.");

    if (state.socket?.connected) return Promise.resolve(state.socket);
    if (state.socket) state.socket.disconnect();

    const socket = window.io({
      auth: { playerId: String(user.id), initData },
      transports: ["websocket", "polling"],
      reconnection: true,
      timeout: 12000
    });
    state.socket = socket;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Не удалось подключиться к игровому серверу.")), 12000);
      socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(new Error(error?.message || "Ошибка подключения к онлайн-серверу."));
      });
      socket.on("game:state", (snapshot) => {
        state.snapshot = snapshot;
        state.roomCode = snapshot.code;
        state.game = snapshot.game;
        const players = (snapshot.players || []).map((p) => p.name + (p.connected ? " • онлайн" : " • переподключение")).join(" / ");
        status(snapshot.message || (snapshot.status === "playing" ? "Матч начался!" : "Ожидаем соперника…") + (players ? " " + players : ""));
        document.dispatchEvent(new CustomEvent("akira:online-state", { detail: snapshot }));
      });
      socket.on("game:error", (error) => status(error?.message || "Ошибка онлайн-игры."));
      socket.on("disconnect", () => status("Связь потеряна. Пытаемся переподключиться…"));
    });
  }

  async function start(options = {}) {
    const game = options.game === "chess" ? "chess" : "durak";
    const user = getTelegramUser();
    const socket = await connect();
    state.game = game;
    status("Ищем соперника…");
    const result = await new Promise((resolve, reject) => {
      socket.emit("game:quick-match", {
        game,
        playerId: String(user.id),
        name: user.first_name || user.username || "Игрок",
        avatar: user.photo_url || null
      }, (response) => {
        if (!response?.ok) reject(new Error(response?.error || "Не удалось начать поиск матча."));
        else resolve(response);
      });
    });
    state.roomCode = result.roomCode;
    state.snapshot = result.state;
    status(result.waiting ? "Ищем второго игрока… Код комнаты: " + result.roomCode : "Соперник найден! Подготовка матча…");
    return {
      success: true,
      message: result.waiting ? "Ищем соперника… Код комнаты: " + result.roomCode : "Соперник найден!",
      roomCode: result.roomCode,
      state: result.state
    };
  }

  function action(action, payload = {}) {
    if (!state.socket?.connected) return Promise.reject(new Error("Нет подключения к игровому серверу."));
    return new Promise((resolve, reject) => {
      state.socket.emit("game:action", { roomCode: state.roomCode, action, ...payload }, (result) => {
        if (!result?.ok) reject(new Error(result?.error || "Ход не принят."));
        else resolve(result);
      });
    });
  }

  function ready() {
    if (!state.socket?.connected) return;
    state.socket.emit("game:ready", { roomCode: state.roomCode }, (result) => {
      if (!result?.ok) status(result?.error || "Не удалось подтвердить готовность.");
    });
  }

  function leave() {
    if (!state.socket) return;
    state.socket.emit("game:leave", { roomCode: state.roomCode });
    state.roomCode = null;
    state.snapshot = null;
    state.game = null;
  }

  function stopPolling() {}
  window.AKIRAOnlineGames = { start, action, ready, leave, stopPolling, getState: () => ({ ...state }) };
})();