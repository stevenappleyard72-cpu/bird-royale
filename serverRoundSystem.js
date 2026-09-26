"use strict";

/**
 * Round-state derivation utilities.
 *
 * Responsibilities:
 * - Convert room state into round phase/timing values.
 * - Resolve mutator behavior and speed multipliers.
 * - Keep round helper logic pure and reusable.
 */

/**
 * Round-state helpers derived from room state and mutator configuration.
 * Kept pure so they are easy to test and reuse across server systems.
 */
function createRoundSystem(config) {
  const {
    roundMutators,
    rotatingMutatorPool,
    suddenDeathStartMs
  } = config;

  function getRoundMutator(room) {
    return roundMutators[(room && room.currentMutatorId) || "standard"] || roundMutators.standard;
  }

  function getRoundStartTime(room) {
    return room.roundLiveStartTime || room.roundStartTime || null;
  }

  function getRoundElapsedMs(room) {
    const startTime = getRoundStartTime(room);
    return startTime ? Date.now() - startTime : 0;
  }

  function isSuddenDeath(room) {
    return getRoundStartTime(room) !== null && getRoundElapsedMs(room) >= suddenDeathStartMs;
  }

  function getRoundTimeLeft(room) {
    const startTime = getRoundStartTime(room);
    if (!startTime) return 0;
    return Math.max(0, Math.ceil((suddenDeathStartMs - getRoundElapsedMs(room)) / 1000));
  }

  function getRoundPhase(room) {
    const startTime = getRoundStartTime(room);
    if (!startTime) return room.started ? "countdown" : "lobby";
    return isSuddenDeath(room) ? "suddenDeath" : "scramble";
  }

  function pickRoundMutator(room) {
    if (!room) return "standard";
    if (!room.roundCounter || room.roundCounter <= 1) return "standard";

    const choices = rotatingMutatorPool.filter(id => id !== room.lastMutatorId);
    const pool = choices.length > 0 ? choices : rotatingMutatorPool;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function getSpeedMultiplier(room) {
    const base = (room.gameSpeed || 10) / 10;
    const mutator = getRoundMutator(room);
    const mutatorSpeed = mutator.speedMult || 1;
    return isSuddenDeath(room) ? base * 1.2 * mutatorSpeed : base * mutatorSpeed;
  }

  return {
    getRoundMutator,
    getRoundStartTime,
    getRoundElapsedMs,
    isSuddenDeath,
    getRoundTimeLeft,
    getRoundPhase,
    pickRoundMutator,
    getSpeedMultiplier
  };
}

module.exports = {
  createRoundSystem
};
