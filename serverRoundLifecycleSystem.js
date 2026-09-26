"use strict";

/**
 * Round lifecycle orchestration.
 *
 * Responsibilities:
 * - Start rounds and seed per-round state.
 * - Resolve end-of-round conditions and announcements.
 * - Maintain ghost physics and speed ramp progression.
 */

function createRoundLifecycleSystem(deps) {
  const {
    io,
    rooms,
    BOT_ID,
    birdSize,
    gameWidth,
    gameHeight,
    gravity,
    horizontalDrag,
    vineDepth,
    grassDepth,
    roundDurationMs,
    roundWinRule,
    roundWinnerBonusPoints,
    suddenDeathWinnerBonusPoints,
    getSpeedMultiplier,
    getRoundPhase,
    getRoundMutator,
    isSuddenDeath,
    pickRoundMutator,
    getAlivePlayers,
    getRoundWinner,
    getRoundWinReason,
    getPlayersInRoom,
    awardPoints,
    buildRoundHighlights,
    broadcastGameState,
    addBotToRoom,
    resetPlayersForRound,
    createInitialObstacles,
    emitArenaCallout,
    getGameState,
    recordHourlyStat,
    getLeaderboardData
  } = deps;

  let startGameLoopHook = function noop() {};
  let drainWaitingQueueHook = function noop() {};

  function setLoopHooks(hooks) {
    startGameLoopHook = hooks.startGameLoop;
    drainWaitingQueueHook = hooks.drainWaitingQueue;
  }

  function updateGhosts(room) {
    const speedMultiplier = getSpeedMultiplier(room);
    for (const player of Object.values(room.players)) {
      if (player.alive || player.id === BOT_ID) continue;
      player.ghostVY = (player.ghostVY || 0) + gravity * speedMultiplier * 0.75;
      player.ghostY = (player.ghostY || gameHeight / 2) + player.ghostVY * speedMultiplier;
      player.ghostX = (player.ghostX || gameWidth / 2) + (player.ghostVX || 0) * speedMultiplier;
      player.ghostVX = (player.ghostVX || 0) * horizontalDrag;
      player.ghostX = Math.max(0, Math.min(gameWidth - birdSize, player.ghostX));
      player.ghostY = Math.max(vineDepth, Math.min(gameHeight - birdSize - grassDepth, player.ghostY));
    }
  }

  function updateSpeedRamp(room) {
    const startTime = room.roundLiveStartTime || room.roundStartTime;
    if (!startTime || !room.baseGameSpeed) return;
    const elapsed = (Date.now() - startTime) / 1000;
    const rampFactor = Math.min(elapsed / 50, 1.0);
    const maxRamp = Math.min(room.baseGameSpeed, 15);
    room.gameSpeed = room.baseGameSpeed + maxRamp * rampFactor;
  }

  function startRoundForRoom(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.started) return;

    room.roomCode = roomCode;

    const playerCount = Object.keys(room.players).length;
    if (playerCount === 1) {
      addBotToRoom(roomCode);
    }

    resetPlayersForRound(room);
    room.roundStartTime = Date.now();
    room.roundCounter = (room.roundCounter || 0) + 1;
    room.currentMutatorId = pickRoundMutator(room);
    room.lastMutatorId = room.currentMutatorId;
    room.roundLiveStartTime = null;
    room.roundEndTime = room.roundStartTime + roundDurationMs;
    room.roundStats = {};
    room.baseGameSpeed = room.gameSpeed;
    room.obstacles = createInitialObstacles(room);
    room.obstaclesPassed = 0;
    room.pickups = [];
    room.goldenTarget = null;
    room.lastGoldenTargetSpawn = Date.now();
    room.lastPickupSpawn = 0;
    room.lastMonsterSpawn = Date.now();
    room.wind = { active: false, direction: 1, strength: 0, endAt: 0 };
    room.lastWindGustAt = Date.now();
    room.curse = null;
    room.lastCurseSpawn = Date.now();

    const mutator = getRoundMutator(room);
    if (room.currentMutatorId !== "standard") {
      emitArenaCallout(roomCode, "power", "ROUND TWIST: " + mutator.name.toUpperCase(), null);
    }

    io.to(roomCode).emit("gameStarting", getGameState(roomCode));

    setTimeout(() => {
      if (!rooms[roomCode] || rooms[roomCode].started) return;
      rooms[roomCode].started = true;
      rooms[roomCode].roundLiveStartTime = Date.now();
      io.to(roomCode).emit("gameStarted", getGameState(roomCode));
      startGameLoopHook(roomCode);
      drainWaitingQueueHook(roomCode);
    }, 4000);
  }

  function endRound(roomCode, winner) {
    const room = rooms[roomCode];
    if (!room) return;

    const resolvedWinner = winner || getRoundWinner(room);
    const winReason = getRoundWinReason(room, resolvedWinner);

    room.started = false;
    room.curse = null;

    if (room.gameLoop) {
      clearInterval(room.gameLoop);
      room.gameLoop = null;
    }

    if (resolvedWinner) {
      awardPoints(
        resolvedWinner,
        roundWinnerBonusPoints + (isSuddenDeath(room) ? suddenDeathWinnerBonusPoints : 0),
        room,
        roomCode
      );
      resolvedWinner.score++;
    }

    const matchWinner = resolvedWinner && resolvedWinner.score >= room.targetScore ? resolvedWinner : null;
    const roundHighlights = buildRoundHighlights(room);

    if (resolvedWinner && resolvedWinner.id !== BOT_ID) {
      recordHourlyStat(resolvedWinner.name, "roundWins");
    }
    if (matchWinner && matchWinner.id !== BOT_ID) {
      recordHourlyStat(matchWinner.name, "matchWins");
      io.emit("leaderboardUpdate", getLeaderboardData());
    }

    if (matchWinner && Object.keys(room.spectators || {}).length > 0) {
      io.to(roomCode).emit("spectatorsCanJoin", {
        spectatorCount: Object.keys(room.spectators).length
      });
    }

    broadcastGameState(roomCode);

    io.to(roomCode).emit("roundEnded", {
      roundWinner: resolvedWinner || null,
      winReason,
      roundWinRule,
      roundHighlights,
      matchWinner,
      targetScore: room.targetScore,
      players: getPlayersInRoom(roomCode),
      obstacles: room.obstacles,
      obstaclesPassed: room.obstaclesPassed
    });

    if (!matchWinner) {
      if (room.autoRestartTimer) clearTimeout(room.autoRestartTimer);
      room.autoRestartTimer = setTimeout(() => {
        room.autoRestartTimer = null;
        if (rooms[roomCode]) startRoundForRoom(roomCode);
      }, 8000);
      io.to(roomCode).emit("autoRestartCountdown", { seconds: 8 });
    }
  }

  function checkForRoundEnd(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.started) return;

    const alivePlayers = getAlivePlayers(room);
    const phase = getRoundPhase(room);
    const hasBot = Boolean(room.players[BOT_ID]);
    const humanPlayerCount = Object.keys(room.players).filter(id => id !== BOT_ID).length;
    const isSoloVsBotRound = hasBot && humanPlayerCount === 1;

    if (isSoloVsBotRound && alivePlayers.length <= 1) {
      if (!room.victoryTimer) {
        room.victoryTimer = setTimeout(() => {
          endRound(roomCode, getRoundWinner(room));
          room.victoryTimer = null;
        }, 350);
      }
      return;
    }

    if (alivePlayers.length <= 1) {
      if (!room.victoryTimer) {
        room.victoryTimer = setTimeout(() => {
          endRound(roomCode, getRoundWinner(room));
          room.victoryTimer = null;
        }, phase === "suddenDeath" ? 600 : 350);
      }
    }
  }

  return {
    setLoopHooks,
    updateGhosts,
    updateSpeedRamp,
    startRoundForRoom,
    endRound,
    checkForRoundEnd
  };
}

module.exports = {
  createRoundLifecycleSystem
};
