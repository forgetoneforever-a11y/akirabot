"use strict";

/*
 * AKIRA! — Шахматы
 * public/chess.js
 *
 * Возможности:
 * - шахматная доска 8×8;
 * - игра против бота;
 * - выбор цвета фигур;
 * - уровни сложности;
 * - подсветка доступных ходов;
 * - шах, мат и пат;
 * - рокировка, взятие на проходе и превращение пешки;
 * - отмена хода;
 * - перезапуск партии.
 *
 * Использует chess.js 0.10.3, подключённый в index.html.
 */

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);

  const FILES = "abcdefgh";
  const PIECES = {
    w: {
      k: "♔",
      q: "♕",
      r: "♖",
      b: "♗",
      n: "♘",
      p: "♙",
    },
    b: {
      k: "♚",
      q: "♛",
      r: "♜",
      b: "♝",
      n: "♞",
      p: "♟",
    },
  };

  const PIECE_NAMES = {
    k: "король",
    q: "ферзь",
    r: "ладья",
    b: "слон",
    n: "конь",
    p: "пешка",
  };

  const state = {
    game: null,
    mode: "bot",
    difficulty: "easy",
    playerColor: "w",
    selectedSquare: null,
    legalTargets: [],
    lastMove: null,
    thinking: false,
    active: false,
    finished: false,
    history: [],
    botTimer: null,
    moveCount: 0,
  };

  function createChessInstance() {
    if (typeof window.Chess !== "function") {
      throw new Error(
        "Не найдена библиотека chess.js. Проверь подключение chess.js в index.html."
      );
    }

    return new window.Chess();
  }

  function colorName(color) {
    return color === "w" ? "белые" : "чёрные";
  }

  function playerColorName() {
    return state.playerColor === "w" ? "белыми" : "чёрными";
  }

  function oppositeColor(color) {
    return color === "w" ? "b" : "w";
  }

  function pieceName(piece) {
    if (!piece) return "пустая клетка";

    const color = piece.color === "w" ? "белый" : "чёрный";
    return `${color} ${PIECE_NAMES[piece.type] || "фигура"}`;
  }

  function setStatus(message) {
    const status = $("#chess-status");

    if (status) {
      status.textContent = message;
    }

    document.dispatchEvent(
      new CustomEvent("akira:game-status", {
        detail: {
          game: "chess",
          message,
        },
      })
    );
  }

  function setControlsEnabled(enabled) {
    const board = $("#chess-board");

    if (board) {
      board.classList.toggle("thinking", !enabled);
    }

    const undoButton = $("#chess-undo-button");
    if (undoButton) {
      undoButton.disabled = !state.active || state.history.length === 0;
    }

    const newButton = $("#chess-new-button");
    if (newButton) {
      newButton.disabled = false;
    }
  }

  function clearSelection() {
    state.selectedSquare = null;
    state.legalTargets = [];
  }

  function getSquareName(row, col) {
    return `${FILES[col]}${8 - row}`;
  }

  function getCoordinates(square) {
    return {
      row: 8 - Number(square[1]),
      col: FILES.indexOf(square[0]),
    };
  }

  function getLegalMoves(square) {
    if (!state.game) return [];

    try {
      return state.game.moves({
        square,
        verbose: true,
      });
    } catch (error) {
      console.warn("[AKIRA Chess] Не удалось получить ходы:", error);
      return [];
    }
  }

  function isTargetSquare(square) {
    return state.legalTargets.some((move) => move.to === square);
  }

  function isLastMoveSquare(square) {
    return Boolean(
      state.lastMove &&
      (state.lastMove.from === square || state.lastMove.to === square)
    );
  }

  function getBoardElement() {
    return $("#chess-board");
  }

  function renderBoard() {
    const board = getBoardElement();

    if (!board || !state.game) return;

    board.replaceChildren();
    board.classList.add("chess-board");

    const boardRows = state.game.board();
    const flipped = state.playerColor === "b";

    for (let visualRow = 0; visualRow < 8; visualRow += 1) {
      for (let visualCol = 0; visualCol < 8; visualCol += 1) {
        const row = flipped ? 7 - visualRow : visualRow;
        const col = flipped ? 7 - visualCol : visualCol;

        const squareName = getSquareName(row, col);
        const piece = boardRows[row][col];

        const square = document.createElement("button");
        square.type = "button";
        square.className = "chess-square";
        square.dataset.square = squareName;

        const isLight = (row + col) % 2 === 0;

        square.classList.add(isLight ? "light-square" : "dark-square");

        if (state.selectedSquare === squareName) {
          square.classList.add("selected");
        }

        if (isTargetSquare(squareName)) {
          square.classList.add("legal-target");

          if (piece) {
            square.classList.add("capture-target");
          }
        }

        if (isLastMoveSquare(squareName)) {
          square.classList.add("last-move");
        }

        if (piece) {
          const pieceElement = document.createElement("span");

          pieceElement.className =
            `chess-piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;

          pieceElement.textContent = PIECES[piece.color][piece.type];
          pieceElement.setAttribute("aria-hidden", "true");

          square.appendChild(pieceElement);

          square.setAttribute(
            "aria-label",
            `${squareName}: ${pieceName(piece)}`
          );
        } else {
          square.setAttribute("aria-label", squareName);
        }

        if (row === (flipped ? 7 : 0)) {
          const fileLabel = document.createElement("span");
          fileLabel.className = "chess-file-label";
          fileLabel.textContent = FILES[col];
          square.appendChild(fileLabel);
        }

        if (col === (flipped ? 7 : 0)) {
          const rankLabel = document.createElement("span");
          rankLabel.className = "chess-rank-label";
          rankLabel.textContent = String(8 - row);
          square.appendChild(rankLabel);
        }

        square.addEventListener("click", () => {
          onSquareClick(squareName);
        });

        board.appendChild(square);
      }
    }

    renderMoveHistory();
    setControlsEnabled(!state.thinking && state.active && !state.finished);
  }

  function renderMoveHistory() {
    let historyElement = $("#chess-move-history");

    if (!historyElement) {
      const board = getBoardElement();
      const panel = $("#chess-game-panel");

      if (!board || !panel) return;

      historyElement = document.createElement("div");
      historyElement.id = "chess-move-history";
      historyElement.className = "chess-move-history";
      historyElement.setAttribute("aria-label", "История ходов");

      const existing = $(".chess-move-history", panel);
      if (existing) {
        historyElement = existing;
      } else {
        board.insertAdjacentElement("afterend", historyElement);
      }
    }

    historyElement.replaceChildren();

    const title = document.createElement("strong");
    title.className = "chess-history-title";
    title.textContent = "История ходов";

    historyElement.appendChild(title);

    const moves = state.game.history();

    if (!moves.length) {
      const empty = document.createElement("span");
      empty.className = "chess-history-empty";
      empty.textContent = "Ходов пока нет";
      historyElement.appendChild(empty);
      return;
    }

    for (let i = 0; i < moves.length; i += 2) {
      const row = document.createElement("div");
      row.className = "chess-history-row";

      const number = document.createElement("span");
      number.className = "chess-history-number";
      number.textContent = `${Math.floor(i / 2) + 1}.`;

      const whiteMove = document.createElement("span");
      whiteMove.className = "chess-history-white";
      whiteMove.textContent = moves[i];

      const blackMove = document.createElement("span");
      blackMove.className = "chess-history-black";
      blackMove.textContent = moves[i + 1] || "…";

      row.append(number, whiteMove, blackMove);
      historyElement.appendChild(row);
    }

    historyElement.scrollTop = historyElement.scrollHeight;
  }

  function describePosition() {
    if (!state.game) return "";

    if (state.game.isCheckmate()) {
      const winner = oppositeColor(state.game.turn());

      return winner === state.playerColor
        ? "Мат! Ты победил."
        : "Мат! Бот победил.";
    }

    if (state.game.isDraw()) {
      return "Ничья.";
    }

    if (typeof state.game.isStalemate === "function" && state.game.isStalemate()) {
      return "Пат! Ничья.";
    }

    if (typeof state.game.isThreefoldRepetition === "function" &&
        state.game.isThreefoldRepetition()) {
      return "Ничья: позиция повторилась трижды.";
    }

    if (typeof state.game.isInsufficientMaterial === "function" &&
        state.game.isInsufficientMaterial()) {
      return "Ничья: недостаточно материала для мата.";
    }

    if (state.game.isCheck()) {
      return `Шах! Ход ${colorName(state.game.turn())}.`;
    }

    return `Ход ${colorName(state.game.turn())}.`;
  }

  function checkGameOver() {
    if (!state.game || !state.game.game_over()) {
      return false;
    }

    state.active = false;
    state.finished = true;
    state.thinking = false;

    clearTimeout(state.botTimer);

    const message = describePosition();

    setStatus(message);
    renderBoard();
    setControlsEnabled(false);

    let winner = null;

    if (state.game.isCheckmate()) {
      winner = oppositeColor(state.game.turn()) === state.playerColor
        ? "player"
        : "bot";
    }

    document.dispatchEvent(
      new CustomEvent("akira:game-over", {
        detail: {
          game: "chess",
          winner,
          message,
        },
      })
    );

    return true;
  }

  function onSquareClick(squareName) {
    if (
      !state.game ||
      !state.active ||
      state.finished ||
      state.thinking
    ) {
      return;
    }

    if (state.mode !== "online" && state.mode !== "bot") return;
    if (state.game.turn() !== state.playerColor) return;

    const clickedPiece = state.game.get(squareName);

    if (state.selectedSquare && isTargetSquare(squareName)) {
      makePlayerMove(state.selectedSquare, squareName);
      return;
    }

    if (
      clickedPiece &&
      clickedPiece.color === state.game.turn() &&
      (state.mode !== "bot" || clickedPiece.color === state.playerColor)
    ) {
      state.selectedSquare = squareName;
      state.legalTargets = getLegalMoves(squareName);

      renderBoard();

      if (!state.legalTargets.length) {
        setStatus(`У фигуры ${squareName} нет доступных ходов.`);
      } else {
        setStatus(
          `${pieceName(clickedPiece)} на ${squareName}: выбери клетку для хода.`
        );
      }

      return;
    }

    clearSelection();
    renderBoard();
  }

  function makePlayerMove(from, to) {
    if (!state.game) return;

    const movingPiece = state.game.get(from);

    if (!movingPiece) {
      clearSelection();
      renderBoard();
      return;
    }

    const moveOptions = {
      from,
      to,
    };

    if (
      movingPiece.type === "p" &&
      (to.endsWith("8") || to.endsWith("1"))
    ) {
      const promotion = window.prompt(
        "Во что превратить пешку? Введи: q — ферзь, r — ладья, b — слон, n — конь.",
        "q"
      );

      const validPromotion = ["q", "r", "b", "n"];

      moveOptions.promotion = validPromotion.includes(
        String(promotion || "q").toLowerCase()
      )
        ? String(promotion || "q").toLowerCase()
        : "q";
    }

    let move;

    try {
      move = state.game.move(moveOptions);
    } catch (error) {
      move = null;
    }

    if (!move) {
      setStatus("Недопустимый ход.");
      clearSelection();
      renderBoard();
      return;
    }

    state.history.push(move);
    state.lastMove = {
      from: move.from,
      to: move.to,
    };

    state.moveCount += 1;

    if (state.mode === "online" && window.AKIRAOnlineGames?.action) {
      window.AKIRAOnlineGames.action("move", {
        move: { from: move.from, to: move.to, promotion: move.promotion || "q" }
      }).catch((error) => {
        // Restore the last authoritative server position if the move was rejected.
        const onlineState = window.AKIRAOnlineGames?.getState?.();
        if (onlineState?.snapshot) applyOnlineChessState(onlineState.snapshot);
        setStatus(error.message || "Ход не принят сервером.");
      });
    }

    clearSelection();
    renderBoard();

    if (checkGameOver()) return;

    setStatus(describePosition());

    if (state.mode === "bot") {
      scheduleBotMove();
    }
  }

  function evaluateMaterial() {
    const values = {
      p: 100,
      n: 320,
      b: 330,
      r: 500,
      q: 900,
      k: 20000,
    };

    let score = 0;
    const board = state.game.board();

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = board[row][col];

        if (!piece) continue;

        const value = values[piece.type] || 0;
        score += piece.color === state.playerColor ? value : -value;
      }
    }

    return score;
  }

  function scoreMove(move) {
    let score = Math.random() * 2;

    if (move.captured) {
      const capturedValues = {
        p: 100,
        n: 320,
        b: 330,
        r: 500,
        q: 900,
        k: 20000,
      };

      score += (capturedValues[move.captured] || 0) * 0.8;
    }

    if (move.promotion) {
      score += 800;
    }

    if (move.san && move.san.includes("#")) {
      score += 100000;
    } else if (move.san && move.san.includes("+")) {
      score += 40;
    }

    return score;
  }

  function chooseBotMove() {
    const legalMoves = state.game.moves({ verbose: true });

    if (!legalMoves.length) return null;

    if (state.difficulty === "easy") {
      return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    const scoredMoves = legalMoves.map((move) => {
      const score = scoreMove(move);

      return {
        move,
        score,
      };
    });

    scoredMoves.sort((a, b) => b.score - a.score);

    if (state.difficulty === "medium") {
      const candidates = scoredMoves.slice(
        0,
        Math.min(5, scoredMoves.length)
      );

      return candidates[Math.floor(Math.random() * candidates.length)].move;
    }

    let bestMove = scoredMoves[0].move;
    let bestScore = -Infinity;

    for (const candidate of scoredMoves.slice(0, 12)) {
      const before = state.game.fen();

      state.game.move(candidate.move);

      let score = -evaluateMaterial();

      if (state.game.isCheckmate()) {
        score += 100000;
      }

      state.game.load(before);

      if (score > bestScore) {
        bestScore = score;
        bestMove = candidate.move;
      }
    }

    return bestMove;
  }

  function scheduleBotMove() {
    clearTimeout(state.botTimer);

    if (
      !state.active ||
      state.finished ||
      state.mode !== "bot" ||
      state.game.turn() === state.playerColor
    ) {
      return;
    }

    state.thinking = true;

    setStatus("Бот думает…");
    setControlsEnabled(false);

    state.botTimer = setTimeout(() => {
      if (!state.active || state.finished || !state.game) {
        state.thinking = false;
        return;
      }

      let move;
      let result = null;

      try {
        move = chooseBotMove();
        if (move) {
          result = state.game.move({
            from: move.from,
            to: move.to,
            promotion: move.promotion || "q",
          });
        }

        // Надёжный запасной вариант: если оценка позиции не смогла выбрать ход,
        // выполняем случайный легальный ход из списка chess.js.
        if (!result && state.game && !state.game.game_over()) {
          const fallbackMoves = state.game.moves({ verbose: true });
          if (fallbackMoves.length) {
            const fallback = fallbackMoves[Math.floor(Math.random() * fallbackMoves.length)];
            result = state.game.move({
              from: fallback.from,
              to: fallback.to,
              promotion: fallback.promotion || "q",
            });
          }
        }
      } catch (error) {
        console.error("[AKIRA Chess] Ошибка хода бота:", error);
        try {
          const fallbackMoves = state.game && state.game.moves({ verbose: true });
          if (fallbackMoves && fallbackMoves.length) {
            const fallback = fallbackMoves[Math.floor(Math.random() * fallbackMoves.length)];
            result = state.game.move({ from: fallback.from, to: fallback.to, promotion: fallback.promotion || "q" });
          }
        } catch (fallbackError) {
          console.error("[AKIRA Chess] Запасной ход тоже не удался:", fallbackError);
        }
      }

      state.thinking = false;

      if (!result) {
        if (state.game && state.game.game_over()) {
          checkGameOver();
        } else {
          setStatus("Не удалось выполнить ход бота. Нажми «Новая партия».");
          renderBoard();
          setControlsEnabled(true);
        }
        return;
      }

      state.history.push(result);
      state.lastMove = {
        from: result.from,
        to: result.to,
      };

      state.moveCount += 1;

      renderBoard();

      if (checkGameOver()) return;

      setStatus(`Бот походил: ${result.san}. ${describePosition()}`);
      setControlsEnabled(true);
    }, state.difficulty === "hard" ? 650 : 450);
  }

  function startChessGame(settings = {}) {
    clearTimeout(state.botTimer);

    state.game = createChessInstance();

    state.mode = settings.mode || "bot";
    state.difficulty = settings.difficulty || "easy";

    state.playerColor =
      settings.chessColor === "black" ||
      settings.chessColor === "b"
        ? "b"
        : "w";

    state.selectedSquare = null;
    state.legalTargets = [];
    state.lastMove = null;
    state.thinking = false;
    state.finished = false;
    state.history = [];
    state.moveCount = 0;

    if (state.mode === "online") {
      state.active = false;
      state.finished = true;

      setStatus(
        "Онлайн-шахматы пока не подключены к серверу. Выбери игру против бота."
      );

      renderBoard();

      return {
        success: false,
        message: "Онлайн-шахматы не подключены к серверу.",
      };
    }

    state.active = true;

    renderBoard();

    setStatus(
      `Партия началась. Ты играешь ${playerColorName()}. ${
        state.playerColor === "w" ? "Твой ход." : "Бот ходит первым…"
      }`
    );

    if (state.playerColor === "b") {
      scheduleBotMove();
    }

    return {
      success: true,
      message: "Партия началась.",
    };
  }

  function undoChessMove() {
    if (!state.game || !state.history.length) {
      setStatus("Нет ходов для отмены.");
      return false;
    }

    clearTimeout(state.botTimer);

    if (state.mode === "bot" && state.history.length >= 2) {
      state.game.undo();
      state.game.undo();
      state.history.splice(-2, 2);
    } else {
      state.game.undo();
      state.history.pop();
    }

    state.active = true;
    state.finished = false;
    state.thinking = false;
    state.lastMove = null;
    clearSelection();

    const verboseHistory = state.game.history({ verbose: true });

    if (verboseHistory.length) {
      const last = verboseHistory[verboseHistory.length - 1];

      state.lastMove = {
        from: last.from,
        to: last.to,
      };
    }

    renderBoard();
    setStatus(`Ход отменён. ${describePosition()}`);

    return true;
  }

  function destroyChessGame() {
    clearTimeout(state.botTimer);

    state.active = false;
    state.finished = true;
    state.thinking = false;

    clearSelection();
  }

  function bindControls() {
    const board = getBoardElement();

    if (board) {
      board.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        clearSelection();
        renderBoard();
      });
    }

    // Undo/restart controls are handled centrally by games.js to avoid
    // duplicate click listeners and applying an action twice.
  }

  window.startChessGame = startChessGame;
  window.undoChessMove = undoChessMove;
  window.destroyChessGame = destroyChessGame;

  function applyOnlineChessState(snapshot) {
    if (!snapshot?.chess) return;

    // Replay the authoritative SAN history so the local board, move list,
    // undo-independent history and terminal-state checks stay in sync.
    const history = Array.isArray(snapshot.chess.history) ? snapshot.chess.history : [];
    let synced = createChessInstance();
    let replayOk = true;
    for (const san of history) {
      try {
        if (!synced.move(san)) {
          replayOk = false;
          break;
        }
      } catch (error) {
        replayOk = false;
        break;
      }
    }

    if (!replayOk) {
      synced = createChessInstance();
      const fen = snapshot.chess.fen;
      if (fen && fen !== "start") {
        try {
          synced.load(fen);
        } catch (error) {
          console.warn("[AKIRA Chess] FEN sync failed", error);
        }
      }
    }
    state.game = synced;
    state.mode = "online";
    state.active = snapshot.status === "playing";
    state.finished = snapshot.status === "finished";
    state.thinking = false;
    state.playerColor = snapshot.chess?.color === "b" ? "b" : "w";
    state.history = state.game.history({ verbose: true });
    const last = state.history[state.history.length - 1];
    state.lastMove = last ? { from: last.from, to: last.to } : null;
    clearSelection();
    renderBoard();
    setStatus(snapshot.message || (state.game.turn() === state.playerColor ? "Твой ход." : "Ход соперника."));
  }

  window.AKIRAChess = {
    applyOnlineState: applyOnlineChessState,
    start: startChessGame,
    undo: undoChessMove,
    destroy: destroyChessGame,
    render: renderBoard,
    getState: () => ({
      mode: state.mode,
      difficulty: state.difficulty,
      playerColor: state.playerColor,
      active: state.active,
      finished: state.finished,
      thinking: state.thinking,
      fen: state.game ? state.game.fen() : null,
      history: state.game ? state.game.history() : [],
      turn: state.game ? state.game.turn() : null,
      status: state.game ? describePosition() : "",
    }),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindControls, {
      once: true,
    });
  } else {
    bindControls();
  }
})();
