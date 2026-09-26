"use strict";

/**
 * Socket.IO handler registration.
 *
 * Responsibilities:
 * - Register all socket event endpoints.
 * - Coordinate room lifecycle commands and input forwarding.
 * - Handle disconnect cleanup and queue/name teardown.
 */

function registerSocketHandlers(io, deps) {
  const {
    rooms,
    BOT_ID,
    MAX_PLAYERS,
    playerColours,
    playerMaxHealth,
    birdSize,
    gameWidth,
    gameHeight,
    GHOST_SPOOK_RADIUS,
    GHOST_SPOOK_FORCE,
    GHOST_SPOOK_COOLDOWN,
    flapStrength,
    sideFlapStrength,
    horizontalPush,
    clampGameSpeed,
    clampTargetScore,
    createPlayerState,
    validateAndRegisterName,
    addPlayerToRoom,
    drainWaitingQueueToLobby,
    startRoundForRoom,
    getGameState,
    getLeaderboardData,
    queueWaitingPlayer,
    dequeueWaitingPlayer,
    releaseSocketName,
    applyInput,
    getKnockbackMultiplier,
    keepPlayerInsideArena,
    broadcastGameState,
    checkForRoundEnd
  } = deps;

  io.on("connection", (socket) => {
    socket.on("createGame", ({ playerName, roomCode, gameSpeed, targetScore }) => {
      const nameCheck = validateAndRegisterName(socket, playerName);
      if (nameCheck.error) {
        socket.emit("joinError", nameCheck.error);
        return;
      }

      rooms[roomCode] = {
        roomCode,
        hostId: socket.id,
        players: {},
        spectators: {},
        started: false,
        obstacles: [],
        obstaclesPassed: 0,
        gameLoop: null,
        gameSpeed: clampGameSpeed(gameSpeed),
        targetScore: clampTargetScore(targetScore),
        pickups: [],
        goldenTarget: null,
        lastGoldenTargetSpawn: 0,
        lastPickupSpawn: 0,
        lastMonsterSpawn: 0,
        curse: null,
        lastCurseSpawn: 0,
        autoRestartTimer: null,
        baseGameSpeed: null,
        roundStartTime: null,
        roundCounter: 0,
        currentMutatorId: "standard",
        lastMutatorId: null,
        wind: { active: false, direction: 1, strength: 0, endAt: 0 },
        lastWindGustAt: 0
      };

      addPlayerToRoom(socket, roomCode, nameCheck.name);
      drainWaitingQueueToLobby(roomCode);

      io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
    });

    socket.on("joinGame", ({ playerName, roomCode }) => {
      const room = rooms[roomCode];

      if (!room) {
        socket.emit("joinError", "Game code not found.");
        return;
      }

      const nameCheck = validateAndRegisterName(socket, playerName);
      if (nameCheck.error) {
        socket.emit("joinError", nameCheck.error);
        return;
      }

      if (room.started) {
        room.spectators[socket.id] = { id: socket.id, name: nameCheck.name };
        socket.join(roomCode);
        socket.emit("joinedAsSpectator", getGameState(roomCode));
        return;
      }

      addPlayerToRoom(socket, roomCode, nameCheck.name);
      io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
    });

    socket.on("requestStartGame", ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return;

      if (socket.id !== room.hostId) {
        socket.emit("joinError", "Only the game creator can start the round.");
        return;
      }

      if (room.started) return;

      if (room.autoRestartTimer) {
        clearTimeout(room.autoRestartTimer);
        room.autoRestartTimer = null;
      }

      startRoundForRoom(roomCode);
    });

    socket.on("requestRematch", ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) return;
      if (socket.id !== room.hostId) return;
      if (room.started) return;

      if (room.autoRestartTimer) {
        clearTimeout(room.autoRestartTimer);
        room.autoRestartTimer = null;
      }

      for (const specId in room.spectators) {
        const spec = room.spectators[specId];
        const playerCount = Object.keys(room.players).length;
        room.players[specId] = createPlayerState(
          specId,
          spec.name,
          playerColours[playerCount % playerColours.length],
          70 + playerCount * 55,
          220
        );
      }
      room.spectators = {};

      for (const player of Object.values(room.players)) {
        player.score = 0;
        player.points = 0;
        player.health = playerMaxHealth;
        player.maxHealth = playerMaxHealth;
        player.passCombo = 0;
        player.scoredObstacleIds = {};
        player.lastDamageTime = 0;
        player.lastCollisionTime = 0;
      }

      if (Object.keys(room.players).length > 1 && room.players[BOT_ID]) {
        delete room.players[BOT_ID];
      }

      io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
    });

    socket.on("requestLeaderboard", () => {
      socket.emit("leaderboardUpdate", getLeaderboardData());
    });

    socket.on("findOpenGame", ({ playerName }) => {
      const nameCheck = validateAndRegisterName(socket, playerName);
      if (nameCheck.error) {
        socket.emit("joinError", nameCheck.error);
        return;
      }

      const lobbyRoom = Object.entries(rooms).find(([, room]) => {
        if (room.started) return false;
        const playerCount = Object.keys(room.players).filter(id => id !== BOT_ID).length;
        return playerCount < MAX_PLAYERS;
      });

      if (lobbyRoom) {
        const [roomCode] = lobbyRoom;
        addPlayerToRoom(socket, roomCode, nameCheck.name);
        io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
        return;
      }

      const openRoom = Object.entries(rooms).find(([, room]) => {
        if (!room.started) return false;
        const realPlayers = Object.keys(room.players).filter(id => id !== BOT_ID).length;
        const totalOccupants = realPlayers + Object.keys(room.spectators || {}).length;
        return totalOccupants < MAX_PLAYERS;
      });

      if (!openRoom) {
        queueWaitingPlayer(socket.id, nameCheck.name);
        socket.emit("quickJoinQueued");
        return;
      }

      const [roomCode, room] = openRoom;
      room.spectators[socket.id] = { id: socket.id, name: nameCheck.name };
      socket.join(roomCode);
      socket.emit("joinedAsSpectator", getGameState(roomCode));
    });

    socket.on("cancelQuickJoin", () => {
      if (dequeueWaitingPlayer(socket.id)) {
        releaseSocketName(socket.id);
      }
    });

    socket.on("playerInput", ({ roomCode, direction }) => {
      const room = rooms[roomCode];
      if (!room || !room.players[socket.id]) return;

      const player = room.players[socket.id];
      if (!room.started || !player.alive) return;

      applyInput(player, direction, room);
    });

    socket.on("ghostInput", ({ roomCode, direction }) => {
      const room = rooms[roomCode];
      if (!room || !room.players[socket.id]) return;

      const player = room.players[socket.id];
      if (player.alive || !room.started) return;

      const now = Date.now();

      if (direction === "spook") {
        if (now - (player.ghostLastSpook || 0) < GHOST_SPOOK_COOLDOWN) return;
        player.ghostLastSpook = now;

        const spookCX = (player.ghostX || gameWidth / 2) + birdSize / 2;
        const spookCY = (player.ghostY || gameHeight / 2) + birdSize / 2;

        for (const other of Object.values(room.players)) {
          if (!other.alive) continue;
          const dx = (other.x + birdSize / 2) - spookCX;
          const dy = (other.y + birdSize / 2) - spookCY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < GHOST_SPOOK_RADIUS && dist > 0) {
            const falloff = 1 - dist / GHOST_SPOOK_RADIUS;
            const resistanceMult = getKnockbackMultiplier(other, now);
            other.velocityX += (dx / dist) * GHOST_SPOOK_FORCE * falloff * resistanceMult;
            other.velocityY += (dy / dist) * GHOST_SPOOK_FORCE * falloff * resistanceMult;
            keepPlayerInsideArena(other);
          }
        }

        io.to(roomCode).emit("ghostSpook", {
          ghostId: socket.id,
          x: spookCX - birdSize / 2,
          y: spookCY - birdSize / 2
        });
        return;
      }

      if (direction === "up") player.ghostVY = flapStrength;
      if (direction === "left") {
        player.ghostVY = sideFlapStrength;
        player.ghostVX = (player.ghostVX || 0) - horizontalPush;
      }
      if (direction === "right") {
        player.ghostVY = sideFlapStrength;
        player.ghostVX = (player.ghostVX || 0) + horizontalPush;
      }
      if (direction === "up-left") {
        player.ghostVY = flapStrength * 0.92;
        player.ghostVX = (player.ghostVX || 0) - horizontalPush * 0.82;
      }
      if (direction === "up-right") {
        player.ghostVY = flapStrength * 0.92;
        player.ghostVX = (player.ghostVX || 0) + horizontalPush * 0.82;
      }
      if (direction === "down-left") {
        player.ghostVY = Math.max(player.ghostVY || 0, 6.2);
        player.ghostVX = (player.ghostVX || 0) - horizontalPush * 0.82;
      }
      if (direction === "down-right") {
        player.ghostVY = Math.max(player.ghostVY || 0, 6.2);
        player.ghostVX = (player.ghostVX || 0) + horizontalPush * 0.82;
      }
    });

    socket.on("disconnect", () => {
      dequeueWaitingPlayer(socket.id);
      releaseSocketName(socket.id);

      for (const roomCode in rooms) {
        const room = rooms[roomCode];

        if (room.spectators && room.spectators[socket.id]) {
          delete room.spectators[socket.id];
        }

        if (room.players[socket.id]) {
          delete room.players[socket.id];

          if (Object.keys(room.players).length === 0) {
            if (room.gameLoop) clearInterval(room.gameLoop);
            if (room.victoryTimer) clearTimeout(room.victoryTimer);
            if (room.autoRestartTimer) clearTimeout(room.autoRestartTimer);
            delete rooms[roomCode];
            return;
          }

          if (!room.started) {
            io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
          }

          if (room.curse && room.curse.carrierId === socket.id) {
            room.curse = null;
            room.lastCurseSpawn = Date.now();
            io.to(roomCode).emit("curseDespawned", { reason: "death" });
          }

          broadcastGameState(roomCode);
          checkForRoundEnd(roomCode);
        }
      }
    });
  });
}

module.exports = {
  registerSocketHandlers
};
