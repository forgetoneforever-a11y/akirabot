(() => {
  "use strict";

  const state = { socket: null, roomCode: null, game: null, snapshot: null };
  let identityCache = null;

  function identity() {
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;
    if (!tg?.initData || !user?.id) throw new Error("Открой AKIRA через Telegram, чтобы играть онлайн.");
    return {
      initData: tg.initData,
      playerId: String(user.id),
      name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок",
      avatar: user.photo_url || ""
    };
  }

  function emitAck(socket, event, payload, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Сервер не ответил. Попробуй ещё раз.")), timeout);
      socket.emit(event, payload, (result) => {
        clearTimeout(timer);
        if (!result?.ok) reject(new Error(result?.error || "Не удалось выполнить действие."));
        else resolve(result);
      });
    });
  }

  function apply(snapshot) {
    if (!snapshot || (state.roomCode && snapshot.code !== state.roomCode)) return;
    state.snapshot = snapshot;
    if (snapshot.code) state.roomCode = snapshot.code;
    if (snapshot.game === "chess") window.AKIRAChess?.applyOnlineState?.(snapshot);
    if (snapshot.game === "durak") window.AKIRADurak?.applyOnlineState?.(snapshot);
    window.dispatchEvent(new CustomEvent("akira:online-state", { detail: snapshot }));
  }

  async function connect() {
    if (state.socket?.connected) return state.socket;
    const user = identity();
    if (typeof window.io !== "function") throw new Error("Не загружен Socket.IO. Обнови страницу.");
    const socket = window.io({
      auth: { initData: user.initData, playerId: user.playerId },
      transports: ["websocket", "polling"],
      reconnection: true
    });
    state.socket = socket;
    socket.on("game:state", apply);
    socket.on("game:error", (error) => window.dispatchEvent(new CustomEvent("akira:online-error", {
      detail: { message: error?.message || "Ошибка онлайн-матча." }
    })));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Не удалось подключиться к игровому серверу.")), 15000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(new Error(error?.message || "Ошибка подключения.")); });
    }).catch((error) => {
      socket.disconnect();
      if (state.socket === socket) state.socket = null;
      throw error;
    });
    identityCache = user;
    return socket;
  }

  async function start(options = {}) {
    const game = options.game;
    if (!["chess", "durak"].includes(game)) throw new Error("Эта игра пока не поддерживает онлайн-режим.");
    if (state.socket) stop();
    const socket = await connect();
    state.game = game;
    state.roomCode = null;
    state.snapshot = null;
    try {
      const result = await emitAck(socket, "game:quick-match", { ...identityCache, game });
      state.roomCode = result.roomCode;
      if (game === "chess") window.startChessGame?.({ mode: "online" });
      if (game === "durak") window.startDurakGame?.({ mode: "online" });
      if (result.state) apply(result.state);
      return { success: true, waiting: result.waiting, message: result.waiting ? "Лобби создано. Ждём второго игрока…" : "Соперник найден. Матч начинается!" };
    } catch (error) {
      if (!state.roomCode) { socket.disconnect(); state.socket = null; }
      throw error;
    }
  }

  async function listLobbies(game = "chess") {
    const socket = await connect();
    const result = await emitAck(socket, "game:lobbies", { game });
    return result.rooms || [];
  }

  async function joinLobby(code, game = "chess") {
    const socket = await connect();
    const result = await emitAck(socket, "game:join", { ...identityCache, roomCode: code, game });
    state.game = game;
    state.roomCode = result.roomCode;
    if (game === "chess") window.startChessGame?.({ mode: "online" });
    if (game === "durak") window.startDurakGame?.({ mode: "online" });
    if (result.state) apply(result.state);
    return { success: true, message: "Подключаемся к партии…" };
  }

  async function action(action, payload = {}) {
    if (!state.socket?.connected) throw new Error("Соединение с игровым сервером потеряно.");
    const result = await emitAck(state.socket, "game:action", { action, roomCode: state.roomCode, ...payload });
    if (result.state) apply(result.state);
    return result;
  }

  function stop() {
    if (state.socket) {
      if (state.socket.connected) state.socket.emit("game:leave", { roomCode: state.roomCode });
      state.socket.removeAllListeners();
      state.socket.disconnect();
    }
    state.socket = null;
    state.roomCode = null;
    state.game = null;
    state.snapshot = null;
    identityCache = null;
  }

  window.AKIRAOnlineGames = { start, listLobbies, joinLobby, action, stop, stopPolling() {}, getState: () => ({ ...state, socket: undefined }) };
})();
