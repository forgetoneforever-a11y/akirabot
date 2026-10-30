"use strict";

/*
 * AKIRA! — Game manager
 * public/games.js
 *
 * Управляет меню мини-игр, режимами и запуском:
 * - Дурак против бота;
 * - Шахматы против бота;
 * - онлайн-режимом, если подключён игровой сервер.
 *
 * Управление игровыми кнопками находится только в этом файле,
 * чтобы не было двойных обработчиков из app.js.
 */

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const state = {
    selectedGame: "durak",
    mode: "bot",
    difficulty: "easy",
    durakMode: "throw-in",
    chessColor: "white",
    active: false,
    starting: false,
  };

  const GAME_CONFIG = {
    durak: {
      title: "🃏 Дурак",
      panel: "#durak-game-panel",
      status: "#durak-status",
    },
    chess: {
      title: "♟️ Шахматы",
      panel: "#chess-game-panel",
      status: "#chess-status",
    },
  };

  let toastTimer = null;

  function toast(message, type = "info") {
    let element = $("#akira-game-toast");

    if (!element) {
      element = document.createElement("div");
      element.id = "akira-game-toast";
      element.className = "akira-game-toast";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      document.body.appendChild(element);
    }

    element.textContent = message;
    element.dataset.type = type;
    element.classList.add("visible");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      element.classList.remove("visible");
    }, 2800);
  }

  function setStatus(message, gameId = state.selectedGame) {
    const config = GAME_CONFIG[gameId];
    const status = config ? $(config.status) : null;

    if (status) status.textContent = message;

    document.dispatchEvent(
      new CustomEvent("akira:game-status", {
        detail: {
          game: gameId,
          message,
        },
      })
    );
  }

  function getGamesSection() {
    return $('[data-tab="games"]') ||
      $("#games-tab") ||
      $("#games-section");
  }

  function getGameMenu() {
    return $("#games-menu") ||
      $("#game-menu-panel") ||
      $(".games-menu") ||
      $('[data-games-menu]');
  }

  function getGamePanel(gameId) {
    const config = GAME_CONFIG[gameId];
    return config ? $(config.panel) : null;
  }

  function showPanel(gameId) {
    const menu = getGameMenu();

    if (menu) {
      menu.hidden = true;
      menu.style.display = "none";
    }

    const gamesScreen = $("#tab-games");
    if (gamesScreen) gamesScreen.dataset.playing = "true";

    for (const id of Object.keys(GAME_CONFIG)) {
      const panel = getGamePanel(id);
      if (!panel) continue;

      const isCurrent = id === gameId;
      panel.hidden = !isCurrent;
      panel.classList.toggle("active", isCurrent);

      if (isCurrent) {
        panel.style.display = "";
      } else {
        panel.style.display = "none";
      }
    }

    state.selectedGame = gameId;
    state.active = true;

    const config = GAME_CONFIG[gameId];
    if (config) {
      setStatus(`Открыта игра: ${config.title}`, gameId);
    }
  }

  function showMenu() {
    state.active = false;
    state.starting = false;

    clearOnlinePolling();

    for (const id of Object.keys(GAME_CONFIG)) {
      const panel = getGamePanel(id);

      if (panel) {
        panel.hidden = true;
        panel.classList.remove("active");
        panel.style.display = "none";
      }
    }

    const menu = getGameMenu();

    if (menu) {
      menu.hidden = false;
      menu.style.display = "";
    }

    const gamesScreen = $("#tab-games");
    if (gamesScreen) delete gamesScreen.dataset.playing;

    const gamesSection = getGamesSection();

    if (gamesSection && gamesSection.hidden) {
      gamesSection.hidden = false;
    }
  }

  function readSettings() {
    const durakMode = $("#durak-mode");
    const difficulty = $("#game-difficulty");
    const chessColor = $("#chess-color");

    if (durakMode) {
      state.durakMode = durakMode.value || "throw-in";
    }

    if (difficulty) {
      state.difficulty = difficulty.value || "easy";
    }

    if (chessColor) {
      state.chessColor = chessColor.value || "white";
    }

    return {
      game: state.selectedGame,
      mode: state.mode,
      difficulty: state.difficulty,
      durakMode: state.durakMode,
      chessColor: state.chessColor,
    };
  }

  function selectGame(gameId) {
    if (!GAME_CONFIG[gameId]) {
      toast("Неизвестная игра.", "error");
      return;
    }

    state.selectedGame = gameId;

    $$("[data-open-game]").forEach((button) => {
      const selected = button.dataset.openGame === gameId;

      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    readSettings();

    const title = $("#selected-game-title");
    if (title) title.textContent = GAME_CONFIG[gameId].title;

    const durakOptions = $("#durak-options");
    if (durakOptions) {
      durakOptions.hidden = gameId !== "durak";
    }

    const chessOptions = $("#chess-options");
    if (chessOptions) {
      chessOptions.hidden = gameId !== "chess";
    }

    updateLobbySection();

    const startButton = $("#start-game-button");
    if (startButton) {
      startButton.textContent =
        state.mode === "online"
          ? "Найти матч"
          : "Начать игру";
    }

    return gameId;
  }

  function selectMode(mode) {
    if (mode !== "bot" && mode !== "online") return;

    state.mode = mode;

    $$("[data-game-mode]").forEach((button) => {
      const selected = button.dataset.gameMode === mode;

      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    const startButton = $("#start-game-button");

    if (startButton) {
      startButton.textContent =
        mode === "online"
          ? "Найти онлайн-матч"
          : "Начать игру";
    }

    const modeDescription = $("#game-mode-description");

    if (modeDescription) {
      modeDescription.textContent =
        mode === "online"
          ? "Играй с другим игроком. Для онлайн-матчей требуется подключённый игровой сервер."
          : "Играй против компьютерного соперника.";
    }

    readSettings();
    updateLobbySection();
  }

  function updateLobbySection() {
    const section = $("#chess-lobbies");
    const title = $("#lobby-section-title");
    const description = $("#lobby-section-description");
    const refresh = $("#chess-refresh-lobbies");
    const visible = state.mode === "online";
    if (!section) return;
    section.hidden = !visible;
    if (title) title.textContent = state.selectedGame === "chess"
      ? "♟ Активные шахматные лобби"
      : "🃏 Активные лобби «Дурака»";
    if (description) description.textContent = state.selectedGame === "chess"
      ? "Выбери комнату и присоединись к партии или создай свою."
      : "Найди открытую партию в «Дурака» или создай комнату для друга.";
    if (refresh) refresh.textContent = "↻ Обновить список";
    if (visible) loadGameLobbies();
  }

  function startGame() {
    if (state.starting) return;

    const settings = readSettings();

    if (settings.mode === "online") {
      startOnlineGame(settings);
      return;
    }

    startBotGame(settings);
  }

  function startBotGame(settings = readSettings()) {
    const gameId = settings.game || state.selectedGame;

    if (!GAME_CONFIG[gameId]) {
      toast("Сначала выбери игру.", "error");
      return;
    }

    state.selectedGame = gameId;
    state.mode = "bot";
    state.starting = true;

    try {
      stopCurrentGame(gameId);

      showPanel(gameId);

      let result;

      if (gameId === "durak") {
        if (typeof window.startDurakGame !== "function") {
          throw new Error("Не найден public/durak.js");
        }

        result = window.startDurakGame({
          mode: "bot",
          difficulty: settings.difficulty,
          durakMode: settings.durakMode,
        });
      } else if (gameId === "chess") {
        if (typeof window.startChessGame !== "function") {
          throw new Error("Не найден public/chess.js");
        }

        result = window.startChessGame({
          mode: "bot",
          difficulty: settings.difficulty,
          chessColor: settings.chessColor,
        });
      }

      if (result && result.message) {
        setStatus(result.message, gameId);
      }

      toast(`${GAME_CONFIG[gameId].title}: игра началась.`, "success");
    } catch (error) {
      state.active = false;
      showMenu();

      console.error("[AKIRA Games]", error);

      toast(
        error && error.message
          ? error.message
          : "Не удалось запустить игру.",
        "error"
      );
    } finally {
      state.starting = false;
    }
  }

  async function startOnlineGame(settings = readSettings()) {
    const gameId = settings.game || state.selectedGame;

    if (!GAME_CONFIG[gameId]) {
      toast("Сначала выбери игру.", "error");
      return;
    }

    if (typeof window.AKIRAOnlineGames?.start === "function") {
      state.starting = true;

      try {
        const result = await window.AKIRAOnlineGames.start({
          game: gameId,
          difficulty: settings.difficulty,
          durakMode: settings.durakMode,
          chessColor: settings.chessColor,
        });

        state.selectedGame = gameId;

        if (result?.success) {
          showPanel(gameId);
          setStatus(
            result.message || "Онлайн-матч найден.",
            gameId
          );
          toast("Онлайн-матч запущен.", "success");
        } else {
          toast(
            result?.message || "Не удалось найти онлайн-матч.",
            "error"
          );
        }
      } catch (error) {
        console.error("[AKIRA Online Games]", error);

        toast(
          error?.message || "Ошибка подключения к игровому серверу.",
          "error"
        );
      } finally {
        state.starting = false;
      }

      return;
    }

    if (typeof window.startOnlineGame === "function") {
      toast(
        "Обнаружен устаревший обработчик онлайн-игры. Проверь подключение игрового сервера.",
        "error"
      );
      return;
    }

    toast(
      "Онлайн-матчи пока не подключены к серверу. Выбери режим «Против бота».",
      "error"
    );
  }

  async function loadGameLobbies() {
    const list = $("#chess-lobby-list");
    if (!list) return;
    const gameId = state.selectedGame;
    list.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "lobby-empty";
    loading.textContent = "Ищем открытые комнаты…";
    list.appendChild(loading);
    try {
      const rooms = await window.AKIRAOnlineGames.listLobbies(gameId);
      if (state.selectedGame !== gameId) return;
      list.replaceChildren();
      if (!rooms.length) {
        const empty = document.createElement("div");
        empty.className = "lobby-empty";
        empty.innerHTML = '<span class="lobby-empty-icon">✦</span><strong>Пока тихо</strong><span>Открытых комнат нет. Нажми «Найти онлайн-матч», чтобы создать первую.</span>';
        list.appendChild(empty);
        return;
      }
      rooms.forEach((room, index) => {
        const item = document.createElement("article");
        item.className = "chess-lobby-item";
        const avatar = document.createElement("div");
        avatar.className = "lobby-player-avatar";
        avatar.textContent = (room.players?.[0]?.name || "И").trim().charAt(0).toUpperCase();
        const info = document.createElement("div");
        info.className = "lobby-player-info";
        const name = document.createElement("strong");
        name.textContent = room.players?.[0]?.name || "Игрок";
        const meta = document.createElement("span");
        meta.textContent = "Ожидает соперника";
        const code = document.createElement("small");
        code.textContent = "Комната · " + room.code;
        info.append(name, meta, code);
        const join = document.createElement("button");
        join.type = "button";
        join.className = "lobby-join-button";
        join.dataset.joinGameLobby = room.code;
        join.dataset.lobbyGame = gameId;
        join.textContent = "Войти";
        item.append(avatar, info, join);
        list.appendChild(item);
      });
    } catch (error) {
      list.replaceChildren();
      const failed = document.createElement("div");
      failed.className = "lobby-empty lobby-error";
      failed.textContent = error.message || "Не удалось загрузить комнаты.";
      list.appendChild(failed);
    }
  }

  async function joinGameLobby(code, gameId) {
    try {
      const result = await window.AKIRAOnlineGames.joinLobby(code, gameId);
      state.selectedGame = gameId;
      showPanel(gameId);
      setStatus(result.message || "Подключение к партии…", gameId);
    } catch (error) {
      toast(error.message || "Не удалось войти в лобби.", "error");
    }
  }

  function stopCurrentGame(nextGameId) {
    if (
      state.selectedGame === "durak" &&
      nextGameId !== "durak" &&
      typeof window.destroyDurakGame === "function"
    ) {
      window.destroyDurakGame();
    }

    if (
      state.selectedGame === "chess" &&
      nextGameId !== "chess" &&
      typeof window.destroyChessGame === "function"
    ) {
      window.destroyChessGame();
    }
  }

  function restartGame() {
    const settings = readSettings();

    if (settings.mode === "online") {
      startOnlineGame(settings);
    } else {
      startBotGame(settings);
    }
  }

  function clearOnlinePolling() {
    if (typeof window.AKIRAOnlineGames?.stopPolling === "function") {
      window.AKIRAOnlineGames.stopPolling();
    }
  }

  function handleGameOver(event) {
    const detail = event.detail || {};
    const gameId = detail.game || state.selectedGame;

    if (!GAME_CONFIG[gameId]) return;

    state.active = false;

    if (detail.message) {
      setStatus(detail.message, gameId);
      toast(detail.message, detail.winner === "player" ? "success" : "info");
    }
  }

  function handleGameStatus(event) {
    const detail = event.detail || {};

    if (!detail.game || !detail.message) return;

    const config = GAME_CONFIG[detail.game];
    const status = config ? $(config.status) : null;

    if (status && status.textContent !== detail.message) {
      status.textContent = detail.message;
    }
  }

  function bindControls() {
    /*
     * Игры. Используем делегирование, чтобы элементы,
     * появившиеся позднее, также работали.
     */
    document.addEventListener("click", (event) => {
      const exitButton = event.target.closest("#games-exit-button");
      if (exitButton) {
        event.preventDefault();
        // Return to the main AKIRA screen, not just the arcade menu.
        showMenu();
        if (typeof window.switchTab === "function") {
          window.switchTab("home");
        }
        return;
      }

      const gameButton = event.target.closest("[data-open-game]");

      if (gameButton) {
        event.preventDefault();
        selectGame(gameButton.dataset.openGame);
        return;
      }

      const modeButton = event.target.closest("[data-game-mode]");

      if (modeButton) {
        event.preventDefault();
        selectMode(modeButton.dataset.gameMode);
        return;
      }

      const backButton = event.target.closest("[data-back-games]");

      if (backButton) {
        event.preventDefault();
        showMenu();
        return;
      }

      const refreshLobbies = event.target.closest("#chess-refresh-lobbies");
      if (refreshLobbies) { event.preventDefault(); loadGameLobbies(); return; }

      const lobbyJoin = event.target.closest("[data-join-game-lobby]");
      if (lobbyJoin) { event.preventDefault(); joinGameLobby(lobbyJoin.dataset.joinGameLobby, lobbyJoin.dataset.lobbyGame || state.selectedGame); return; }

      const startButton = event.target.closest("#start-game-button");

      if (startButton) {
        event.preventDefault();
        startGame();
        return;
      }

      const restartButton = event.target.closest(
        "#chess-new-button, [data-restart-game]"
      );

      if (restartButton) {
        event.preventDefault();
        restartGame();
        return;
      }

      const undoButton = event.target.closest("#chess-undo-button");

      if (undoButton) {
        event.preventDefault();

        if (typeof window.undoChessMove === "function") {
          window.undoChessMove();
        } else if (typeof window.AKIRAChess?.undo === "function") {
          window.AKIRAChess.undo();
        } else {
          toast("Отмена хода пока недоступна.", "info");
        }
      }
    });

    document.addEventListener("change", (event) => {
      if (
        event.target.matches(
          "#durak-mode, #game-difficulty, #chess-color"
        )
      ) {
        readSettings();
      }
    });

    document.addEventListener("akira:game-over", handleGameOver);
    document.addEventListener("akira:game-status", handleGameStatus);

    const defaultGame = $("#start-game-button")?.dataset.defaultGame;

    if (defaultGame && GAME_CONFIG[defaultGame]) {
      selectGame(defaultGame);
    } else {
      selectGame(state.selectedGame);
    }

    selectMode(state.mode);
  }

  window.AKIRAGames = {
    selectGame,
    selectMode,
    startGame,
    startBotGame,
    startOnlineGame,
    showMenu,
    restartGame,
    readSettings,
    getState: () => ({ ...state }),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindControls, {
      once: true,
    });
  } else {
    bindControls();
  }
})();
