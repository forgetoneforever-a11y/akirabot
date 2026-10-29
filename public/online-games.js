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


  function cardElement(card, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "playing-card" + ("♥♦".includes(card.suit) ? " red-suit" : "");
    button.dataset.onlineCard = card.id;
    button.setAttribute("aria-label", card.rank + card.suit);
    const rank = document.createElement("span");
    rank.className = "card-rank";
    rank.textContent = ({J:"В",Q:"Д",K:"К",A:"Т"})[card.rank] || card.rank;
    const suit = document.createElement("span");
    suit.className = "card-suit";
    suit.textContent = card.suit;
    button.append(rank, suit);
    button.addEventListener("click", onClick);
    return button;
  }

  function renderOnlineDurak(snapshot) {
    const game = snapshot.durak;
    if (!game) return;
    const seat = snapshot.yourSeat;
    const isTurn = snapshot.turn === snapshot.yourPlayerId && snapshot.status === "playing";
    const isAttacker = seat === game.attacker;
    const isDefender = seat === game.defender;
    const opponent = $("#durak-opponent-hand");
    const hand = $("#durak-player-hand");
    const field = $("#durak-field");
    const trump = $("#durak-trump");
    if (!opponent || !hand || !field || !trump) return;
    opponent.replaceChildren();
    for (let i = 0; i < Math.min(game.opponentHandCount || 0, 12); i++) {
      const back = document.createElement("div");
      back.className = "playing-card card-back";
      back.textContent = "✦";
      opponent.appendChild(back);
    }
    const opponentLabel = document.createElement("span");
    opponentLabel.className = "durak-hand-count";
    const rival = snapshot.players?.[1 - seat];
    opponentLabel.textContent = (rival?.name || "Соперник") + ": " + (game.opponentHandCount || 0) + " карт";
    opponent.appendChild(opponentLabel);
    trump.replaceChildren();
    const trumpLabel = document.createElement("span");
    trumpLabel.className = "durak-trump-label";
    trumpLabel.textContent = "Козырь: ";
    const trumpValue = document.createElement("strong");
    trumpValue.textContent = game.trump || "—";
    trump.append(trumpLabel, trumpValue);
    const count = document.createElement("span");
    count.className = "durak-deck-count";
    count.textContent = " Колода: " + game.deckCount;
    trump.appendChild(count);
    field.replaceChildren();
    if (!game.table.length) {
      const empty = document.createElement("span");
      empty.className = "section-description";
      empty.textContent = "Стол пуст — можно начать атаку";
      field.appendChild(empty);
    }
    for (const pair of game.table) {
      const pairEl = document.createElement("div");
      pairEl.className = "durak-card-pair";
      pairEl.appendChild(cardElement(pair.attack, () => {}));
      if (pair.defense) {
        const defense = cardElement(pair.defense, () => {});
        defense.classList.add("defense-card");
        pairEl.appendChild(defense);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "playing-card defense-placeholder";
        placeholder.textContent = "…";
        pairEl.appendChild(placeholder);
      }
      field.appendChild(pairEl);
    }
    hand.replaceChildren();
    if (!game.hand.length) {
      const empty = document.createElement("span");
      empty.className = "section-description";
      empty.textContent = "Карт на руках нет";
      hand.appendChild(empty);
    }
    for (const card of game.hand) {
      const button = cardElement(card, () => {
        if (!isTurn) return status("Сейчас ход соперника.");
        let request;
        if (isAttacker && (game.phase === "attack" || game.phase === "throw")) {
          request = action("attack", { cardId: card.id });
        } else if (isDefender && game.phase === "defend") {
          const target = game.table.find((pair) => !pair.defense);
          if (!target) return status("Нет карты, которую нужно отбить.");
          request = action("defend", { attackCardId: target.attack.id, defenseCardId: card.id });
        } else {
          return status("Сейчас нельзя сыграть эту карту.");
        }
        request.catch((error) => status(error.message));
      });
      button.disabled = !isTurn || snapshot.status !== "playing";
      hand.appendChild(button);
    }
    const takeButton = $('[data-durak-action="take"]');
    const passButton = $('[data-durak-action="pass"]');
    if (takeButton) {
      takeButton.disabled = !(isTurn && isDefender && game.phase === "defend");
      takeButton.textContent = "Взять карты";
    }
    if (passButton) {
      passButton.disabled = !(isTurn && isAttacker && game.phase === "throw");
      passButton.textContent = "Завершить атаку";
    }
  }

  document.addEventListener("click", (event) => {
    const take = event.target.closest('[data-durak-action="take"]');
    const pass = event.target.closest('[data-durak-action="pass"]');
    if (!take && !pass) return;
    if (state.game !== "durak" || !state.snapshot?.durak) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (take) action("take").catch((error) => status(error.message));
    else action("pass").catch((error) => status(error.message));
  }, true);

  document.addEventListener("akira:online-state", (event) => {
    const snapshot = event.detail;
    if (!snapshot) return;
    if (snapshot.game === "chess" && window.AKIRAChess?.applyOnlineState) {
      window.AKIRAChess.applyOnlineState(snapshot);
    } else if (snapshot.game === "durak") {
      renderOnlineDurak(snapshot);
    }
  });

  function stopPolling() { leave(); }
  window.AKIRAOnlineGames = { start, action, ready, leave, stopPolling, getState: () => ({ ...state }) };
})();