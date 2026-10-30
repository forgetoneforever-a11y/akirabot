(() => {
  "use strict";

  const state = { socket: null, roomCode: null, game: null, snapshot: null };
  let onState = null;

  function identity() {
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;
    if (!tg?.initData || !user?.id) {
      throw new Error("Открой AKIRA через Telegram, чтобы играть онлайн.");
    }
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

  async function start(options = {}) {
    const game = options.game;
    if (!["chess", "durak"].includes(game)) throw new Error("Эта игра пока не поддерживает онлайн-режим.");
    if (state.socket) stop();

    const user = identity();
    if (typeof window.io !== "function") throw new Error("Не загружен Socket.IO. Обнови страницу.");
    const socket = window.io({
      auth: { initData: user.initData, playerId: user.playerId },
      transports: ["websocket", "polling"],
      reconnection: true
    });
    state.socket = socket;
    state.game = game;
    state.roomCode = null;
    state.snapshot = null;

    socket.on("game:state", apply);
    socket.on("game:error", (error) => {
      const message = error?.message || "Ошибка онлайн-матча.";
      window.dispatchEvent(new CustomEvent("akira:online-error", { detail: { message } }));
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Не удалось подключиться к игровому серверу.")), 15000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(new Error(error?.message || "Ошибка подключения.")); });
    });

    const result = await emitAck(socket, "game:quick-match", {
      ...user,
      game
    });
    state.roomCode = result.roomCode;
    if (result.state) apply(result.state);
    if (game === "chess") window.startChessGame?.({ mode: "online" });
    if (game === "durak") window.startDurakGame?.({ mode: "online" });
    if (state.snapshot) apply(state.snapshot);

    return {
      success: true,
      message: result.waiting ? "Ищем второго игрока. Оставь игру открытой…" : "Соперник найден. Матч начинается!"
    };
  }

  async function action(action, payload = {}) {
    if (!state.socket?.connected) throw new Error("Соединение с игровым сервером потеряно.");
    const result = await emitAck(state.socket, "game:action", {
      action,
      roomCode: state.roomCode,
      ...payload
    });
    if (result.state) apply(result.state);
    return result;
  }

  function stopPolling() {
    // Kept for compatibility with the game menu's existing cleanup hook.
  }

  function stop() {
    if (state.socket) {
      if (state.socket.connected) {
        state.socket.emit("game:leave", { roomCode: state.roomCode });
      }
      state.socket.removeAllListeners();
      state.socket.disconnect();
    }
    state.socket = null;
    state.roomCode = null;
    state.game = null;
    state.snapshot = null;
  }

  window.AKIRAOnlineGames = { start, action, stop, stopPolling, getState: () => ({ ...state, socket: undefined }) };
})();