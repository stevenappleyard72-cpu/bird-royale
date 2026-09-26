"use strict";

/**
 * Curse hazard simulation.
 *
 * Responsibilities:
 * - Update roaming/attached curse behavior.
 * - Handle beam interception, collision attach/destroy, and transfer rules.
 */

/**
 * Cursed ball hazard system extracted from server.js.
 * Exposes only the two runtime entry points used by the simulation loop.
 */
function createCurseSystem(deps) {
  const {
    io,
    getAlivePlayers,
    randomNumber,
    getSpeedMultiplier,
    getRoundMutator,
    birdSize,
    curseBallSize,
    curseSpawnInterval,
    curseTargetSwitchCooldown,
    curseBeamInterceptDist,
    curseChaseAcceleration,
    curseMaxSpeed,
    gameWidth,
    gameHeight,
    vineDepth,
    grassDepth
  } = deps;

  function findNearestAlivePlayerId(room, x, y) {
    const alive = getAlivePlayers(room);
    if (alive.length === 0) return null;
    return alive.reduce((best, p) => {
      const da = Math.hypot((p.x + birdSize / 2) - x, (p.y + birdSize / 2) - y);
      const db = Math.hypot((best.x + birdSize / 2) - x, (best.y + birdSize / 2) - y);
      return da < db ? p : best;
    }).id;
  }

  function pointDistToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.001) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function curseBeamBlocked(cx, cy, tx, ty, obstacles) {
    if (Math.abs(tx - cx) < 1) return false;
    const minX = Math.min(cx, tx);
    const maxX = Math.max(cx, tx);
    for (const obs of obstacles) {
      if (obs.x + obs.width <= minX || obs.x >= maxX) continue;
      const sampleX = obs.x + obs.width / 2;
      const t = (sampleX - cx) / (tx - cx);
      if (t <= 0 || t >= 1) continue;
      const lineY = cy + t * (ty - cy);
      if (lineY < obs.topHeight) return true;
      if (lineY > gameHeight - obs.bottomHeight) return true;
    }
    return false;
  }

  function updateCurse(room, roomCode) {
    const now = Date.now();
    const speedMultiplier = getSpeedMultiplier(room);
    const mutator = getRoundMutator(room);
    const curseSpawnWindow = curseSpawnInterval * (mutator.curseSpawnMult || 1);
    const curseChaseMult = mutator.curseChaseMult || 1;

    if (room.curse && room.curse.state === "attached") {
      const carrier = room.players[room.curse.carrierId];
      if (!carrier || !carrier.alive) {
        room.curse = null;
        room.lastCurseSpawn = now;
        io.to(roomCode).emit("curseDespawned", { reason: "death" });
        return;
      }
      room.curse.x = carrier.x;
      room.curse.y = carrier.y + birdSize;
      return;
    }

    if (room.curse && room.curse.state === "roaming") {
      if (!room.curse.targetId || !room.players[room.curse.targetId] || !room.players[room.curse.targetId].alive) {
        room.curse.targetId = findNearestAlivePlayerId(room, room.curse.x, room.curse.y);
        if (!room.curse.targetId) {
          room.curse = null;
          room.lastCurseSpawn = now;
          io.to(roomCode).emit("curseDespawned", { reason: "notarget" });
          return;
        }
      }

      const target = room.players[room.curse.targetId];
      const targetCX = target.x + birdSize / 2;
      const targetCY = target.y + birdSize / 2;
      const curseCX = room.curse.x + curseBallSize / 2;
      const curseCY = room.curse.y + curseBallSize / 2;

      if (curseBeamBlocked(curseCX, curseCY, targetCX, targetCY, room.obstacles)) {
        room.curse = null;
        room.lastCurseSpawn = now;
        io.to(roomCode).emit("curseDespawned", { reason: "blocked" });
        return;
      }

      if (now - room.curse.lastTargetSwitch > curseTargetSwitchCooldown) {
        for (const p of Object.values(room.players)) {
          if (!p.alive || p.id === room.curse.targetId) continue;
          const dist = pointDistToSegment(
            p.x + birdSize / 2, p.y + birdSize / 2,
            curseCX, curseCY, targetCX, targetCY
          );
          if (dist < curseBeamInterceptDist) {
            room.curse.targetId = p.id;
            room.curse.lastTargetSwitch = now;
            io.to(roomCode).emit("curseTargetChanged", { targetId: p.id });
            break;
          }
        }
      }

      const dx = targetCX - curseCX;
      const dy = targetCY - curseCY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        room.curse.velocityX += (dx / dist) * curseChaseAcceleration * speedMultiplier * curseChaseMult;
        room.curse.velocityY += (dy / dist) * curseChaseAcceleration * speedMultiplier * curseChaseMult;
      }

      const speed = Math.sqrt(room.curse.velocityX ** 2 + room.curse.velocityY ** 2);
      if (speed > curseMaxSpeed * speedMultiplier) {
        room.curse.velocityX = (room.curse.velocityX / speed) * curseMaxSpeed * speedMultiplier;
        room.curse.velocityY = (room.curse.velocityY / speed) * curseMaxSpeed * speedMultiplier;
      }

      room.curse.x += room.curse.velocityX;
      room.curse.y += room.curse.velocityY;

      room.curse.x = Math.max(-curseBallSize, Math.min(gameWidth, room.curse.x));
      room.curse.y = Math.max(vineDepth, Math.min(gameHeight - grassDepth - curseBallSize, room.curse.y));

      for (const p of Object.values(room.players)) {
        if (!p.alive) continue;
        const colDist = Math.hypot(
          (p.x + birdSize / 2) - (room.curse.x + curseBallSize / 2),
          (p.y + birdSize / 2) - (room.curse.y + curseBallSize / 2)
        );
        if (colDist < (birdSize / 2 + curseBallSize / 2)) {
          const hasActivePowerup =
            (p.shieldExpiry !== null && now < p.shieldExpiry) ||
            (p.ramBoostExpiry !== null && now < p.ramBoostExpiry);
          if (hasActivePowerup) {
            p.shieldExpiry = null;
            p.ramBoostExpiry = null;
            room.curse = null;
            room.lastCurseSpawn = now;
            io.to(roomCode).emit("curseDestroyedByPowerup", { playerId: p.id });
          } else {
            room.curse.state = "attached";
            room.curse.carrierId = p.id;
            room.curse.targetId = null;
            room.curse.x = p.x;
            room.curse.y = p.y + birdSize;
            io.to(roomCode).emit("curseAttached", { carrierId: p.id });
          }
          return;
        }
      }
      return;
    }

    if (!room.curse && now - room.lastCurseSpawn > curseSpawnWindow) {
      if (getAlivePlayers(room).length < 2) return;
      const spawnY = randomNumber(vineDepth + curseBallSize, gameHeight - grassDepth - curseBallSize * 2);
      room.curse = {
        state: "roaming",
        x: gameWidth + curseBallSize,
        y: spawnY,
        velocityX: -0.6,
        velocityY: 0,
        targetId: null,
        carrierId: null,
        lastTargetSwitch: now - curseTargetSwitchCooldown
      };
      room.curse.targetId = findNearestAlivePlayerId(room, room.curse.x, room.curse.y);
      if (!room.curse.targetId) {
        room.curse = null;
        return;
      }
      io.to(roomCode).emit("curseSpawned", { targetId: room.curse.targetId });
    }
  }

  function checkCurseTransfer(room, roomCode) {
    if (!room.curse || room.curse.state !== "attached") return;
    const carrier = room.players[room.curse.carrierId];
    if (!carrier || !carrier.alive) return;

    for (const p of Object.values(room.players)) {
      if (!p.alive || p.id === room.curse.carrierId) continue;

      const dx = (carrier.x + birdSize / 2) - (p.x + birdSize / 2);
      const dy = (carrier.y + birdSize / 2) - (p.y + birdSize / 2);
      if (Math.sqrt(dx * dx + dy * dy) >= birdSize) continue;

      const isAbove = dy < -(birdSize * 0.15);
      const movingDown = carrier.velocityY > 0.8;

      if (isAbove && movingDown) {
        const fromId = room.curse.carrierId;
        room.curse.carrierId = p.id;
        room.curse.x = p.x;
        room.curse.y = p.y + birdSize;
        io.to(roomCode).emit("curseTransferred", { fromId, toId: p.id });
        return;
      }
    }
  }

  return {
    updateCurse,
    checkCurseTransfer
  };
}

module.exports = {
  createCurseSystem
};
