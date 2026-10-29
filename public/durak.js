"use strict";

/*
 * AKIRA! — Дурак
 * public/durak.js
 *
 * Поддерживает:
 * - подкидного и переводного дурака;
 * - игру против бота;
 * - колоду из 36 карт;
 * - козырь, отбивание, подкидывание, взятие карт;
 * - добор до шести карт;
 * - определение победителя;
 * - интерфейс, совместимый с games.js.
 *
 * Онлайн-матчи требуют серверной синхронизации и здесь не имитируются.
 */

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);

  const SUITS = [
    { id: "spades", symbol: "♠", name: "пики", red: false },
    { id: "clubs", symbol: "♣", name: "трефы", red: false },
    { id: "diamonds", symbol: "♦", name: "бубны", red: true },
    { id: "hearts", symbol: "♥", name: "червы", red: true },
  ];

  const RANKS = [
    { value: 6, label: "6" },
    { value: 7, label: "7" },
    { value: 8, label: "8" },
    { value: 9, label: "9" },
    { value: 10, label: "10" },
    { value: 11, label: "В" },
    { value: 12, label: "Д" },
    { value: 13, label: "К" },
    { value: 14, label: "Т" },
  ];

  const RANK_NAMES = {
    6: "шестёрка",
    7: "семёрка",
    8: "восьмёрка",
    9: "девятка",
    10: "десятка",
    11: "валет",
    12: "дама",
    13: "король",
    14: "туз",
  };

  const SUIT_NAMES = {
    spades: "пики",
    clubs: "трефы",
    diamonds: "бубны",
    hearts: "червы",
  };

  const game = {
    active: false,
    finished: false,
    mode: "bot",
    difficulty: "easy",
    rules: "throw-in",

    deck: [],
    trumpSuit: null,
    trumpCard: null,

    playerHand: [],
    botHand: [],

    table: [],
    discard: [],

    attacker: "player",
    defender: "bot",
    turn: "player",

    selectedCardId: null,
    message: "",
    botTimer: null,
    actionLocked: false,
  };

  let nextCardId = 1;

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
  }

  function createDeck() {
    const deck = [];

    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({
          id: nextCardId++,
          suit: suit.id,
          symbol: suit.symbol,
          red: suit.red,
          value: rank.value,
          rank: rank.label,
        });
      }
    }

    return shuffle(deck);
  }

  function cardName(card) {
    return `${RANK_NAMES[card.value] || card.rank} ${SUIT_NAMES[card.suit]}`;
  }

  function isTrump(card) {
    return Boolean(card && card.suit === game.trumpSuit);
  }

  function beats(attackCard, defenseCard) {
    if (!attackCard || !defenseCard) return false;

    if (
      attackCard.suit !== defenseCard.suit &&
      !isTrump(defenseCard)
    ) {
      return false;
    }

    if (
      attackCard.suit === defenseCard.suit &&
      defenseCard.value > attackCard.value
    ) {
      return true;
    }

    return isTrump(defenseCard) && !isTrump(attackCard);
  }

  function getPlayerHand() {
    return game.playerHand;
  }

  function getBotHand() {
    return game.botHand;
  }

  function getCurrentHand(side) {
    return side === "player" ? game.playerHand : game.botHand;
  }

  function getOpponentHandCount() {
    return game.turn === "player"
      ? game.botHand.length
      : game.botHand.length;
  }

  function createMessage(message) {
    game.message = message;
    renderStatus();
  }

  function setStatus(message) {
    game.message = message;
    renderStatus();

    document.dispatchEvent(
      new CustomEvent("akira:game-status", {
        detail: {
          game: "durak",
          message,
        },
      })
    );
  }

  function renderStatus() {
    const status = $("#durak-status");
    if (status) status.textContent = game.message;
  }

  function renderTrump() {
    const container = $("#durak-trump");
    if (!container) return;

    container.replaceChildren();

    const label = document.createElement("span");
    label.className = "durak-trump-label";
    label.textContent = "Козырь: ";

    const card = game.trumpCard;

    if (card) {
      const value = document.createElement("strong");
      value.className = card.red ? "red-suit" : "black-suit";
      value.textContent = `${card.rank}${card.symbol}`;

      const suit = document.createElement("span");
      suit.textContent = ` ${SUIT_NAMES[card.suit]}`;

      container.append(label, value, suit);
    } else {
      label.textContent = "Козырей больше нет";
      container.appendChild(label);
    }

    const deckCount = document.createElement("span");
    deckCount.className = "durak-deck-count";
    deckCount.textContent = `Колода: ${game.deck.length}`;

    container.appendChild(deckCount);
  }

  function createPlayingCard(card, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "playing-card";

    if (card.red) button.classList.add("red-suit");
    if (options.selected) button.classList.add("selected");
    if (options.disabled) button.disabled = true;

    button.setAttribute("aria-label", cardName(card));
    button.title = cardName(card);

    const rank = document.createElement("span");
    rank.className = "card-rank";
    rank.textContent = card.rank;

    const suit = document.createElement("span");
    suit.className = "card-suit";
    suit.textContent = card.symbol;

    button.append(rank, suit);

    if (options.onClick) {
      button.addEventListener("click", options.onClick);
    }

    return button;
  }

  function createCardBack() {
    const card = document.createElement("div");
    card.className = "playing-card card-back";
    card.setAttribute("aria-label", "Закрытая карта");
    card.textContent = "✦";
    return card;
  }

  function renderOpponentHand() {
    const container = $("#durak-opponent-hand");
    if (!container) return;

    container.replaceChildren();

    const count = game.botHand.length;
    const displayCount = Math.min(count, 12);

    for (let i = 0; i < displayCount; i += 1) {
      container.appendChild(createCardBack());
    }

    const label = document.createElement("span");
    label.className = "durak-hand-count";
    label.textContent = `Бот: ${count} карт`;

    container.appendChild(label);
  }

  function renderPlayerHand() {
    const container = $("#durak-player-hand");
    if (!container) return;

    container.replaceChildren();

    if (!game.playerHand.length) {
      const empty = document.createElement("span");
      empty.className = "section-description";
      empty.textContent = "Карт на руках нет";
      container.appendChild(empty);
      return;
    }

    const sorted = [...game.playerHand].sort((a, b) => {
      const aTrump = isTrump(a) ? 1 : 0;
      const bTrump = isTrump(b) ? 1 : 0;

      if (aTrump !== bTrump) return aTrump - bTrump;
      if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);

      return a.value - b.value;
    });

    for (const card of sorted) {
      const selected = game.selectedCardId === card.id;

      const button = createPlayingCard(card, {
        selected,
        disabled:
          !game.active ||
          game.finished ||
          game.turn !== "player" ||
          game.actionLocked,
        onClick: () => onPlayerCardClick(card.id),
      });

      container.appendChild(button);
    }
  }

  function renderTable() {
    const container = $("#durak-field");
    if (!container) return;

    container.replaceChildren();

    if (!game.table.length) {
      const empty = document.createElement("span");
      empty.className = "section-description";
      empty.textContent = game.active
        ? "Стол пуст — можно начать атаку"
        : "Здесь будут лежать карты";
      container.appendChild(empty);
      return;
    }

    for (const pair of game.table) {
      const pairElement = document.createElement("div");
      pairElement.className = "durak-card-pair";

      pairElement.appendChild(createPlayingCard(pair.attack, {
        disabled: true,
      }));

      if (pair.defense) {
        const defense = createPlayingCard(pair.defense, {
          disabled: true,
        });

        defense.classList.add("defense-card");
        pairElement.appendChild(defense);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "playing-card defense-placeholder";
        placeholder.textContent = "…";
        pairElement.appendChild(placeholder);
      }

      container.appendChild(pairElement);
    }
  }

  function renderControls() {
    const takeButton = $('[data-durak-action="take"]');
    const passButton = $('[data-durak-action="pass"]');

    const canAct =
      game.active &&
      !game.finished &&
      game.turn === "player" &&
      !game.actionLocked;

    if (takeButton) {
      takeButton.disabled = !canAct || game.defender !== "player";
      takeButton.textContent = "Взять карты";
    }

    if (passButton) {
      passButton.disabled = !canAct;
      passButton.textContent =
        game.attacker === "player" && game.defender === "bot"
          ? "Завершить ход"
          : "Бито";
    }
  }

  function render() {
    renderStatus();
    renderTrump();
    renderOpponentHand();
    renderPlayerHand();
    renderTable();
    renderControls();
  }

  function drawCard(side) {
    if (!game.deck.length) return null;

    const card = game.deck.pop();
    getCurrentHand(side).push(card);

    return card;
  }

  function refillHands() {
    const first = game.attacker;
    const second = game.defender;

    for (const side of [first, second]) {
      const hand = getCurrentHand(side);

      while (hand.length < 6 && game.deck.length) {
        drawCard(side);
      }
    }
  }

  function getLowestTrump(side) {
    return getCurrentHand(side)
      .filter(isTrump)
      .sort((a, b) => a.value - b.value)[0] || null;
  }

  function determineFirstTurn() {
    const playerTrump = getLowestTrump("player");
    const botTrump = getLowestTrump("bot");

    if (!playerTrump && !botTrump) {
      game.attacker = Math.random() < 0.5 ? "player" : "bot";
      game.defender = game.attacker === "player" ? "bot" : "player";
      return;
    }

    if (!botTrump) {
      game.attacker = "player";
    } else if (!playerTrump) {
      game.attacker = "bot";
    } else {
      game.attacker =
        playerTrump.value <= botTrump.value ? "player" : "bot";
    }

    game.defender = game.attacker === "player" ? "bot" : "player";
  }

  function startDurakGame(settings = {}) {
    clearTimeout(game.botTimer);

    game.active = true;
    game.finished = false;
    game.mode = settings.mode || "bot";
    game.difficulty = settings.difficulty || "easy";
    game.rules = settings.durakMode || settings.rules || "throw-in";

    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1] || null;
    game.trumpSuit = game.trumpCard?.suit || null;

    game.playerHand = [];
    game.botHand = [];
    game.table = [];
    game.discard = [];

    game.selectedCardId = null;
    game.actionLocked = false;

    for (let i = 0; i < 6; i += 1) {
      drawCard("player");
      drawCard("bot");
    }

    determineFirstTurn();
    game.turn = game.attacker;

    if (game.mode === "online") {
      game.active = false;
      game.finished = true;
      game.message =
        "Онлайн-матчи требуют подключения игрового сервера. Начни игру против бота.";
      render();

      document.dispatchEvent(
        new CustomEvent("akira:game-status", {
          detail: {
            game: "durak",
            message: game.message,
          },
        })
      );

      return { message: game.message };
    }

    game.message =
      game.turn === "player"
        ? "Твой ход. Выбери карту для атаки."
        : "Бот ходит первым…";

    render();

    if (game.turn === "bot") {
      scheduleBotTurn();
    }

    return { message: game.message };
  }

  function onPlayerCardClick(cardId) {
    if (
      !game.active ||
      game.finished ||
      game.turn !== "player" ||
      game.actionLocked
    ) {
      return;
    }

    const card = game.playerHand.find((item) => item.id === cardId);
    if (!card) return;

    if (game.defender === "player") {
      defendWithCard(card);
      return;
    }

    if (game.attacker === "player") {
      const existingPair = game.table.find((pair) => !pair.defense);

      if (existingPair) {
        setStatus("Сначала отбей атаку или возьми карты.");
        return;
      }

      if (game.table.length === 0) {
        attackWithCard(card);
        return;
      }

      if (canThrowIn(card)) {
        attackWithCard(card);
        return;
      }

      setStatus("Можно подкидывать только карты того же достоинства, что уже лежат на столе.");
      return;
    }

    setStatus("Сейчас не твой ход.");
  }

  function attackWithCard(card) {
    if (!game.playerHand.some((item) => item.id === card.id)) return;

    if (game.table.length >= Math.min(6, game.botHand.length)) {
      setStatus("Нельзя подкинуть больше карт, чем у защитника на руках.");
      return;
    }

    if (game.table.length > 0 && !canThrowIn(card)) {
      setStatus("Нельзя подкинуть эту карту.");
      return;
    }

    removeCard(game.playerHand, card.id);

    game.table.push({
      attack: card,
      defense: null,
    });

    game.selectedCardId = null;
    game.turn = "bot";

    setStatus("Ты сходил. Бот отвечает…");
    render();

    scheduleBotTurn();
  }

  function canThrowIn(card) {
    if (game.rules === "transfer" && game.table.length === 1) {
      const pair = game.table[0];

      if (
        !pair.defense &&
        pair.attack.value === card.value &&
        game.defender === "player"
      ) {
        return true;
      }
    }

    return game.table.some((pair) =>
      pair.attack.value === card.value ||
      pair.defense?.value === card.value
    );
  }

  function defendWithCard(card) {
    if (game.defender !== "player" || game.turn !== "player") return;

    const pair = game.table.find((item) => !item.defense);

    if (!pair) {
      setStatus("Сейчас нечего отбивать.");
      return;
    }

    if (!beats(pair.attack, card)) {
      setStatus("Эта карта не может побить атакующую карту.");
      return;
    }

    removeCard(game.playerHand, card.id);
    pair.defense = card;

    game.selectedCardId = null;

    if (game.table.some((item) => !item.defense)) {
      setStatus("Отбей оставшиеся карты.");
    } else {
      setStatus("Карта отбита. Можно продолжить или завершить ход.");
    }

    render();
  }

  function removeCard(hand, cardId) {
    const index = hand.findIndex((card) => card.id === cardId);

    if (index < 0) return null;

    return hand.splice(index, 1)[0];
  }

  function takeCards(side) {
    if (!game.active || game.finished) return;
    if (side !== game.turn) return;

    const defender = game.defender;

    if (side !== defender) {
      setStatus("Взять карты может только защищающийся.");
      return;
    }

    const defenderHand = getCurrentHand(defender);

    for (const pair of game.table) {
      defenderHand.push(pair.attack);

      if (pair.defense) {
        defenderHand.push(pair.defense);
      }
    }

    game.table = [];
    game.selectedCardId = null;

    const oldAttacker = game.attacker;
    const oldDefender = game.defender;

    game.attacker = oldAttacker;
    game.defender = oldDefender;
    game.turn = oldAttacker;

    refillHands();

    if (side === "player") {
      setStatus("Ты взял карты. Теперь твой ход.");
      render();
      scheduleBotTurn();
      return;
    }

    setStatus("Бот взял карты. Твой ход.");
    render();

    if (game.turn === "bot") {
      scheduleBotTurn();
    }
  }

  function finishRound() {
    if (!game.active || game.finished) return;

    const allDefended = game.table.length > 0 &&
      game.table.every((pair) => pair.defense);

    if (!allDefended) {
      setStatus("Сначала нужно отбить все карты или взять их.");
      return;
    }

    for (const pair of game.table) {
      game.discard.push(pair.attack, pair.defense);
    }

    game.table = [];

    const previousAttacker = game.attacker;
    const previousDefender = game.defender;

    game.attacker = previousDefender;
    game.defender = previousAttacker;
    game.turn = game.attacker;

    refillHands();

    if (checkGameOver()) return;

    setStatus(
      game.turn === "player"
        ? "Ты отбился! Теперь твоя атака."
        : "Бот отбился. Он атакует…"
    );

    render();

    if (game.turn === "bot") {
      scheduleBotTurn();
    }
  }

  function checkGameOver() {
    const playerOut = game.playerHand.length === 0 && game.deck.length === 0;
    const botOut = game.botHand.length === 0 && game.deck.length === 0;

    if (!playerOut && !botOut) return false;

    game.finished = true;
    game.active = false;

    let message;

    if (playerOut && botOut) {
      message = "Ничья! У обоих закончились карты.";
    } else if (playerOut) {
      message = "Победа! Ты избавился от всех карт.";
    } else {
      message = "Ты проиграл. Бот избавился от всех карт.";
    }

    game.message = message;
    render();

    document.dispatchEvent(
      new CustomEvent("akira:game-over", {
        detail: {
          game: "durak",
          winner: playerOut && !botOut
            ? "player"
            : botOut && !playerOut
              ? "bot"
              : null,
          message,
        },
      })
    );

    return true;
  }

  function playerTakeCards() {
    if (
      !game.active ||
      game.finished ||
      game.turn !== "player" ||
      game.defender !== "player"
    ) {
      return;
    }

    takeCards("player");
  }

  function playerPass() {
    if (!game.active || game.finished || game.turn !== "player") return;

    if (game.defender === "player") {
      const unblocked = game.table.some((pair) => !pair.defense);

      if (unblocked) {
        setStatus("Сначала отбей все карты или нажми «Взять карты».");
        return;
      }

      finishRound();
      return;
    }

    if (game.attacker === "player" && game.defender === "bot") {
      if (!game.table.length) {
        setStatus("Сначала положи карту на стол.");
        return;
      }

      const allDefended = game.table.every((pair) => pair.defense);

      if (!allDefended) {
        setStatus("Бот ещё не отбил все карты.");
        return;
      }

      finishRound();
    }
  }

  function getUnbeatenPair() {
    return game.table.find((pair) => !pair.defense) || null;
  }

  function chooseBotAttackCard() {
    const hand = game.botHand;

    if (!hand.length) return null;

    const nonTrumps = hand.filter((card) => !isTrump(card));
    const candidates = nonTrumps.length ? nonTrumps : hand;

    return [...candidates].sort((a, b) => a.value - b.value)[0];
  }

  function chooseBotDefenseCard(attackCard) {
    const possible = game.botHand
      .filter((card) => beats(attackCard, card))
      .sort((a, b) => {
        const aTrump = isTrump(a) ? 1 : 0;
        const bTrump = isTrump(b) ? 1 : 0;

        if (aTrump !== bTrump) return aTrump - bTrump;
        return a.value - b.value;
      });

    if (!possible.length) return null;

    if (game.difficulty === "hard") {
      const lowValue = possible[0];

      if (
        game.botHand.length > 2 &&
        game.deck.length > 0 &&
        lowValue.value >= 13
      ) {
        return null;
      }
    }

    return possible[0];
  }

  function botAttack() {
    if (!game.active || game.finished || game.turn !== "bot") return;

    if (game.defender === "bot") {
      const card = chooseBotAttackCard();

      if (!card) {
        finishRound();
        return;
      }

      if (game.table.length > 0 && !canThrowIn(card)) {
        finishRound();
        return;
      }

      removeCard(game.botHand, card.id);
      game.table.push({ attack: card, defense: null });

      setStatus("Бот атакует. Твой ход — отбивайся или бери карты.");
      game.turn = "player";
      render();
      return;
    }

    setStatus("Бот атакует…");
  }

  function botDefense() {
    if (!game.active || game.finished || game.turn !== "bot") return;

    const pair = getUnbeatenPair();

    if (!pair) {
      if (game.table.length && game.table.every((item) => item.defense)) {
        finishRound();
        return;
      }

      if (game.attacker === "bot") {
        botAttack();
      }

      return;
    }

    const card = chooseBotDefenseCard(pair.attack);

    if (!card) {
      setStatus("Бот берёт карты. Твой ход…");
      takeCards("bot");
      render();

      if (game.turn === "bot") {
        scheduleBotTurn();
      }

      return;
    }

    removeCard(game.botHand, card.id);
    pair.defense = card;

    const canThrowMore = game.table.length < Math.min(6, game.playerHand.length) &&
      game.botHand.some((candidate) => canThrowIn(candidate));

    if (canThrowMore) {
      const extra = game.botHand
        .filter((candidate) => canThrowIn(candidate))
        .sort((a, b) => a.value - b.value)[0];

      if (extra && Math.random() < 0.3) {
        removeCard(game.botHand, extra.id);
        game.table.push({ attack: extra, defense: null });
        setStatus("Бот отбился и подкинул ещё карту. Твой ход!");
        game.turn = "player";
        render();
        return;
      }
    }

    setStatus("Бот отбился. Теперь твоя атака.");
    render();

    finishRound();
  }

  function botTakeOrDefend() {
    if (!game.active || game.finished || game.turn !== "bot") return;

    if (game.defender === "bot") {
      botDefense();
    } else {
      botAttack();
    }
  }

  function scheduleBotTurn() {
    clearTimeout(game.botTimer);

    if (!game.active || game.finished || game.mode !== "bot") return;

    game.actionLocked = true;
    renderControls();

    game.botTimer = setTimeout(() => {
      game.actionLocked = false;

      if (!game.active || game.finished) return;

      if (game.turn === "bot") {
        botTakeOrDefend();
      }

      render();
    }, game.difficulty === "hard" ? 550 : 750);
  }

  function bindControls() {
    const takeButton = $('[data-durak-action="take"]');
    const passButton = $('[data-durak-action="pass"]');

    if (takeButton) {
      takeButton.addEventListener("click", playerTakeCards);
    }

    if (passButton) {
      passButton.addEventListener("click", playerPass);
    }
  }

  function destroyDurakGame() {
    clearTimeout(game.botTimer);

    game.active = false;
    game.finished = true;
    game.actionLocked = false;
  }

  window.startDurakGame = startDurakGame;
  window.destroyDurakGame = destroyDurakGame;

  window.AKIRADurak = {
    start: startDurakGame,
    takeCards: playerTakeCards,
    pass: playerPass,
    render,
    getState: () => ({
      active: game.active,
      finished: game.finished,
      mode: game.mode,
      rules: game.rules,
      deckCount: game.deck.length,
      playerHand: game.playerHand.map((card) => ({ ...card })),
      botHandCount: game.botHand.length,
      trumpSuit: game.trumpSuit,
      table: game.table.map((pair) => ({
        attack: { ...pair.attack },
        defense: pair.defense ? { ...pair.defense } : null,
      })),
      attacker: game.attacker,
      defender: game.defender,
      turn: game.turn,
      message: game.message,
    }),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindControls, { once: true });
  } else {
    bindControls();
  }
})();
