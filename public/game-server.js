// game-server.js
// Сервер игровых комнат AKIRA: онлайн-матчи в «Дурака» и шахматы.
// Подключение: const gameServer = require("./game-server");
// gameServer.attach(server);

"use strict";

const crypto = require("crypto");
const { Server } = require("socket.io");

const ROOM_PREFIX = "akira-game:";
const MAX_ROOM_PLAYERS = 2;
const ROOM_CODE_LENGTH = 6;
const TURN_TIMEOUT_MS = 90_000;
const RECONNECT_GRACE_MS = 60_000;

const GAME_TYPES = new Set(["durak", "chess"]);
const GAME_MODES = new Set(["online"]);
const rooms = new Map();
const socketPlayers = new Map();

function randomId(length = ROOM_CODE_LENGTH) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function safeName(value) {
  const name = String(value || "Игрок").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return Array.from(name).slice(0, 32).join("") || "Игрок";
}

function safeAvatar(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (/^https:\/\/[^\s]+$/i.test(value)) return value;
  if (/^\/images\/[a-zA-Z0-9._/-]+$/.test(value)) return value;
  return null;
}

function createRoomCode() {
  let code;
  do {
    code = randomId();
  } while (rooms.has(code));
  return code;
}

function shuffle(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  return suits.flatMap((suit) =>
    ranks.map((rank) => ({
      id: `${rank}${suit}`,
      rank,
      suit,
      value: ranks.indexOf(rank),
    }))
  );
}

function cardPublic(card) {
  return card ? { id: card.id, rank: card.rank, suit: card.suit } : null;
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    connected: Boolean(player.socketId),
    ready: Boolean(player.ready),
  };
}

function roomSnapshot(room, viewerId) {
  const playerIndex = room.players.findIndex((player) => player.id === viewerId);
  const viewer = room.players[playerIndex];

  const result = {
    code: room.code,
    game: room.game,
    status: room.status,
    players: room.players.map(publicPlayer),
    yourPlayerId: viewerId,
    yourSeat: playerIndex,
    turn: room.turn,
    revision: room.revision,
    message: room.message || "",
  };

  if (room.game === "durak" && room.durak) {
    result.durak = {
      trump: room.durak.trump,
      deckCount: room.durak.deck.length,
      attacker: room.durak.attacker,
      defender: room.durak.defender,
      phase: room.durak.phase,
      table: room.durak.table.map((pair) => ({
        attack: cardPublic(pair.attack),
        defense: cardPublic(pair.defense),
      })),
      hand: viewer ? viewer.hand.map(cardPublic) : [],
      opponentHandCount:
        room.players[1 - playerIndex]?.hand?.length ?? 0,
      canTake:
        room.durak.phase === "defend" &&
        playerIndex === room.durak.defender &&
        room.turn === viewerId,
      canPass:
        room.durak.phase === "throw" &&
        playerIndex === room.durak.attacker &&
        room.turn === viewerId,
      winner: room.winner || null,
    };
  }

  if (room.game === "chess" && room.chess) {
    result.chess = {
      fen: room.chess.fen,
      pgn: room.chess.pgn,
      history: room.chess.history,
      color: playerIndex === 0 ? "w" : "b",
      winner: room.winner || null,
      lastMove: room.chess.lastMove || null,
    };
  }

  return result;
}

function emitRoom(io, room) {
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit("game:state", roomSnapshot(room, player.id));
  }
}

function emitError(socket, message, code = "GAME_ERROR") {
  socket.emit("game:error", { code, message });
}

function findPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function playerRoom(io, socket) {
  const session = socketPlayers.get(socket.id);
  if (!session) return null;
  const room = rooms.get(session.roomCode);
  if (!room) return null;
  const player = findPlayer(room, session.playerId);
  if (!player) return null;
  return { room, player, session };
}

function clearRoomTimers(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.turnTimer = null;
  room.cleanupTimer = null;
}

function destroyRoom(room) {
  clearRoomTimers(room);
  rooms.delete(room.code);
}

function scheduleRoomCleanup(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    destroyRoom(room);
  }, RECONNECT_GRACE_MS);
  room.cleanupTimer.unref?.();
}

function touchRoom(room) {
  room.revision += 1;
  room.updatedAt = Date.now();
}

function startTurnTimer(io, room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;

  if (room.status !== "playing" || !room.turn) return;

  room.turnTimer = setTimeout(() => {
    if (room.status !== "playing" || !room.turn) return;

    const current = findPlayer(room, room.turn);
    if (!current) return;

    room.message = `Время хода игрока ${current.name} истекло.`;
    finishGame(room, room.players.find((p) => p.id !== current.id)?.id || null, "timeout");
    touchRoom(room);
    emitRoom(io, room);
  }, TURN_TIMEOUT_MS);

  room.turnTimer.unref?.();
}

function setTurn(io, room, playerId) {
  room.turn = playerId;
  startTurnTimer(io, room);
}

function finishGame(room, winnerId, reason = "finished") {
  room.status = "finished";
  room.winner = winnerId;
  room.finishReason = reason;
  room.turn = null;
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
}

function createRoom({ game, player }) {
  const code = createRoomCode();
  const room = {
    code,
    game,
    mode: "online",
    status: "waiting",
    players: [
      {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        socketId: player.socketId,
        ready: true,
        hand: [],
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 0,
    turn: null,
    winner: null,
    message: "Ожидание второго игрока.",
    durak: null,
    chess: null,
    turnTimer: null,
    cleanupTimer: null,
  };

  rooms.set(code, room);
  return room;
}

function setupDurak(room) {
  const deck = shuffle(createDeck());
  const players = room.players;

  players.forEach((player) => {
    player.hand = deck.splice(0, 6);
  });

  const trumpCard = deck[deck.length - 1] || null;
  const trump = trumpCard ? trumpCard.suit : "♠";

  const lowestTrump = players.map((player, index) => {
    const trumps = player.hand.filter((card) => card.suit === trump);
    const lowest = trumps.reduce(
      (best, card) => (!best || card.value < best.value ? card : best),
      null
    );
    return { index, card: lowest };
  });

  let attacker = 0;
  const candidates = lowestTrump.filter((item) => item.card);

  if (candidates.length === 1) {
    attacker = candidates[0].index;
  } else if (candidates.length === 2) {
    attacker = candidates[0].card.value <= candidates[1].card.value
      ? candidates[0].index
      : candidates[1].index;
  }

  room.durak = {
    deck,
    trump,
    attacker,
    defender: 1 - attacker,
    table: [],
    phase: "attack",
    throwLimit: 6,
  };

  room.players.forEach((player) => {
    player.hand.sort((a, b) => {
      if (a.suit === trump && b.suit !== trump) return 1;
      if (a.suit !== trump && b.suit === trump) return -1;
      if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
      return a.value - b.value;
    });
  });

  room.turn = room.players[attacker].id;
  room.status = "playing";
  room.message = "Матч начался. Ход атакующего.";
}

function setupChess(room) {
  room.chess = {
    fen: "start",
    pgn: "",
    history: [],
    lastMove: null,
    turnColor: "w",
  };

  room.status = "playing";
  room.turn = room.players[0].id;
  room.message = "Матч начался. Белые ходят первыми.";
}

function startRoom(io, room) {
  if (room.players.length !== MAX_ROOM_PLAYERS) return false;
  if (room.status !== "waiting") return false;
  if (room.players.some((player) => !player.socketId)) return false;

  room.players.forEach((player) => {
    player.ready = true;
  });

  if (room.game === "durak") setupDurak(room);
  else if (room.game === "chess") setupChess(room);
  else return false;

  touchRoom(room);
  startTurnTimer(io, room);
  emitRoom(io, room);
  return true;
}

function joinRoom(room, player) {
  if (room.status !== "waiting") {
    throw new Error("Этот матч уже начался.");
  }

  if (room.players.length >= MAX_ROOM_PLAYERS) {
    throw new Error("В комнате уже есть два игрока.");
  }

  if (room.players.some((item) => item.id === player.id)) {
    throw new Error("Этот игрок уже находится в комнате.");
  }

  room.players.push({
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    socketId: player.socketId,
    ready: true,
    hand: [],
  });

  room.message = "Оба игрока подключены. Матч начинается.";
}

function assertTurn(room, player) {
  if (room.status !== "playing") {
    throw new Error("Матч сейчас не активен.");
  }

  if (room.turn !== player.id) {
    throw new Error("Сейчас ход соперника.");
  }
}

function parseDurakCard(player, cardId) {
  const card = player.hand.find((card) => card.id === String(cardId));
  if (!card) throw new Error("Эта карта не находится у тебя в руке.");
  return card;
}

function beatsDurakCard(attack, defense, trump) {
  if (!attack || !defense) return false;
  if (attack.suit === defense.suit) {
    return defense.value > attack.value;
  }
  return defense.suit === trump && attack.suit !== trump;
}

function refillDurakHands(room) {
  const game = room.durak;
  const order = [game.attacker, game.defender];

  for (const index of order) {
    const player = room.players[index];
    while (player.hand.length < 6 && game.deck.length > 0) {
      player.hand.push(game.deck.shift());
    }
  }
}

function checkDurakFinished(room) {
  const game = room.durak;
  if (!game) return false;

  if (game.deck.length > 0) return false;

  const empty = room.players.map((player) => player.hand.length === 0);

  if (empty[0] && empty[1]) {
    finishGame(room, null, "draw");
    room.message = "Ничья: у обоих игроков закончились карты.";
    return true;
  }

  if (empty[0] || empty[1]) {
    const winnerIndex = empty[0] ? 0 : 1;
    finishGame(room, room.players[winnerIndex].id, "durak");
    room.message = `${room.players[winnerIndex].name} победил!`;
    return true;
  }

  return false;
}

function finishDurakRound(io, room, tookCards) {
  const game = room.durak;
  if (!game) return;

  if (tookCards) {
    const defender = room.players[game.defender];
    for (const pair of game.table) {
      if (pair.attack) defender.hand.push(pair.attack);
      if (pair.defense) defender.hand.push(pair.defense);
    }

    game.table = [];
    game.attacker = 1 - game.attacker;
    game.defender = 1 - game.attacker;
    game.phase = "attack";
  } else {
    game.table = [];
    game.attacker = game.defender;
    game.defender = 1 - game.attacker;
    game.phase = "attack";
  }

  refillDurakHands(room);

  if (checkDurakFinished(room)) {
    touchRoom(room);
    emitRoom(io, room);
    return;
  }

  room.message = tookCards
    ? "Защищающийся забрал карты. Ход переходит к другому игроку."
    : "Карты отбиты. Начинается новая атака.";

  setTurn(io, room, room.players[game.attacker].id);
  touchRoom(room);
  emitRoom(io, room);
}

function durakAttack(io, room, player, cardId) {
  const game = room.durak;
  assertTurn(room, player);

  if (!game || game.phase !== "attack" && game.phase !== "throw") {
    throw new Error("Сейчас нельзя подкидывать карты.");
  }

  const playerIndex = room.players.findIndex((item) => item.id === player.id);
  if (playerIndex !== game.attacker) {
    throw new Error("Атаковать может только атакующий игрок.");
  }

  const card = parseDurakCard(player, cardId);

  if (game.table.length >= game.throwLimit) {
    throw new Error("Достигнут лимит карт на столе.");
  }

  const ranksOnTable = game.table.flatMap((pair) => [
    pair.attack?.rank,
    pair.defense?.rank,
  ]).filter(Boolean);

  if (game.table.length > 0 && !ranksOnTable.includes(card.rank)) {
    throw new Error("Можно подкидывать только карту с рангом, который уже есть на столе.");
  }

  if (game.table.length >= room.players[game.defender].hand.length) {
    throw new Error("У защищающегося недостаточно карт для этой атаки.");
  }

  player.hand = player.hand.filter((item) => item.id !== card.id);
  game.table.push({ attack: card, defense: null });
  game.phase = "defend";
  room.message = `${player.name} атакует. Защищающийся выбирает карту.`;

  setTurn(io, room, room.players[game.defender].id);
  touchRoom(room);
  emitRoom(io, room);
}

function durakDefend(io, room, player, attackCardId, defenseCardId) {
  const game = room.durak;
  assertTurn(room, player);

  if (!game || game.phase !== "defend") {
    throw new Error("Сейчас нельзя отбиваться.");
  }

  const playerIndex = room.players.findIndex((item) => item.id === player.id);
  if (playerIndex !== game.defender) {
    throw new Error("Отбиваться может только защищающийся.");
  }

  const pair = game.table.find(
    (item) => item.attack?.id === String(attackCardId) && !item.defense
  );

  if (!pair) throw new Error("Эта атакующая карта уже закрыта или не найдена.");

  const defense = parseDurakCard(player, defenseCardId);

  if (!beatsDurakCard(pair.attack, defense, game.trump)) {
    throw new Error("Эта карта не может побить атакующую.");
  }

  player.hand = player.hand.filter((item) => item.id !== defense.id);
  pair.defense = defense;

  const allCovered = game.table.every((item) => item.defense);

  if (allCovered) {
    game.phase = "throw";
    room.message = "Все карты побиты. Атакующий может подкинуть карту или закончить ход.";
    setTurn(io, room, room.players[game.attacker].id);
  } else {
    room.message = "Карта побита. Продолжай защищаться.";
  }

  touchRoom(room);
  emitRoom(io, room);
}

function durakTake(io, room, player) {
  const game = room.durak;
  assertTurn(room, player);

  if (!game || game.phase !== "defend") {
    throw new Error("Сейчас нельзя брать карты.");
  }

  const playerIndex = room.players.findIndex((item) => item.id === player.id);
  if (playerIndex !== game.defender) {
    throw new Error("Забирать карты может только защищающийся.");
  }

  finishDurakRound(io, room, true);
}

function durakPass(io, room, player) {
  const game = room.durak;
  assertTurn(room, player);

  if (!game || game.phase !== "throw") {
    throw new Error("Сейчас нельзя завершить атаку.");
  }

  const playerIndex = room.players.findIndex((item) => item.id === player.id);
  if (playerIndex !== game.attacker) {
    throw new Error("Завершить атаку может только атакующий.");
  }

  if (!game.table.every((pair) => pair.defense)) {
    throw new Error("Сначала нужно отбить все карты или забрать их.");
  }

  finishDurakRound(io, room, false);
}

function chessMove(io, room, player, move) {
  assertTurn(room, player);

  if (!room.chess) throw new Error("Шахматная партия не инициализирована.");

  const playerIndex = room.players.findIndex((item) => item.id === player.id);
  const expectedColor = playerIndex === 0 ? "w" : "b";
  const from = String(move?.from || "");
  const to = String(move?.to || "");
  const promotion = move?.promotion ? String(move.promotion) : "q";

  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) {
    throw new Error("Некорректный ход.");
  }

  if (!["q", "r", "b", "n"].includes(promotion)) {
    throw new Error("Некорректная фигура для превращения пешки.");
  }

  /*
   * Сервер хранит историю ходов в SAN/UGCI-подобном виде и проверяет
   * легальность на своей стороне через chess.js, если библиотека установлена.
   */
  let Chess;
  try {
    Chess = require("chess.js").Chess;
  } catch {
    try {
      Chess = require("chess.js");
    } catch {
      throw new Error("Для онлайн-шахмат установи зависимость chess.js.");
    }
  }

  if (!room.chess.engine) {
    const engine = new Chess();
    for (const san of room.chess.history) {
      const replay = engine.move(san, { sloppy: true });
      if (!replay) throw new Error("Не удалось восстановить историю шахмат.");
    }
    room.chess.engine = engine;
  }

  const engine = room.chess.engine;

  if (engine.turn() !== expectedColor) {
    throw new Error("Неверный цвет фигуры для этого игрока.");
  }

  const result = engine.move({ from, to, promotion });

  if (!result) {
    throw new Error("Недопустимый шахматный ход.");
  }

  room.chess.history.push(result.san);
  room.chess.fen = engine.fen();
  room.chess.pgn = engine.pgn();
  room.chess.lastMove = {
    from: result.from,
    to: result.to,
    san: result.san,
    color: result.color,
  };

  if (engine.isGameOver()) {
    let winnerId = null;
    let reason = "draw";

    if (engine.isCheckmate()) {
      winnerId = room.players[playerIndex].id;
      reason = "checkmate";
      room.message = `${room.players[playerIndex].name} поставил мат!`;
    } else {
      room.message = "Шахматная партия завершилась вничью.";
    }

    finishGame(room, winnerId, reason);
  } else {
    const nextColor = engine.turn();
    const nextIndex = nextColor === "w" ? 0 : 1;
    room.message = `Ход игрока ${room.players[nextIndex].name}.`;
    setTurn(io, room, room.players[nextIndex].id);
  }

  touchRoom(room);
  emitRoom(io, room);
}
function registerHandlers(io, socket) {
  socket.on("game:create", (payload = {}, callback) => {
    try {
      const game = String(payload.game || "").toLowerCase();

      if (!GAME_TYPES.has(game)) {
        throw new Error("Неизвестный тип игры.");
      }

      const playerId = String(payload.playerId || socket.data.playerId || "").trim();

      if (!playerId || playerId.length > 128) {
        throw new Error("Не удалось определить игрока. Перезайди через Telegram.");
      }

      const existing = playerRoom(io, socket);

      if (existing && existing.room.status !== "finished") {
        throw new Error("Сначала выйди из текущего матча.");
      }

      const room = createRoom({
        game,
        player: {
          id: playerId,
          name: safeName(payload.name),
          avatar: safeAvatar(payload.avatar),
          socketId: socket.id,
        },
      });

      socketPlayers.set(socket.id, {
        roomCode: room.code,
        playerId,
      });

      socket.join(`${ROOM_PREFIX}${room.code}`);
      touchRoom(room);

      const result = {
        ok: true,
        roomCode: room.code,
        state: roomSnapshot(room, playerId),
      };

      socket.emit("game:state", result.state);
      if (typeof callback === "function") callback(result);
    } catch (error) {
      emitError(socket, error.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("game:join", (payload = {}, callback) => {
    try {
      const code = String(payload.roomCode || payload.code || "")
        .trim()
        .toUpperCase();

      const playerId = String(payload.playerId || socket.data.playerId || "").trim();

      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
        throw new Error("Введи корректный код комнаты.");
      }

      if (!playerId || playerId.length > 128) {
        throw new Error("Не удалось определить игрока. Перезайди через Telegram.");
      }

      const existing = playerRoom(io, socket);

      if (existing && existing.room.status !== "finished") {
        throw new Error("Сначала выйди из текущего матча.");
      }

      const room = rooms.get(code);

      if (!room) {
        throw new Error("Комната не найдена. Проверь код.");
      }

      if (room.game !== String(payload.game || room.game).toLowerCase()) {
        throw new Error("Тип игры не совпадает с типом комнаты.");
      }

      joinRoom(room, {
        id: playerId,
        name: safeName(payload.name),
        avatar: safeAvatar(payload.avatar),
        socketId: socket.id,
      });

      socketPlayers.set(socket.id, {
        roomCode: room.code,
        playerId,
      });

      socket.join(`${ROOM_PREFIX}${room.code}`);

      if (room.players.length === MAX_ROOM_PLAYERS) {
        startRoom(io, room);
      } else {
        touchRoom(room);
        emitRoom(io, room);
      }

      const result = {
        ok: true,
        roomCode: room.code,
        state: roomSnapshot(room, playerId),
      };

      if (typeof callback === "function") callback(result);
    } catch (error) {
      emitError(socket, error.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("game:quick-match", (payload = {}, callback) => {
    try {
      const game = String(payload.game || "").toLowerCase();
      const playerId = String(payload.playerId || socket.data.playerId || "").trim();

      if (!GAME_TYPES.has(game)) throw new Error("Неизвестный тип игры.");
      if (!playerId || playerId.length > 128) {
        throw new Error("Не удалось определить игрока.");
      }

      const existing = playerRoom(io, socket);

      if (existing && existing.room.status !== "finished") {
        throw new Error("Сначала выйди из текущего матча.");
      }

      const waitingRoom = [...rooms.values()].find(
        (room) =>
          room.game === game &&
          room.status === "waiting" &&
          room.players.length === 1 &&
          room.players[0].id !== playerId
      );

      const player = {
        id: playerId,
        name: safeName(payload.name),
        avatar: safeAvatar(payload.avatar),
        socketId: socket.id,
      };

      const room = waitingRoom || createRoom({ game, player });

      if (waitingRoom) {
        joinRoom(room, player);
      }

      socketPlayers.set(socket.id, {
        roomCode: room.code,
        playerId,
      });

      socket.join(`${ROOM_PREFIX}${room.code}`);

      if (room.players.length === MAX_ROOM_PLAYERS) {
        startRoom(io, room);
      } else {
        room.message = "Ищем второго игрока...";
        touchRoom(room);
        emitRoom(io, room);
      }

      const result = {
        ok: true,
        roomCode: room.code,
        waiting: room.players.length < MAX_ROOM_PLAYERS,
        state: roomSnapshot(room, playerId),
      };

      if (typeof callback === "function") callback(result);
    } catch (error) {
      emitError(socket, error.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("game:ready", (payload = {}, callback) => {
    try {
      const session = playerRoom(io, socket);
      if (!session) throw new Error("Ты не находишься в комнате.");

      const { room, player } = session;

      if (payload.roomCode && String(payload.roomCode).toUpperCase() !== room.code) {
        throw new Error("Код комнаты не совпадает.");
      }

      player.ready = true;

      if (
        room.status === "waiting" &&
        room.players.length === MAX_ROOM_PLAYERS &&
        room.players.every((item) => item.ready)
      ) {
        startRoom(io, room);
      } else {
        touchRoom(room);
        emitRoom(io, room);
      }

      if (typeof callback === "function") callback({ ok: true });
    } catch (error) {
      emitError(socket, error.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("game:action", (payload = {}, callback) => {
    try {
      const session = playerRoom(io, socket);
      if (!session) throw new Error("Ты не находишься в комнате.");

      const { room, player } = session;
      const action = String(payload.action || "").toLowerCase();

      if (payload.roomCode && String(payload.roomCode).toUpperCase() !== room.code) {
        throw new Error("Код комнаты не совпадает.");
      }

      if (room.status !== "playing") {
        throw new Error("Матч ещё не начался или уже завершён.");
      }

      if (room.game === "durak") {
        switch (action) {
          case "attack":
          case "play-card":
            durakAttack(io, room, player, payload.cardId);
            break;

          case "defend":
            durakDefend(
              io,
              room,
              player,
              payload.attackCardId,
              payload.defenseCardId
            );
            break;

          case "take":
            durakTake(io, room, player);
            break;

          case "pass":
          case "finish-attack":
            durakPass(io, room, player);
            break;

          default:
            throw new Error("Неизвестное действие в игре «Дурак».");
        }
      } else if (room.game === "chess") {
        if (action !== "move") {
          throw new Error("Неизвестное действие в шахматах.");
        }

        chessMove(io, room, player, payload.move);
      }

      if (typeof callback === "function") {
        callback({
          ok: true,
          state: roomSnapshot(room, player.id),
        });
      }
    } catch (error) {
      emitError(socket, error.message);

      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("game:leave", (payload = {}, callback) => {
    try {
      const session = playerRoom(io, socket);

      if (!session) {
        if (typeof callback === "function") callback({ ok: true });
        return;
      }

      const { room, player } = session;

      if (payload.roomCode && String(payload.roomCode).toUpperCase() !== room.code) {
        throw new Error("Код комнаты не совпадает.");
      }

      socket.leave(`${ROOM_PREFIX}${room.code}`);
      socketPlayers.delete(socket.id);

      player.socketId = null;
      player.ready = false;

      if (room.status === "playing") {
        const otherPlayer = room.players.find((item) => item.id !== player.id);

        finishGame(room, otherPlayer?.id || null, "forfeit");
        room.message = `${player.name} покинул матч.`;
        touchRoom(room);
        emitRoom(io, room);
      } else if (room.status === "waiting") {
        destroyRoom(room);
      } else {
        touchRoom(room);
        emitRoom(io, room);
      }

      if (typeof callback === "function") callback({ ok: true });
    } catch (error) {
      emitError(socket, error.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("game:rematch", (payload = {}, callback) => {
    try {
      const session = playerRoom(io, socket);
      if (!session) throw new Error("Ты не находишься в комнате.");

      const { room, player } = session;

      if (room.status !== "finished") {
        throw new Error("Сначала закончи текущий матч.");
      }

      if (room.players.length !== MAX_ROOM_PLAYERS ||
          room.players.some((item) => !item.socketId)) {
        throw new Error("Оба игрока должны быть подключены.");
      }

      if (room.game === "durak") {
        room.players.forEach((item) => {
          item.hand = [];
          item.ready = false;
        });

        player.ready = true;
        room.status = "waiting";
        room.winner = null;
        room.turn = null;
        room.durak = null;
        room.message = "Ожидаем согласия соперника на реванш.";
      } else {
        room.players.forEach((item) => {
          item.ready = false;
        });

        player.ready = true;
        room.status = "waiting";
        room.winner = null;
        room.turn = null;
        room.chess = null;
        room.message = "Ожидаем согласия соперника на реванш.";
      }

      touchRoom(room);
      emitRoom(io, room);

      if (typeof callback === "function") callback({ ok: true });
    } catch (error) {
      emitError(socket, error.message);
      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("disconnect", () => {
    const session = socketPlayers.get(socket.id);
    if (!session) return;

    socketPlayers.delete(socket.id);

    const room = rooms.get(session.roomCode);
    if (!room) return;

    const player = findPlayer(room, session.playerId);
    if (!player || player.socketId !== socket.id) return;

    player.socketId = null;
    player.ready = false;

    if (room.status === "playing") {
      room.message = `${player.name} отключился. Ожидаем переподключения.`;
      scheduleRoomCleanup(room);
    } else if (room.status === "waiting") {
      scheduleRoomCleanup(room);
    }

    touchRoom(room);
    emitRoom(io, room);
  });
}

function attach(httpServer, options = {}) {
  if (!httpServer || typeof httpServer.on !== "function") {
    throw new TypeError("attach ожидает HTTP-сервер Node.js.");
  }

  const io = new Server(httpServer, {
    cors: options.cors || { origin: false },
    serveClient: true,
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1e6,
  });

  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const headers = socket.handshake.headers || {};

    /*
     * Здесь принимается только идентификатор сессии от backend.
     * Сам по себе playerId не является доказательством личности.
     * Подключи проверку Telegram initData на сервере приложения
     * и передавай проверенный ID через socket.data.playerId.
     */
    const playerId = String(auth.playerId || "").trim();
    const initData = String(
      auth.initData ||
      headers["x-telegram-init-data"] ||
      ""
    );

    if (!playerId || playerId.length > 128) {
      return next(new Error("Не удалось определить игрока."));
    }

    if (typeof options.verifyPlayer === "function") {
      Promise.resolve(
        options.verifyPlayer({ playerId, initData, socket })
      )
        .then((verified) => {
          if (!verified) {
            return next(new Error("Не удалось подтвердить Telegram-пользователя."));
          }

          socket.data.playerId = String(
            typeof verified === "string" ? verified : verified.id || playerId
          );

          next();
        })
        .catch(() => next(new Error("Ошибка проверки пользователя.")));

      return;
    }

    if (options.allowUnverifiedPlayers === true) {
      socket.data.playerId = playerId;
      return next();
    }

    return next(
      new Error(
        "Проверка игроков не настроена. Передай verifyPlayer в gameServer.attach()."
      )
    );
  });

  io.on("connection", (socket) => {
    registerHandlers(io, socket);
  });

  return io;
}

function getRoomStats() {
  let waiting = 0;
  let playing = 0;
  let finished = 0;

  for (const room of rooms.values()) {
    if (room.status === "waiting") waiting += 1;
    else if (room.status === "playing") playing += 1;
    else if (room.status === "finished") finished += 1;
  }

  return {
    rooms: rooms.size,
    waiting,
    playing,
    finished,
  };
}

function close() {
  for (const room of rooms.values()) {
    clearRoomTimers(room);
  }

  rooms.clear();
  socketPlayers.clear();
}

module.exports = {
  attach,
  close,
  getRoomStats,
};
