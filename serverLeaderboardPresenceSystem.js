"use strict";

/**
 * Leaderboard, name-presence, and waiting-queue orchestration.
 *
 * Responsibilities:
 * - Persist and roll up hourly leaderboard stats.
 * - Enforce active-name uniqueness.
 * - Manage quick-join waiting queue and queue draining.
 */

function createLeaderboardPresenceSystem(deps) {
  const {
    fs,
    io,
    rooms,
    BOT_ID,
    MAX_PLAYERS,
    leaderboardFilePath,
    addPlayerToRoom,
    getGameState,
    maxNameLength
  } = deps;

  let hallOfFame = loadHallOfFame();
  let hourlyStats = {};
  let activeNames = {};
  let waitingQueue = {};
  let hourlyResetTime = Date.now() + 3600000;

  function loadHallOfFame() {
    try {
      if (fs.existsSync(leaderboardFilePath)) {
        return JSON.parse(fs.readFileSync(leaderboardFilePath, "utf8"));
      }
    } catch (error) {
      console.error("Failed to load leaderboard:", error.message);
    }
    return {};
  }

  function saveHallOfFame() {
    try {
      fs.writeFileSync(leaderboardFilePath, JSON.stringify(hallOfFame, null, 2));
    } catch (error) {
      console.error("Failed to save leaderboard:", error.message);
    }
  }

  function getLeaderboardData() {
    const hourly = Object.entries(hourlyStats)
      .map(([name, stats]) => ({ name, matchWins: stats.matchWins, roundWins: stats.roundWins }))
      .sort((a, b) => b.matchWins - a.matchWins || b.roundWins - a.roundWins)
      .slice(0, 10);

    const hof = Object.entries(hallOfFame)
      .map(([name, data]) => ({
        name,
        points: data.points,
        bestMatchWins: data.bestMatchWins,
        bestRoundWins: data.bestRoundWins
      }))
      .sort((a, b) => b.points - a.points || b.bestMatchWins - a.bestMatchWins)
      .slice(0, 10);

    return { hourly, hof, resetAt: hourlyResetTime };
  }

  function recordHourlyStat(name, type) {
    if (!hourlyStats[name]) hourlyStats[name] = { matchWins: 0, roundWins: 0 };
    hourlyStats[name][type]++;
  }

  function resetHourlyLeaderboard() {
    const entries = Object.entries(hourlyStats);
    if (entries.length > 0) {
      const maxMatchWins = Math.max(...entries.map(([, stats]) => stats.matchWins));
      if (maxMatchWins > 0) {
        entries
          .filter(([, stats]) => stats.matchWins === maxMatchWins)
          .forEach(([name, stats]) => {
            if (!hallOfFame[name]) hallOfFame[name] = { points: 0, bestMatchWins: 0, bestRoundWins: 0 };
            hallOfFame[name].points++;
            if (
              stats.matchWins > hallOfFame[name].bestMatchWins ||
              (stats.matchWins === hallOfFame[name].bestMatchWins && stats.roundWins > hallOfFame[name].bestRoundWins)
            ) {
              hallOfFame[name].bestMatchWins = stats.matchWins;
              hallOfFame[name].bestRoundWins = stats.roundWins;
            }
          });
        saveHallOfFame();
      }
    }

    hourlyStats = {};
    hourlyResetTime = Date.now() + 3600000;
    io.emit("leaderboardUpdate", getLeaderboardData());
  }

  function startHourlyResetScheduler() {
    setInterval(resetHourlyLeaderboard, 3600000);
  }

  function validateAndRegisterName(socket, playerName) {
    const trimmed = (playerName || "").trim().slice(0, maxNameLength);
    if (trimmed.length < 2) return { error: "Name must be at least 2 characters." };

    const nameLower = trimmed.toLowerCase();
    if (nameLower === "bot") return { error: '"Bot" is a reserved name.' };
    if (activeNames[nameLower] && activeNames[nameLower] !== socket.id) {
      return { error: `The name "${trimmed}" is already used by an active player.` };
    }

    for (const [key, id] of Object.entries(activeNames)) {
      if (id === socket.id) {
        delete activeNames[key];
        break;
      }
    }

    activeNames[nameLower] = socket.id;
    return { name: trimmed };
  }

  function releaseSocketName(socketId) {
    for (const [nameLower, id] of Object.entries(activeNames)) {
      if (id === socketId) {
        delete activeNames[nameLower];
        break;
      }
    }
  }

  function queueWaitingPlayer(socketId, name) {
    waitingQueue[socketId] = { name };
  }

  function dequeueWaitingPlayer(socketId) {
    if (!waitingQueue[socketId]) return false;
    delete waitingQueue[socketId];
    return true;
  }

  function isPlayerQueued(socketId) {
    return Boolean(waitingQueue[socketId]);
  }

  function drainWaitingQueue(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    for (const [socketId, entry] of Object.entries(waitingQueue)) {
      const realPlayers = Object.keys(room.players).filter(id => id !== BOT_ID).length;
      const totalOccupants = realPlayers + Object.keys(room.spectators || {}).length;
      if (totalOccupants >= MAX_PLAYERS) break;

      const sock = io.sockets.sockets.get(socketId);
      if (!sock) {
        delete waitingQueue[socketId];
        continue;
      }

      room.spectators[socketId] = { id: socketId, name: entry.name };
      sock.join(roomCode);
      sock.emit("joinedAsSpectator", getGameState(roomCode));
      delete waitingQueue[socketId];
    }
  }

  function drainWaitingQueueToLobby(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.started) return;

    for (const [socketId, entry] of Object.entries(waitingQueue)) {
      const playerCount = Object.keys(room.players).filter(id => id !== BOT_ID).length;
      if (playerCount >= MAX_PLAYERS) break;

      const sock = io.sockets.sockets.get(socketId);
      if (!sock) {
        delete waitingQueue[socketId];
        continue;
      }

      addPlayerToRoom(sock, roomCode, entry.name);
      delete waitingQueue[socketId];
    }

    io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
  }

  return {
    getLeaderboardData,
    recordHourlyStat,
    resetHourlyLeaderboard,
    startHourlyResetScheduler,
    validateAndRegisterName,
    releaseSocketName,
    queueWaitingPlayer,
    dequeueWaitingPlayer,
    isPlayerQueued,
    drainWaitingQueue,
    drainWaitingQueueToLobby
  };
}

module.exports = {
  createLeaderboardPresenceSystem
};
