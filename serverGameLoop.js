"use strict";

/**
 * Server simulation loop orchestration.
 *
 * Responsibilities:
 * - Execute one deterministic room tick in a strict order.
 * - Own timer lifecycle (start/clear) for each room loop.
 */

/**
 * Runs one authoritative server simulation tick for a room.
 * The caller provides room-scoped dependencies so this module stays stateless.
 */
function runServerTick(roomCode, rooms, systems) {
  const activeRoom = rooms[roomCode];

  if (!activeRoom || !activeRoom.started) {
    if (activeRoom && activeRoom.gameLoop) {
      clearInterval(activeRoom.gameLoop);
      activeRoom.gameLoop = null;
    }
    return;
  }

  // 1) World state progression.
  systems.updateSpeedRamp(activeRoom);
  systems.updateWind(activeRoom, roomCode);

  // 2) Entity movement and AI.
  systems.updatePlayerPhysics(activeRoom);
  systems.updateBotAI(activeRoom);
  systems.updateGhosts(activeRoom);
  systems.updateCurse(activeRoom, roomCode);
  systems.checkCurseTransfer(activeRoom, roomCode);

  // 3) Interactions and hazards.
  systems.applyPlayerCollisions(activeRoom, roomCode);
  systems.updateMonster(activeRoom, roomCode);
  systems.updateObstacles(activeRoom, roomCode);

  // 4) Objectives and scoring.
  systems.updateGoldenTarget(activeRoom, roomCode);
  systems.updatePickups(activeRoom, roomCode);
  systems.applyObstacleDeaths(activeRoom, roomCode);
  systems.updateSurvivalScoring(activeRoom);

  // 5) Publish and round lifecycle checks.
  systems.broadcastGameState(roomCode);
  systems.checkForRoundEnd(roomCode);
}

/**
 * Creates the room loop starter used by server.js.
 * This keeps loop orchestration separate from feature systems.
 */
function createStartGameLoop(rooms, systems) {
  return function startGameLoop(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.gameLoop) {
      clearInterval(room.gameLoop);
    }

    room.gameLoop = setInterval(function tickRoom() {
      runServerTick(roomCode, rooms, systems);
    }, 1000 / 60);
  };
}

module.exports = {
  runServerTick,
  createStartGameLoop
};
