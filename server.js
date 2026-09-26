const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const { createStartGameLoop } = require("./serverGameLoop");
const { createRoundSystem } = require("./serverRoundSystem");
const { createCurseSystem } = require("./serverCurseSystem");
const { createLeaderboardPresenceSystem } = require("./serverLeaderboardPresenceSystem");
const { createRoundLifecycleSystem } = require("./serverRoundLifecycleSystem");
const { registerSocketHandlers } = require("./serverSocketHandlers");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = {};
const {
  playerColours,
  MAX_PLAYERS,
  birdSize,
  gameWidth,
  gameHeight,
  playerMaxHealth,
  playerHealthRegenPerSecond,
  playerHealthRegenDelay,
  roundDurationMs,
  suddenDeathLeadInMs,
  suddenDeathStartMs,
  obstaclePassBasePoints,
  obstaclePassComboBonusCap,
  obstaclePassSuddenDeathBonus,
  obstacleNearMissPoints,
  obstacleNearMissThreshold,
  survivalTickMs,
  survivalTickPoints,
  roundWinnerBonusPoints,
  suddenDeathWinnerBonusPoints,
  obstacleDamage,
  obstacleDamageSuddenDeath,
  obstacleDamageCooldownMs,
  collisionToObstacleWindowMs,
  collisionForceObstacleBonus,
  collisionForceObstacleKoBonus,
  collisionPointSteal,
  collisionPointStealBonus,
  bountyMinPoints,
  bountyMinLead,
  bountyHitBonus,
  bountyCrashBonus,
  crownPickupSize,
  crownPickupPoints,
  crownSuddenDeathBonusPoints,
  crownPickupHeal,
  goldenTargetSize,
  goldenTargetSpawnInterval,
  goldenTargetBasePoints,
  goldenTargetSuddenDeathBonus,
  goldenTargetTravelSpeed,
  goldenTargetVerticalSpeed,
  feverWindowMs,
  feverDurationMs,
  feverBonusPoints,
  feverFlapMultiplier,
  feverPushMultiplier,
  gravity,
  flapStrength,
  sideFlapStrength,
  horizontalPush,
  horizontalDrag,
  diveBurstStart,
  diveBurstDecay,
  diveBurstMinimum,
  obstacleWidth,
  obstacleSpacing,
  obstacleSpeed,
  targetObstacleCount,
  victimKnockback,
  attackerRecoil,
  shieldDuration,
  shieldPickupSize,
  maxPickups,
  pickupSpawnInterval,
  shockwavePickupSize,
  shockwaveRadius,
  shockwavePushStrength,
  ramBoostDuration,
  ramBoostPickupSize,
  ramBoostKnockbackMultiplier,
  ramBoostRecoilMultiplier,
  GHOST_SPOOK_RADIUS,
  GHOST_SPOOK_FORCE,
  GHOST_SPOOK_COOLDOWN,
  curseBallSize,
  curseSpawnInterval,
  curseChaseAcceleration,
  curseMaxSpeed,
  curseTargetSwitchCooldown,
  curseBeamInterceptDist,
  curseExtraGravity,
  curseKnockbackBonus,
  monsterSpawnInterval,
  monsterChaseSpeed,
  monsterMinGap,
  monsterPunchRange,
  monsterPunchDynamicMinRange,
  monsterPunchSafeCenterPadding,
  monsterPunchCooldownMs,
  monsterPlantHitCooldownMs,
  monsterPlantBigHitCooldownMs,
  monsterBigHitChance,
  monsterBigHitWindupMs,
  monsterBigHitDamageMultiplier,
  monsterBigHitKnockbackMultiplier,
  monsterBigHitMinIntervalMs,
  monsterPunchKnockback,
  monsterPunchDamage,
  monsterPunchVictimGraceMs,
  monsterArmReachMin,
  monsterArmReachMax,
  monsterBoxingStyles,
  windGustIntervalMs,
  windGustDurationMs,
  windGustForceMin,
  windGustForceMax,
  BOT_ID,
  BOT_NAME,
  roundWinRule,
  roundMutators,
  rotatingMutatorPool,
  pointPowerThresholds,
  pointPowerDurationMs,
  pointPowerFlapMultiplier,
  pointPowerPushMultiplier,
  pointPowerHeal,
  tier3ClutchImmunityMs,
  clutchKnockbackResistance,
  grassDepth,
  vineDepth,
  boundaryReleaseVelocity,
  boundaryDiveBurstDamping
} = require("./serverConfig");
const leaderboardPresence = createLeaderboardPresenceSystem({
  fs,
  io,
  rooms,
  BOT_ID,
  MAX_PLAYERS,
  leaderboardFilePath: path.join(__dirname, "leaderboard.json"),
  addPlayerToRoom,
  getGameState,
  maxNameLength: 20
});

const {
  getLeaderboardData,
  recordHourlyStat,
  startHourlyResetScheduler,
  validateAndRegisterName,
  releaseSocketName,
  queueWaitingPlayer,
  dequeueWaitingPlayer,
  drainWaitingQueue,
  drainWaitingQueueToLobby
} = leaderboardPresence;

startHourlyResetScheduler();

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function clampGameSpeed(value) {
  const speed = Number(value) || 10;
  return Math.max(1, Math.min(99, speed));
}

function clampTargetScore(value) {
  const score = Number(value) || 3;
  return Math.max(2, Math.min(5, score));
}

const {
  getRoundMutator,
  getRoundStartTime,
  getRoundElapsedMs,
  isSuddenDeath,
  getRoundTimeLeft,
  getRoundPhase,
  pickRoundMutator,
  getSpeedMultiplier
} = createRoundSystem({
  roundMutators,
  rotatingMutatorPool,
  suddenDeathStartMs
});

function createPlayerState(id, name, colour, x, y) {
  return {
    id,
    name,
    colour,
    x,
    y,
    velocityX: 0,
    velocityY: 0,
    diveBurst: 0,
    alive: true,
    score: 0,
    points: 0,
    health: playerMaxHealth,
    maxHealth: playerMaxHealth,
    shieldExpiry: null,
    ramBoostExpiry: null,
    ghostX: gameWidth / 2,
    ghostY: gameHeight / 2,
    ghostVX: 0,
    ghostVY: 0,
    ghostLastSpook: 0,
    aliveTimeMs: 0,
    lastMonsterPunchTime: 0,
    passCombo: 0,
    comboMilestoneHit: 0,
    scoredObstacleIds: {},
    nearMissObstacleIds: {},
    lastDamageTime: 0,
    lastCollisionTime: 0,
    lastObstacleDamageTime: 0,
    lastSurvivalAwardTime: 0,
    lastHitByPlayerId: null,
    lastHitByTime: 0,
    lastBigScoreTime: 0,
    bigScoreChain: 0,
    feverExpiry: 0,
    powerTierUnlocked: 0,
    powerSurgeTier: 0,
    powerSurgeExpiry: 0,
    clutchImmunityCharges: 0,
    clutchImmunityExpiry: 0
  };
}

function isFeverActive(player, now = Date.now()) {
  return Boolean(player && player.feverExpiry && now < player.feverExpiry);
}

function isPowerSurgeActive(player, now = Date.now()) {
  return Boolean(player && player.powerSurgeExpiry && now < player.powerSurgeExpiry && (player.powerSurgeTier || 0) > 0);
}

function hasClutchImmunity(player, now = Date.now()) {
  return Boolean(
    player &&
    (player.clutchImmunityCharges || 0) > 0 &&
    player.clutchImmunityExpiry &&
    now < player.clutchImmunityExpiry
  );
}

function getKnockbackMultiplier(player, now = Date.now()) {
  return hasClutchImmunity(player, now) ? (1 - clutchKnockbackResistance) : 1;
}

function getPowerTierByPoints(points) {
  let tier = 0;
  for (let i = 0; i < pointPowerThresholds.length; i++) {
    if ((points || 0) >= pointPowerThresholds[i]) tier = i + 1;
  }
  return tier;
}

function emitArenaCallout(roomCode, type, text, playerId) {
  io.to(roomCode).emit("arenaCallout", { type, text, playerId: playerId || null });
}

function registerBigScoreEvent(player, now) {
  if (now - (player.lastBigScoreTime || 0) <= feverWindowMs) {
    player.bigScoreChain = (player.bigScoreChain || 0) + 1;
  } else {
    player.bigScoreChain = 1;
  }

  player.lastBigScoreTime = now;

  if (player.bigScoreChain >= 2) {
    const wasActive = isFeverActive(player, now);
    player.feverExpiry = Math.max(player.feverExpiry || 0, now + feverDurationMs);
    return !wasActive;
  }

  return false;
}

function awardEventPoints(room, roomCode, player, amount, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const leaderBefore = getPointLeader(room);
  const previousLeaderId = leaderBefore ? leaderBefore.id : null;

  awardPoints(player, amount, room, roomCode, { now });

  let feverTriggered = false;
  if (opts.feverEligible) {
    feverTriggered = registerBigScoreEvent(player, now);
    if (isFeverActive(player, now)) {
      awardPoints(player, feverBonusPoints, room, roomCode, { now });
    }
  }

  if (opts.calloutType && opts.calloutText) {
    emitArenaCallout(roomCode, opts.calloutType, opts.calloutText, player.id);
  }

  if (feverTriggered) {
    emitArenaCallout(roomCode, "fever", player.name + " FEVER!", player.id);
  }

  const leaderAfter = getPointLeader(room);
  if (leaderAfter && leaderAfter.id === player.id && previousLeaderId && previousLeaderId !== player.id) {
    emitArenaCallout(roomCode, "comeback", player.name + " TAKES THE LEAD!", player.id);
  }
}

function getPointLeader(room) {
  const players = Object.values(room.players || {});
  if (players.length === 0) return null;

  return players.slice().sort((a, b) => {
    const pointsDiff = (b.points || 0) - (a.points || 0);
    if (pointsDiff !== 0) return pointsDiff;

    const healthDiff = (b.health || 0) - (a.health || 0);
    if (healthDiff !== 0) return healthDiff;

    const aliveDiff = Number(Boolean(b.alive)) - Number(Boolean(a.alive));
    if (aliveDiff !== 0) return aliveDiff;

    return (b.passCombo || 0) - (a.passCombo || 0);
  })[0];
}

function ensureRoundStats(room, playerId) {
  if (!room.roundStats) room.roundStats = {};
  if (!room.roundStats[playerId]) {
    room.roundStats[playerId] = {
      nearMisses: 0,
      comboPeak: 0,
      hitsLanded: 0,
      monsterJabsTaken: 0,
      survivalMs: 0
    };
  }
  return room.roundStats[playerId];
}

function buildRoundHighlights(room) {
  const rows = Object.values(room.players || {}).map(player => {
    const s = ensureRoundStats(room, player.id);
    s.survivalMs = Math.max(s.survivalMs || 0, player.aliveTimeMs || 0);
    return { playerId: player.id, name: player.name, stats: s };
  });

  const highlights = [];

  function bestBy(field, minValue) {
    const sorted = rows.slice().sort((a, b) => (b.stats[field] || 0) - (a.stats[field] || 0));
    if (sorted.length === 0) return null;
    if ((sorted[0].stats[field] || 0) < minValue) return null;
    return sorted[0];
  }

  const comboTop = bestBy("comboPeak", 2);
  if (comboTop) {
    highlights.push({
      icon: "🔥",
      title: "Combo Crown",
      playerName: comboTop.name,
      value: "x" + comboTop.stats.comboPeak
    });
  }

  const nearMissTop = bestBy("nearMisses", 1);
  if (nearMissTop) {
    highlights.push({
      icon: "🪶",
      title: "Threaded Needles",
      playerName: nearMissTop.name,
      value: nearMissTop.stats.nearMisses + " near misses"
    });
  }

  const brawlerTop = bestBy("hitsLanded", 1);
  if (brawlerTop) {
    highlights.push({
      icon: "🥊",
      title: "Top Brawler",
      playerName: brawlerTop.name,
      value: brawlerTop.stats.hitsLanded + " hits"
    });
  }

  const survivalTop = bestBy("survivalMs", 1);
  if (survivalTop) {
    highlights.push({
      icon: "⏱",
      title: "Longest Flight",
      playerName: survivalTop.name,
      value: Math.max(1, Math.round(survivalTop.stats.survivalMs / 1000)) + "s"
    });
  }

  return highlights.slice(0, 3);
}

function getRoundWinner(room) {
  const alivePlayers = getAlivePlayers(room);
  return alivePlayers.length === 1 ? alivePlayers[0] : null;
}

function getRoundWinReason(room, winner) {
  if (winner && winner.alive) return "lastAlive";
  return "none";
}

function dealDamage(player, amount, room, now) {
  const damage = Math.max(0, amount);
  player.health = Math.max(0, (player.health || 0) - damage);
  player.lastDamageTime = now;
  player.passCombo = 0;

  if (player.health <= 0) {
    player.alive = false;
    player.ghostX = player.x;
    player.ghostY = Math.max(vineDepth, Math.min(gameHeight - birdSize - grassDepth, player.y));
    player.ghostVX = player.velocityX * 0.3;
    player.ghostVY = player.velocityY * 0.3;
  }
}

function restoreHealth(player, amount) {
  const heal = Math.max(0, amount);
  player.health = Math.min(player.maxHealth || playerMaxHealth, (player.health || 0) + heal);
}

function tryActivatePointPower(room, roomCode, player, now) {
  if (!player || !player.alive) return;

  const newTier = getPowerTierByPoints(player.points || 0);
  if (newTier <= (player.powerTierUnlocked || 0)) return;

  for (let tier = (player.powerTierUnlocked || 0) + 1; tier <= newTier; tier++) {
    const tierIndex = tier - 1;
    player.powerTierUnlocked = tier;
    player.powerSurgeTier = tier;
    player.powerSurgeExpiry = Math.max(player.powerSurgeExpiry || 0, now + pointPowerDurationMs[tierIndex]);
    restoreHealth(player, pointPowerHeal[tierIndex]);

    if (tier === 3) {
      player.clutchImmunityCharges = 1;
      player.clutchImmunityExpiry = now + tier3ClutchImmunityMs;
    }

    emitArenaCallout(roomCode, "power", player.name + " SURGE " + tier + "!", player.id);
  }
}

function awardPoints(player, amount, room, roomCode, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  player.points = Math.max(0, (player.points || 0) + amount);
  if (!opts.skipPowerTrigger && room && roomCode) {
    tryActivatePointPower(room, roomCode, player, now);
  }
}

function updateSurvivalScoring(room) {
  const now = Date.now();
  for (const player of Object.values(room.players)) {
    if (!player.alive) continue;
    if (!player.lastSurvivalAwardTime) {
      player.lastSurvivalAwardTime = now;
      continue;
    }
    if (now - player.lastSurvivalAwardTime >= survivalTickMs) {
      awardPoints(player, survivalTickPoints + (isSuddenDeath(room) ? 2 : 0), room, room.roomCode, { now });
      player.lastSurvivalAwardTime = now;
    }
  }
}

function getCrownPointValue(room) {
  return crownPickupPoints + (isSuddenDeath(room) ? crownSuddenDeathBonusPoints : 0);
}

function getGoldenTargetPointValue(room) {
  return goldenTargetBasePoints + (isSuddenDeath(room) ? goldenTargetSuddenDeathBonus : 0);
}

function getBountyState(room) {
  const alivePlayers = Object.values(room.players || {}).filter(player => player.alive);
  if (alivePlayers.length < 2) return null;

  const sorted = alivePlayers.slice().sort((a, b) => (b.points || 0) - (a.points || 0));
  const leader = sorted[0];
  const runnerUp = sorted[1];
  if (!leader) return null;

  const lead = (leader.points || 0) - (runnerUp ? (runnerUp.points || 0) : 0);
  if ((leader.points || 0) < bountyMinPoints || lead < bountyMinLead) {
    return null;
  }

  return {
    targetId: leader.id,
    targetName: leader.name,
    bonus: bountyHitBonus,
    crashBonus: bountyCrashBonus,
    lead
  };
}

function awardCollisionToObstacleBonus(room, victim, now, knockedOut) {
  if (!victim.lastHitByPlayerId || !victim.lastHitByTime) return;
  if (now - victim.lastHitByTime > collisionToObstacleWindowMs) return;

  const attacker = room.players[victim.lastHitByPlayerId];
  if (!attacker || attacker.id === victim.id) return;

  const bounty = getBountyState(room);
  const bountyBonus = bounty && bounty.targetId === victim.id
    ? (knockedOut ? bounty.crashBonus : bounty.bonus)
    : 0;

  const baseBonus = knockedOut ? collisionForceObstacleKoBonus : collisionForceObstacleBonus;
  const phaseBonus = isSuddenDeath(room) ? 2 : 0;
  const stealCap = knockedOut ? 3 : 2;

  awardEventPoints(room, room.roomCode, attacker, baseBonus + phaseBonus + bountyBonus, {
    now,
    feverEligible: true,
    calloutType: knockedOut ? "slam" : null,
    calloutText: knockedOut ? attacker.name + " SLAM DUNK!" : null
  });
  const stolen = Math.min(victim.points || 0, stealCap);
  if (stolen > 0) {
    victim.points = Math.max(0, (victim.points || 0) - stolen);
    awardPoints(attacker, stolen, room, room.roomCode, { now });
  }

  victim.lastHitByPlayerId = null;
  victim.lastHitByTime = 0;
}

function randomNumber(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getPlayersInRoom(roomCode) {
  if (!rooms[roomCode]) return [];
  return Object.values(rooms[roomCode].players);
}

function addBotToRoom(roomCode) {
  const room = rooms[roomCode];
  const playerCount = Object.keys(room.players).length;
  room.players[BOT_ID] = createPlayerState(
    BOT_ID,
    BOT_NAME,
    playerColours[playerCount % playerColours.length],
    70 + playerCount * 55,
    220
  );
}

function updateBotAI(room) {
  const bot = room.players[BOT_ID];
  if (!bot || !bot.alive) return;

  const now = Date.now();
  const speedMultiplier = getSpeedMultiplier(room);

  // Rate-limit to ~7 decisions per second, matching a casual human reaction time.
  if (now - (room.botLastInput || 0) < 140 + Math.random() * 55) return;

  const birdCenterY = bot.y + birdSize / 2;

  // ── Ceiling guard: already near top and still rising — do nothing ────────────
  if (bot.y <= vineDepth + 10 && bot.velocityY < 0) {
    room.botLastInput = now;
    return;
  }

  // ── Choose vertical target ───────────────────────────────────────────────────
  // Use the nearest upcoming pipe gap centre as the target.
  // Clamp it well inside the gap so the bot stays clear of both walls.
  const next = room.obstacles.find(o => o.x + o.width > bot.x);
  let targetY;
  if (next) {
    const gapTop    = next.topHeight;
    const gapBottom = gameHeight - next.bottomHeight;
    const margin    = birdSize;           // stay at least one bird-width from each face
    targetY = Math.max(gapTop + margin, Math.min(gapBottom - margin, (gapTop + gapBottom) / 2));
  } else {
    targetY = gameHeight / 2;
  }

  // Floor override: if dangerously close to the floor, push target well upward.
  if (bot.y + birdSize >= gameHeight - grassDepth - 14) {
    targetY = gameHeight * 0.35;
  }

  // ── Short lookahead ──────────────────────────────────────────────────────────
  // Simulate where the bird centre will be after LOOKAHEAD ticks using only
  // current velocity + gravity.  No flap scenario is modelled here.
  // If this trajectory ends up below the target → flap now to correct it.
  const LOOKAHEAD = 10;
  let simY  = birdCenterY;
  let simVY = bot.velocityY;
  for (let t = 0; t < LOOKAHEAD; t++) {
    simVY += gravity * speedMultiplier;
    simY  += simVY * speedMultiplier;
    if (simY < vineDepth + birdSize / 2)                  simY = vineDepth + birdSize / 2;
    if (simY > gameHeight - grassDepth - birdSize / 2)    simY = gameHeight - grassDepth - birdSize / 2;
  }

  if (simY > targetY) {
    applyInput(bot, "up", room);
    room.botLastInput = now;
  }
}

function createObstacle(x, room) {
  // Gap narrows over time: maxCombined rises from 250 → 330 over 45 seconds
  let maxCombined = gameHeight / 2;
  const mutator = getRoundMutator(room);
  if (room && room.roundStartTime) {
    const elapsed = (Date.now() - room.roundStartTime) / 1000;
    const t = Math.min(elapsed / 45, 1.0);
    maxCombined = (gameHeight / 2) + 80 * t;
  }
  maxCombined -= (mutator.gapTighten || 0);
  maxCombined = Math.max(190, maxCombined);

  let topHeight, bottomHeight;
  let attempts = 0;
  do {
    topHeight    = randomNumber(50, 150);
    bottomHeight = randomNumber(50, 150);
    attempts++;
  } while (topHeight + bottomHeight > maxCombined && attempts < 30);

  // Hard fallback to avoid infinite loop if maxCombined is tight
  if (topHeight + bottomHeight > maxCombined) {
    topHeight    = Math.floor(maxCombined / 2);
    bottomHeight = maxCombined - topHeight;
  }

  return {
    id: Math.random().toString(36).slice(2, 9),
    x,
    width: obstacleWidth,
    topHeight,
    bottomHeight,
    isMonster: false,
    monsterStyle: randomChoice(monsterBoxingStyles),
    topPunchStart: 0,
    topPunchUntil: 0,
    bottomPunchStart: 0,
    bottomPunchUntil: 0,
    topPunchReach: monsterArmReachMin,
    bottomPunchReach: monsterArmReachMin,
    lastMonsterPunchAt: 0,
    topNextPunchAt: 0,
    bottomNextPunchAt: 0,
    topLastBigHitAt: 0,
    bottomLastBigHitAt: 0,
    topBigPunchWindupStart: 0,
    topBigPunchWindupUntil: 0,
    topBigPunchTargetId: null,
    bottomBigPunchWindupStart: 0,
    bottomBigPunchWindupUntil: 0,
    bottomBigPunchTargetId: null
  };
}

function createInitialObstacles(room) {
  const obstacles = [];

  for (let i = 0; i < targetObstacleCount; i++) {
    obstacles.push(
      createObstacle((gameWidth - obstacleWidth) + i * obstacleSpacing, room)
    );
  }

  return obstacles;
}

function getGameState(roomCode) {
  const room = rooms[roomCode];
  const phase = getRoundPhase(room);
  const bounty = getBountyState(room);
  const mutator = getRoundMutator(room);

  return {
    roomCode,
    hostId: room.hostId,
    started: room.started,
    gameSpeed: room.gameSpeed,
    targetScore: room.targetScore,
    players: getPlayersInRoom(roomCode).map(p => {
      const now = Date.now();
      return {
        ...p,
        points: p.points || 0,
        health: p.health !== undefined ? p.health : playerMaxHealth,
        maxHealth: p.maxHealth || playerMaxHealth,
        feverActive: isFeverActive(p),
        feverTimeLeft: Math.max(0, Math.ceil(((p.feverExpiry || 0) - Date.now()) / 1000)),
        powerTierUnlocked: p.powerTierUnlocked || 0,
        powerSurgeTier: p.powerSurgeTier || 0,
        powerSurgeActive: isPowerSurgeActive(p, now),
        powerSurgeTimeLeft: Math.max(0, Math.ceil(((p.powerSurgeExpiry || 0) - Date.now()) / 1000)),
        clutchReady: hasClutchImmunity(p, now),
        clutchTimeLeft: Math.max(0, Math.ceil(((p.clutchImmunityExpiry || 0) - Date.now()) / 1000)),
        shielded: p.shieldExpiry !== null && now < p.shieldExpiry,
        ramBoosted: p.ramBoostExpiry !== null && now < p.ramBoostExpiry,
        ghostX: p.ghostX !== undefined ? p.ghostX : gameWidth / 2,
        ghostY: p.ghostY !== undefined ? p.ghostY : gameHeight / 2,
        ghostSpookReady: !p.alive && p.id !== BOT_ID && (now - (p.ghostLastSpook || 0) >= GHOST_SPOOK_COOLDOWN)
      };
    }),
    obstacles: room.obstacles,
    obstaclesPassed: room.obstaclesPassed,
    pickups: room.pickups || [],
    spectatorCount: Object.keys(room.spectators || {}).length,
    roundTimeLeft: phase === "lobby" || phase === "countdown" ? 0 : getRoundTimeLeft(room),
    roundPhase: phase,
    roundWinRule,
    suddenDeath: phase === "suddenDeath",
    bounty,
    roundMutator: {
      id: mutator.id,
      name: mutator.name,
      description: mutator.description
    },
    wind: room.wind && room.wind.active ? {
      active: true,
      direction: room.wind.direction,
      strength: room.wind.strength,
      timeLeft: Math.max(0, Math.ceil((room.wind.endAt - Date.now()) / 1000))
    } : null,
    goldenTarget: room.goldenTarget || null,
    curse: room.curse ? {
      state:     room.curse.state,
      x:         room.curse.x,
      y:         room.curse.y,
      targetId:  room.curse.targetId,
      carrierId: room.curse.carrierId
    } : null
  };
}

function broadcastGameState(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  io.to(roomCode).emit("gameState", getGameState(roomCode));
}

function addPlayerToRoom(socket, roomCode, playerName) {
  const room = rooms[roomCode];
  const playerCount = Object.keys(room.players).length;

  room.players[socket.id] = createPlayerState(
    socket.id,
    playerName,
    playerColours[playerCount % playerColours.length],
    70 + playerCount * 55,
    220
  );

  socket.join(roomCode);
}

function resetPlayersForRound(room) {
  const players = Object.values(room.players);

  for (let i = 0; i < players.length; i++) {
    players[i].x = 70 + i * 55;
    players[i].y = 220;
    players[i].velocityX = 0;
    players[i].velocityY = 0;
    players[i].diveBurst = 0;
    players[i].alive = true;
    players[i].points = 0;
    players[i].health = playerMaxHealth;
    players[i].maxHealth = playerMaxHealth;
    players[i].shieldExpiry = null;
    players[i].ramBoostExpiry = null;
    players[i].ghostX = gameWidth / 2;
    players[i].ghostY = gameHeight / 2;
    players[i].ghostVX = 0;
    players[i].ghostVY = 0;
    players[i].ghostLastSpook = 0;
    players[i].aliveTimeMs = 0;
    players[i].lastMonsterPunchTime = 0;
    players[i].passCombo = 0;
    players[i].comboMilestoneHit = 0;
    players[i].scoredObstacleIds = {};
    players[i].nearMissObstacleIds = {};
    players[i].lastDamageTime = 0;
    players[i].lastCollisionTime = 0;
    players[i].lastObstacleDamageTime = 0;
    players[i].lastSurvivalAwardTime = 0;
    players[i].lastHitByPlayerId = null;
    players[i].lastHitByTime = 0;
    players[i].lastBigScoreTime = 0;
    players[i].bigScoreChain = 0;
    players[i].feverExpiry = 0;
    players[i].powerTierUnlocked = 0;
    players[i].powerSurgeTier = 0;
    players[i].powerSurgeExpiry = 0;
    players[i].clutchImmunityCharges = 0;
    players[i].clutchImmunityExpiry = 0;
  }
}

function keepPlayerInsideArena(player) {
  const minY = vineDepth;
  const maxY = gameHeight - birdSize - grassDepth;

  if (player.x < 0) {
    player.x = 0;
    player.velocityX = 0;
  }

  if (player.x > gameWidth - birdSize) {
    player.x = gameWidth - birdSize;
    player.velocityX = 0;
  }

  if (player.y < minY) {
    player.y = minY;
    if (player.velocityY < 0) player.velocityY = boundaryReleaseVelocity;
    if (player.diveBurst < 0) player.diveBurst *= boundaryDiveBurstDamping;
  }

  if (player.y > maxY) {
    player.y = maxY;
    if (player.velocityY > 0) player.velocityY = -boundaryReleaseVelocity;
    if (player.diveBurst > 0) player.diveBurst *= boundaryDiveBurstDamping;
  }
}

function applyInput(player, direction, room) {
  const feverFlap = isFeverActive(player) ? feverFlapMultiplier : 1;
  const feverPush = isFeverActive(player) ? feverPushMultiplier : 1;
  const powerIndex = Math.max(0, Math.min(pointPowerThresholds.length - 1, (player.powerSurgeTier || 1) - 1));
  const powerFlap = isPowerSurgeActive(player) ? pointPowerFlapMultiplier[powerIndex] : 1;
  const powerPush = isPowerSurgeActive(player) ? pointPowerPushMultiplier[powerIndex] : 1;
  const flapMult = feverFlap * powerFlap;
  const pushMult = feverPush * powerPush;

  if (direction === "up") {
    player.velocityY = (flapStrength - 0.4) * flapMult;
  }

  if (direction === "left") {
    player.velocityY = sideFlapStrength * flapMult;
    player.velocityX -= horizontalPush * pushMult;
  }

  if (direction === "right") {
    player.velocityY = sideFlapStrength * flapMult;
    player.velocityX += horizontalPush * pushMult;
  }

  if (direction === "down") {
    player.velocityY = Math.max(player.velocityY, 7.5);
  }

  if (direction === "up-left") {
    player.velocityY = flapStrength * 0.92 * flapMult;
    player.velocityX -= horizontalPush * 0.82 * pushMult;
  }

  if (direction === "up-right") {
    player.velocityY = flapStrength * 0.92 * flapMult;
    player.velocityX += horizontalPush * 0.82 * pushMult;
  }

  if (direction === "down-left") {
    player.velocityY = Math.max(player.velocityY, 6.2);
    player.velocityX -= horizontalPush * 0.82 * pushMult;
  }

  if (direction === "down-right") {
    player.velocityY = Math.max(player.velocityY, 6.2);
    player.velocityX += horizontalPush * 0.82 * pushMult;
  }
}

function updateWind(room, roomCode) {
  const now = Date.now();
  if (!room.wind) {
    room.wind = { active: false, direction: 1, strength: 0, endAt: 0 };
  }

  if (room.wind.active && now >= room.wind.endAt) {
    room.wind.active = false;
    room.wind.strength = 0;
    io.to(roomCode).emit("windGustEnded", {});
  }

  if (!room.wind.active) {
    const mutator = getRoundMutator(room);
    const interval = windGustIntervalMs * (mutator.speedMult > 1.08 ? 0.88 : 1);
    if (now - (room.lastWindGustAt || 0) >= interval) {
      room.wind.active = true;
      room.wind.direction = Math.random() > 0.5 ? 1 : -1;
      room.wind.strength = windGustForceMin + Math.random() * (windGustForceMax - windGustForceMin);
      room.wind.endAt = now + windGustDurationMs;
      room.lastWindGustAt = now;
      io.to(roomCode).emit("windGustStarted", {
        direction: room.wind.direction,
        strength: room.wind.strength,
        durationMs: windGustDurationMs
      });
    }
  }
}

function updatePlayerPhysics(room) {
  const speedMultiplier = getSpeedMultiplier(room);
  const players = Object.values(room.players);
  const now = Date.now();
  const wind = room.wind && room.wind.active ? room.wind : null;

  for (const player of players) {
    if (!player.alive) continue;

    player.aliveTimeMs = (player.aliveTimeMs || 0) + (1000 / 60);

    const extraGravity = (room.curse && room.curse.state === 'attached' && room.curse.carrierId === player.id)
      ? curseExtraGravity : 0;
    player.velocityY += (gravity + extraGravity) * speedMultiplier;
    player.y += (player.velocityY + player.diveBurst) * speedMultiplier;
    player.diveBurst *= diveBurstDecay;

    if (player.diveBurst < diveBurstMinimum) {
      player.diveBurst = 0;
    }

    player.x += player.velocityX * speedMultiplier;
    if (wind) {
      player.velocityX += wind.direction * wind.strength * speedMultiplier;
    }
    player.velocityX *= horizontalDrag;

    if (!isSuddenDeath(room) && player.health < player.maxHealth && now - (player.lastDamageTime || 0) > playerHealthRegenDelay) {
      player.health = Math.min(player.maxHealth, player.health + (playerHealthRegenPerSecond / 60) * speedMultiplier);
    }

    keepPlayerInsideArena(player);
  }
}

function updateObstacles(room, roomCode) {
  const speedMultiplier = getSpeedMultiplier(room);
  const comboMilestones = [3, 6, 9];

  for (const obstacle of room.obstacles) {
    obstacle.x -= obstacleSpeed * speedMultiplier;
  }

  const alivePlayers = Object.values(room.players).filter(p => p.alive);
  for (const obstacle of room.obstacles) {
    for (const player of alivePlayers) {
      if (!player.scoredObstacleIds) player.scoredObstacleIds = {};
      if (!player.nearMissObstacleIds) player.nearMissObstacleIds = {};

      if (!player.nearMissObstacleIds[obstacle.id]) {
        const overlapX = player.x + birdSize > obstacle.x && player.x < obstacle.x + obstacle.width;
        if (overlapX) {
          const birdTop = player.y;
          const birdBottom = player.y + birdSize;
          const gapTop = obstacle.topHeight;
          const gapBottom = gameHeight - obstacle.bottomHeight;
          const insideGap = birdTop >= gapTop && birdBottom <= gapBottom;

          if (insideGap) {
            const topClearance = birdTop - gapTop;
            const bottomClearance = gapBottom - birdBottom;
            const minClearance = Math.min(topClearance, bottomClearance);

            if (minClearance <= obstacleNearMissThreshold) {
              awardPoints(player, obstacleNearMissPoints, room, roomCode);
              player.nearMissObstacleIds[obstacle.id] = true;
              ensureRoundStats(room, player.id).nearMisses += 1;
            }
          }
        }
      }

      if (player.scoredObstacleIds[obstacle.id]) continue;

      if (obstacle.x + obstacle.width < player.x) {
        const comboBonus = Math.min((player.passCombo || 0) * 2, obstaclePassComboBonusCap);
        const phaseBonus = isSuddenDeath(room) ? obstaclePassSuddenDeathBonus : 0;
        awardEventPoints(room, roomCode, player, obstaclePassBasePoints + comboBonus + phaseBonus, {
          feverEligible: true
        });
        player.passCombo = (player.passCombo || 0) + 1;
        ensureRoundStats(room, player.id).comboPeak = Math.max(
          ensureRoundStats(room, player.id).comboPeak,
          player.passCombo || 0
        );
        for (const tier of comboMilestones) {
          if ((player.passCombo || 0) >= tier && (player.comboMilestoneHit || 0) < tier) {
            player.comboMilestoneHit = tier;
            emitArenaCallout(roomCode, "power", player.name + " COMBO x" + tier + "!", player.id);
          }
        }
        player.scoredObstacleIds[obstacle.id] = true;
      }
    }
  }

  while (room.obstacles.length > 0 && room.obstacles[0].x < -obstacleWidth) {
    room.obstacles.shift();
    room.obstaclesPassed++;

    const lastObstacle = room.obstacles[room.obstacles.length - 1];
    room.obstacles.push(createObstacle(lastObstacle.x + obstacleSpacing, room));
  }
}

function playerHitsBoundary(player) {
  return player.y < vineDepth || player.y > gameHeight - birdSize - grassDepth;
}

function playerHitsObstacle(player, obstacle) {
  const birdLeft = player.x;
  const birdRight = player.x + birdSize;
  const birdTop = player.y;
  const birdBottom = player.y + birdSize;

  const obstacleLeft = obstacle.x;
  const obstacleRight = obstacle.x + obstacle.width;

  const overlapsHorizontally =
    birdRight > obstacleLeft &&
    birdLeft < obstacleRight;

  const hitsTop =
    overlapsHorizontally &&
    birdTop < obstacle.topHeight;

  const hitsBottom =
    overlapsHorizontally &&
    birdBottom > gameHeight - obstacle.bottomHeight;

  return hitsTop || hitsBottom;
}

function resolvePlayerVsRect(player, rectLeft, rectTop, rectRight, rectBottom) {
  const birdLeft = player.x;
  const birdRight = player.x + birdSize;
  const birdTop = player.y;
  const birdBottom = player.y + birdSize;

  if (birdRight <= rectLeft || birdLeft >= rectRight || birdBottom <= rectTop || birdTop >= rectBottom) {
    return false;
  }

  const pushLeft = rectLeft - birdRight;
  const pushRight = rectRight - birdLeft;
  const pushUp = rectTop - birdBottom;
  const pushDown = rectBottom - birdTop;

  const candidates = [
    { axis: "x", value: pushLeft },
    { axis: "x", value: pushRight },
    { axis: "y", value: pushUp },
    { axis: "y", value: pushDown }
  ];

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (Math.abs(candidates[i].value) < Math.abs(best.value)) {
      best = candidates[i];
    }
  }

  const separation = 4;

  if (best.axis === "x") {
    player.x += best.value + (best.value < 0 ? -separation : separation);
    if (best.value < 0) {
      player.velocityX = Math.min(player.velocityX, -5.0);
    } else {
      player.velocityX = Math.max(player.velocityX, 5.0);
    }
  } else {
    player.y += best.value + (best.value < 0 ? -separation : separation);
    if (best.value < 0) {
      player.velocityY = Math.min(player.velocityY, -5.6);
    } else {
      player.velocityY = Math.max(player.velocityY, 5.6);
    }
  }

  return true;
}

function resolvePlayerObstacleCollision(player, obstacle) {
  const left = obstacle.x;
  const right = obstacle.x + obstacle.width;

  const topRectBottom = obstacle.topHeight;
  const bottomRectTop = gameHeight - obstacle.bottomHeight;

  const hitTop = resolvePlayerVsRect(player, left, 0, right, topRectBottom);
  const hitBottom = resolvePlayerVsRect(player, left, bottomRectTop, right, gameHeight);
  return hitTop || hitBottom;
}

function applyObstacleDeaths(room, roomCode) {
  const players = Object.values(room.players);
  const now = Date.now();

  for (const player of players) {
    if (!player.alive) continue;

    const shielded = player.shieldExpiry !== null && now < player.shieldExpiry;
    const clutchReady = hasClutchImmunity(player, now);
    const damage = isSuddenDeath(room) ? obstacleDamageSuddenDeath : obstacleDamage;

    if (now - (player.lastObstacleDamageTime || 0) < obstacleDamageCooldownMs) {
      continue;
    }

    if (playerHitsBoundary(player)) {
      if (clutchReady && !shielded) {
        player.clutchImmunityCharges = Math.max(0, (player.clutchImmunityCharges || 0) - 1);
        player.clutchImmunityExpiry = 0;
        io.to(roomCode).emit("shieldBlock", {});
        emitArenaCallout(roomCode, "power", player.name + " CLUTCH SAVE!", player.id);
        player.lastObstacleDamageTime = now;
        continue;
      }

      if (!shielded) {
        const wasAlive = player.alive;
        dealDamage(player, damage, room, now);
        awardCollisionToObstacleBonus(room, player, now, wasAlive && !player.alive);
        player.lastObstacleDamageTime = now;
      }
      continue;
    }

    for (const obstacle of room.obstacles) {
      if (!playerHitsObstacle(player, obstacle)) continue;

      const collided = resolvePlayerObstacleCollision(player, obstacle);
      if (collided) {
        keepPlayerInsideArena(player);
      }

      if (clutchReady && !shielded) {
        player.clutchImmunityCharges = Math.max(0, (player.clutchImmunityCharges || 0) - 1);
        player.clutchImmunityExpiry = 0;
        io.to(roomCode).emit("shieldBlock", {});
        emitArenaCallout(roomCode, "power", player.name + " CLUTCH SAVE!", player.id);
        player.lastObstacleDamageTime = now;
        break;
      }

      if (!shielded) {
        const wasAlive = player.alive;
        dealDamage(player, damage, room, now);
        awardCollisionToObstacleBonus(room, player, now, wasAlive && !player.alive);
        player.lastObstacleDamageTime = now;
      }
      break;
    }
  }
}

function applyPlayerCollisions(room, roomCode) {
  const players = Object.values(room.players).filter(player => player.alive);
  const now = Date.now();
  const mutator = getRoundMutator(room);
  const collisionMult = mutator.collisionMult || 1;

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];

      if (now - Math.max(a.lastCollisionTime || 0, b.lastCollisionTime || 0) < 450) {
        continue;
      }

      const aCenterX = a.x + birdSize / 2;
      const aCenterY = a.y + birdSize / 2;
      const bCenterX = b.x + birdSize / 2;
      const bCenterY = b.y + birdSize / 2;

      const dx = bCenterX - aCenterX;
      const dy = bCenterY - aCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 0 && distance < birdSize) {
        const normalX = dx / distance;
        const normalY = dy / distance;

        const aSpeed = Math.sqrt(a.velocityX * a.velocityX + a.velocityY * a.velocityY);
        const bSpeed = Math.sqrt(b.velocityX * b.velocityX + b.velocityY * b.velocityY);

        let attacker = a;
        let victim = b;
        let directionX = normalX;
        let directionY = normalY;

        if (bSpeed > aSpeed) {
          attacker = b;
          victim = a;
          directionX = -normalX;
          directionY = -normalY;
        }

        const victimShielded = victim.shieldExpiry !== null && now < victim.shieldExpiry;
        const attackerShielded = attacker.shieldExpiry !== null && now < attacker.shieldExpiry;
        const attackerRamBoosted = attacker.ramBoostExpiry !== null && now < attacker.ramBoostExpiry;

        if (victimShielded || attackerShielded) {
          io.to(roomCode).emit("shieldBlock", {});
        }

        a.lastCollisionTime = now;
        b.lastCollisionTime = now;

        const knockbackMult = attackerRamBoosted ? ramBoostKnockbackMultiplier : 1;
        const recoilMult    = attackerRamBoosted ? ramBoostRecoilMultiplier    : 1;
        const victimResistanceMult = getKnockbackMultiplier(victim, now);
        const bounty = getBountyState(room);
        const bountyTargetHit = bounty && bounty.targetId === victim.id;
        const pointSteal = collisionPointSteal + (attackerRamBoosted ? collisionPointStealBonus : 0) + (isSuddenDeath(room) ? 1 : 0) + (bountyTargetHit ? bounty.bonus : 0);

        // ── Stomp hit: hard downward hit steals extra points and launches victim ──
        const attackerDiving = attacker.velocityY > 7;
        const attackerAbove  = (attacker.y + birdSize / 2) < (victim.y + birdSize / 2);
        if (attackerDiving && attackerAbove && !victimShielded) {
          victim.x += directionX * victimKnockback * 1.25 * victimResistanceMult * collisionMult;
          victim.y += directionY * victimKnockback * 1.25 * victimResistanceMult * collisionMult;
          victim.velocityX += directionX * 7 * victimResistanceMult * collisionMult;
          victim.velocityY += directionY * 7 * victimResistanceMult * collisionMult;
          keepPlayerInsideArena(victim);
          attacker.velocityY = flapStrength * 0.7;  // bounce attacker up
          const stolen = Math.min(victim.points || 0, pointSteal + 1);
          if (stolen > 0) {
            victim.points = Math.max(0, (victim.points || 0) - stolen);
            awardPoints(attacker, stolen, room, roomCode, { now });
            if (bountyTargetHit) {
              emitArenaCallout(roomCode, "bounty", attacker.name + " CASHES THE BOUNTY!", attacker.id);
            }
          }
          victim.lastHitByPlayerId = attacker.id;
          victim.lastHitByTime = now;
          ensureRoundStats(room, attacker.id).hitsLanded += 1;
          io.to(roomCode).emit("battleHit", { attackerId: attacker.id, victimId: victim.id, kind: "stomp" });
          continue;
        }
        // ─────────────────────────────────────────────────────────────────────

        if (!victimShielded) {
          const cursedVictimMult = (room.curse && room.curse.state === 'attached' && room.curse.carrierId === victim.id)
            ? (1 + curseKnockbackBonus) : 1;
          victim.x += directionX * victimKnockback * knockbackMult * cursedVictimMult * victimResistanceMult * collisionMult;
          victim.y += directionY * victimKnockback * knockbackMult * cursedVictimMult * victimResistanceMult * collisionMult;
          victim.velocityX += directionX * 5 * knockbackMult * cursedVictimMult * victimResistanceMult * collisionMult;
          victim.velocityY += directionY * 5 * knockbackMult * cursedVictimMult * victimResistanceMult * collisionMult;
          const stolen = Math.min(victim.points || 0, pointSteal);
          if (stolen > 0) {
            victim.points = Math.max(0, (victim.points || 0) - stolen);
            awardPoints(attacker, stolen, room, roomCode, { now });
            if (bountyTargetHit) {
              emitArenaCallout(roomCode, "bounty", attacker.name + " CASHES THE BOUNTY!", attacker.id);
            }
          }
          victim.lastHitByPlayerId = attacker.id;
          victim.lastHitByTime = now;
          ensureRoundStats(room, attacker.id).hitsLanded += 1;
          keepPlayerInsideArena(victim);
        }

        if (!attackerShielded) {
          attacker.x -= directionX * attackerRecoil * recoilMult;
          attacker.y -= directionY * attackerRecoil * recoilMult;
          attacker.velocityX -= directionX * 2 * recoilMult;
          attacker.velocityY -= directionY * 2 * recoilMult;
          keepPlayerInsideArena(attacker);
        }

        if (attackerRamBoosted) {
          io.to(roomCode).emit("ramBoostHit", { attackerId: attacker.id });
        }

        io.to(roomCode).emit("battleHit", { attackerId: attacker.id, victimId: victim.id, kind: attackerRamBoosted ? "ram" : "collision" });
      }
    }
  }
}

function getAlivePlayers(room) {
  return Object.values(room.players).filter(player => player.alive);
}

function pickupOverlapsPlayer(player, pickup) {
  return (
    player.x < pickup.x + pickup.size &&
    player.x + birdSize > pickup.x &&
    player.y < pickup.y + pickup.size &&
    player.y + birdSize > pickup.y
  );
}

function createShieldPickup(room) {
  const mid = room.obstacles[Math.floor(room.obstacles.length / 2)];
  let y;
  if (mid) {
    const gapTop = mid.topHeight + shieldPickupSize;
    const gapBottom = gameHeight - mid.bottomHeight - shieldPickupSize * 2;
    y = gapTop + Math.random() * Math.max(0, gapBottom - gapTop);
  } else {
    y = gameHeight / 2 - shieldPickupSize / 2;
  }
  return {
    id: Math.random().toString(36).slice(2),
    x: gameWidth,
    y,
    size: shieldPickupSize,
    type: "shield"
  };
}

function createShockwavePickup(room) {
  const mid = room.obstacles[Math.floor(room.obstacles.length / 2)];
  let y;
  if (mid) {
    const gapTop = mid.topHeight + shockwavePickupSize;
    const gapBottom = gameHeight - mid.bottomHeight - shockwavePickupSize * 2;
    y = gapTop + Math.random() * Math.max(0, gapBottom - gapTop);
  } else {
    y = gameHeight / 2 - shockwavePickupSize / 2;
  }
  return {
    id: Math.random().toString(36).slice(2),
    x: gameWidth,
    y,
    size: shockwavePickupSize,
    type: "shockwave"
  };
}

function createRamBoostPickup(room) {
  const mid = room.obstacles[Math.floor(room.obstacles.length / 2)];
  let y;
  if (mid) {
    const gapTop = mid.topHeight + ramBoostPickupSize;
    const gapBottom = gameHeight - mid.bottomHeight - ramBoostPickupSize * 2;
    y = gapTop + Math.random() * Math.max(0, gapBottom - gapTop);
  } else {
    y = gameHeight / 2 - ramBoostPickupSize / 2;
  }
  return {
    id: Math.random().toString(36).slice(2),
    x: gameWidth,
    y,
    size: ramBoostPickupSize,
    type: "ramboost"
  };
}

function createCrownPickup(room) {
  const mid = room.obstacles[Math.floor(room.obstacles.length / 2)];
  let y;
  if (mid) {
    const gapTop = mid.topHeight + crownPickupSize;
    const gapBottom = gameHeight - mid.bottomHeight - crownPickupSize * 2;
    y = gapTop + Math.random() * Math.max(0, gapBottom - gapTop);
  } else {
    y = gameHeight / 2 - crownPickupSize / 2;
  }

  return {
    id: Math.random().toString(36).slice(2),
    x: gameWidth,
    y,
    size: crownPickupSize,
    type: "crown"
  };
}

function createGoldenTarget() {
  return {
    x: gameWidth + goldenTargetSize,
    y: randomNumber(vineDepth + 40, gameHeight - grassDepth - goldenTargetSize - 40),
    size: goldenTargetSize,
    velocityX: -goldenTargetTravelSpeed,
    velocityY: Math.random() > 0.5 ? goldenTargetVerticalSpeed : -goldenTargetVerticalSpeed
  };
}

function updateGoldenTarget(room, roomCode) {
  const now = Date.now();
  const speedMultiplier = getSpeedMultiplier(room);
  const mutator = getRoundMutator(room);
  const goldenInterval = goldenTargetSpawnInterval * (mutator.goldenSpawnMult || 1);

  if (!room.goldenTarget && now - (room.lastGoldenTargetSpawn || 0) >= goldenInterval) {
    room.goldenTarget = createGoldenTarget();
    room.lastGoldenTargetSpawn = now;
    emitArenaCallout(roomCode, "goldrush", "GOLD RUSH!", null);
  }

  if (!room.goldenTarget) return;

  room.goldenTarget.x += room.goldenTarget.velocityX * speedMultiplier;
  room.goldenTarget.y += room.goldenTarget.velocityY * speedMultiplier;

  if (room.goldenTarget.y <= vineDepth + 12 || room.goldenTarget.y >= gameHeight - grassDepth - room.goldenTarget.size - 12) {
    room.goldenTarget.velocityY *= -1;
  }

  const alivePlayers = getAlivePlayers(room);
  for (const player of alivePlayers) {
    const overlaps =
      player.x < room.goldenTarget.x + room.goldenTarget.size &&
      player.x + birdSize > room.goldenTarget.x &&
      player.y < room.goldenTarget.y + room.goldenTarget.size &&
      player.y + birdSize > room.goldenTarget.y;

    if (overlaps) {
      awardEventPoints(room, roomCode, player, getGoldenTargetPointValue(room), {
        now,
        feverEligible: true,
        calloutType: "jackpot",
        calloutText: player.name + " JACKPOT!"
      });
      restoreHealth(player, 10);
      room.goldenTarget = null;
      room.lastGoldenTargetSpawn = now;
      return;
    }
  }

  if (room.goldenTarget.x + room.goldenTarget.size < -20) {
    room.goldenTarget = null;
    room.lastGoldenTargetSpawn = now;
  }
}

function updatePickups(room, roomCode) {
  const speedMultiplier = getSpeedMultiplier(room);
  const now = Date.now();
  const mutator = getRoundMutator(room);
  const pickupInterval = pickupSpawnInterval * (mutator.pickupSpawnMult || 1);

  for (const pickup of room.pickups) {
    pickup.x -= obstacleSpeed * speedMultiplier;
  }

  room.pickups = room.pickups.filter(p => p.x + p.size > 0);

  const alivePlayers = Object.values(room.players).filter(p => p.alive);
  for (const player of alivePlayers) {
    for (let i = room.pickups.length - 1; i >= 0; i--) {
      const pickup = room.pickups[i];
      if (pickupOverlapsPlayer(player, pickup)) {
        if (pickup.type === "shield") {
          player.shieldExpiry = now + shieldDuration;
          restoreHealth(player, 15);
          awardPoints(player, 5, room, roomCode, { now });
        } else if (pickup.type === "ramboost") {
          player.ramBoostExpiry = now + ramBoostDuration;
          restoreHealth(player, 12);
          awardPoints(player, 7, room, roomCode, { now });
        } else if (pickup.type === "shockwave") {
          awardPoints(player, 6, room, roomCode, { now });
          const collectorCX = player.x + birdSize / 2;
          const collectorCY = player.y + birdSize / 2;
          for (const other of alivePlayers) {
            if (other.id === player.id) continue;
            const dx = (other.x + birdSize / 2) - collectorCX;
            const dy = (other.y + birdSize / 2) - collectorCY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < shockwaveRadius) {
              const falloff = 1 - dist / shockwaveRadius;
              const nx = dist > 0 ? dx / dist : 0;
              const ny = dist > 0 ? dy / dist : -1;
              const resistanceMult = getKnockbackMultiplier(other, now);
              other.x += nx * shockwavePushStrength * falloff * resistanceMult;
              other.y += ny * shockwavePushStrength * falloff * resistanceMult;
              other.velocityX += nx * shockwavePushStrength * falloff * 0.25 * resistanceMult;
              other.velocityY += ny * shockwavePushStrength * falloff * 0.25 * resistanceMult;
              keepPlayerInsideArena(other);
            }
          }
          io.to(roomCode).emit("shockwaveTriggered", {
            x: collectorCX,
            y: collectorCY
          });
        } else if (pickup.type === "crown") {
          awardEventPoints(room, roomCode, player, getCrownPointValue(room), {
            now,
            feverEligible: true,
            calloutType: "crown",
            calloutText: player.name + " CROWN SNATCH!"
          });
          restoreHealth(player, crownPickupHeal);
        }
        room.pickups.splice(i, 1);
        io.to(roomCode).emit("pickupCollected", { playerId: player.id, type: pickup.type });
      }
    }
  }

  for (const player of Object.values(room.players)) {
    if (player.shieldExpiry !== null && now > player.shieldExpiry) {
      player.shieldExpiry = null;
    }
    if (player.ramBoostExpiry !== null && now > player.ramBoostExpiry) {
      player.ramBoostExpiry = null;
    }
  }

  if (room.pickups.length < maxPickups && now - room.lastPickupSpawn > pickupInterval) {
    const roll = Math.random();
    let nextPickup;
    if (roll < 0.25) {
      nextPickup = createShieldPickup(room);
    } else if (roll < 0.5) {
      nextPickup = createShockwavePickup(room);
    } else if (roll < 0.75) {
      nextPickup = createRamBoostPickup(room);
    } else {
      nextPickup = createCrownPickup(room);
    }
    room.pickups.push(nextPickup);
    room.lastPickupSpawn = now;
  }
}

function updateMonster(room, roomCode) {
  const now = Date.now();
  const mutator = getRoundMutator(room);

  // If the current monster has scrolled off screen, clear it and reset the cooldown
  const existingMonster = room.obstacles.find(o => o.isMonster);
  if (existingMonster && existingMonster.x + existingMonster.width < 0) {
    existingMonster.isMonster = false;
    room.lastMonsterSpawn = now;
    return;
  }

  // Try to spawn a new monster once the cooldown has elapsed
  if (!existingMonster && now - room.lastMonsterSpawn > monsterSpawnInterval) {
    // Pick a pipe that is on-screen but not yet crowding the players
    const candidates = room.obstacles.filter(
      o => o.x > gameWidth * 0.35 && o.x < gameWidth
    );
    if (candidates.length > 0) {
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      chosen.isMonster = true;
      chosen.monsterStyle = randomChoice(monsterBoxingStyles);
      chosen.topPunchStart = 0;
      chosen.topPunchUntil = 0;
      chosen.bottomPunchStart = 0;
      chosen.bottomPunchUntil = 0;
      chosen.topPunchReach = monsterArmReachMin;
      chosen.bottomPunchReach = monsterArmReachMin;
      chosen.lastMonsterPunchAt = 0;
      chosen.topNextPunchAt = 0;
      chosen.bottomNextPunchAt = 0;
      chosen.topLastBigHitAt = 0;
      chosen.bottomLastBigHitAt = 0;
      chosen.topBigPunchWindupStart = 0;
      chosen.topBigPunchWindupUntil = 0;
      chosen.topBigPunchTargetId = null;
      chosen.bottomBigPunchWindupStart = 0;
      chosen.bottomBigPunchWindupUntil = 0;
      chosen.bottomBigPunchTargetId = null;
      room.lastMonsterSpawn = now;
      io.to(roomCode).emit("monsterActivated");
    }
    return;
  }

  if (!existingMonster) return;

  // Chase the nearest alive player by extending the closest pipe wall toward them.
  // "Nearest" is re-evaluated every tick so the target switches as players move.
  const alivePlayers = getAlivePlayers(room);
  if (alivePlayers.length === 0) return;

  const monsterCenterX = existingMonster.x + obstacleWidth / 2;
  const nearest = alivePlayers.reduce((best, p) => {
    const dA = Math.abs((p.x + birdSize / 2) - monsterCenterX);
    const dB = Math.abs((best.x + birdSize / 2) - monsterCenterX);
    return dA < dB ? p : best;
  });

  const speedMultiplier = getSpeedMultiplier(room);
  const aliveCount = alivePlayers.length;
  const pressureMult = aliveCount <= 2 ? 0.92 : aliveCount >= 5 ? 1.06 : 1;
  const step = monsterChaseSpeed * speedMultiplier * (mutator.monsterChaseMult || 1) * pressureMult;

  const playerCenterY = nearest.y + birdSize / 2;
  // Y coordinate of each pipe's threatening face (the edge that kills)
  const topFaceY    = existingMonster.topHeight;                    // bottom face of top pipe
  const bottomFaceY = gameHeight - existingMonster.bottomHeight;    // top face of bottom pipe

  const distToTop    = playerCenterY - topFaceY;    // positive = player is below the top face
  const distToBottom = bottomFaceY - playerCenterY; // positive = player is above the bottom face

  if (distToTop <= distToBottom) {
    // Player is closer to the top wall — extend the top pipe downward toward them
    const newTop = existingMonster.topHeight + step;
    if (gameHeight - newTop - existingMonster.bottomHeight >= monsterMinGap) {
      existingMonster.topHeight = newTop;
    }
  } else {
    // Player is closer to the bottom wall — extend the bottom pipe upward toward them
    const newBottom = existingMonster.bottomHeight + step;
    if (gameHeight - existingMonster.topHeight - newBottom >= monsterMinGap) {
      existingMonster.bottomHeight = newBottom;
    }
  }

  const currentGapSize = Math.max(1, bottomFaceY - topFaceY);
  const dynamicPunchRange = Math.min(
    monsterPunchRange,
    Math.max(monsterPunchDynamicMinRange, Math.round((currentGapSize - birdSize - monsterPunchSafeCenterPadding) / 2))
  );
  const closeXRange = obstacleWidth / 2 + monsterPunchRange + 12;

  function selectVictimForSide(side, rangeBonus) {
    let best = null;
    const faceY = side === "top" ? topFaceY : bottomFaceY;

    for (const player of alivePlayers) {
      if (!player.alive) continue;
      if (now - (player.lastMonsterPunchTime || 0) < monsterPunchVictimGraceMs) continue;

      const playerCenterX = player.x + birdSize / 2;
      const playerCenterY = player.y + birdSize / 2;
      const dx = Math.abs(playerCenterX - monsterCenterX);
      if (dx > closeXRange) continue;

      const topDist = Math.abs(playerCenterY - topFaceY);
      const bottomDist = Math.abs(playerCenterY - bottomFaceY);
      if (side === "top" && topDist > bottomDist + 4) continue;
      if (side === "bottom" && bottomDist > topDist + 4) continue;

      const sideDist = Math.abs(playerCenterY - faceY);
      if (sideDist > dynamicPunchRange + 6 + (rangeBonus || 0)) continue;

      const score = sideDist * 1.35 + dx * 0.2;
      if (!best || score < best.score) {
        best = { player, playerCenterX, playerCenterY, faceY, sideDist, score };
      }
    }

    return best;
  }

  function performMonsterPunch(side, victimData, isBigHit) {
    if (!victimData || !victimData.player || !victimData.player.alive) return false;

    const player = victimData.player;
    const shielded = player.shieldExpiry !== null && now < player.shieldExpiry;
    const clutchReady = hasClutchImmunity(player, now);
    let damageBlocked = false;

    if (clutchReady && !shielded) {
      player.clutchImmunityCharges = Math.max(0, (player.clutchImmunityCharges || 0) - 1);
      player.clutchImmunityExpiry = 0;
      io.to(roomCode).emit("shieldBlock", {});
      damageBlocked = true;
    }

    if (shielded) {
      io.to(roomCode).emit("shieldBlock", {});
      damageBlocked = true;
    }

    const hitKnockbackMult = isBigHit ? monsterBigHitKnockbackMultiplier : 1;
    const horizontalDir = victimData.playerCenterX >= monsterCenterX ? 1 : -1;
    const strengthMult = damageBlocked ? 0.55 : 1;
    player.velocityX += horizontalDir * monsterPunchKnockback * 0.56 * hitKnockbackMult * strengthMult;
    player.velocityY += (side === "top" ? 1 : -1) * monsterPunchKnockback * 0.4 * hitKnockbackMult * strengthMult;
    keepPlayerInsideArena(player);

    if (!damageBlocked) {
      const baseDamage = isSuddenDeath(room) ? monsterPunchDamage + 2 : monsterPunchDamage;
      const punchDamage = isBigHit ? Math.round(baseDamage * monsterBigHitDamageMultiplier) : baseDamage;
      dealDamage(player, punchDamage, room, now);
      ensureRoundStats(room, player.id).monsterJabsTaken += isBigHit ? 2 : 1;
      player.lastObstacleDamageTime = now;
    }

    player.lastMonsterPunchTime = now;
    existingMonster.lastMonsterPunchAt = now;

    const reachPadding = isBigHit ? 26 : 16;
    const reach = Math.max(
      monsterArmReachMin,
      Math.min(monsterArmReachMax, Math.round(Math.abs(victimData.playerCenterY - victimData.faceY) + reachPadding))
    );

    if (side === "top") {
      existingMonster.topPunchStart = now;
      existingMonster.topPunchUntil = now + (isBigHit ? 340 : 260);
      existingMonster.topPunchReach = reach;
      existingMonster.topBigPunchWindupStart = 0;
      existingMonster.topBigPunchWindupUntil = 0;
      existingMonster.topBigPunchTargetId = null;
      existingMonster.topNextPunchAt = now + (isBigHit ? monsterPlantBigHitCooldownMs : monsterPlantHitCooldownMs);
      if (isBigHit) existingMonster.topLastBigHitAt = now;
    } else {
      existingMonster.bottomPunchStart = now;
      existingMonster.bottomPunchUntil = now + (isBigHit ? 340 : 260);
      existingMonster.bottomPunchReach = reach;
      existingMonster.bottomBigPunchWindupStart = 0;
      existingMonster.bottomBigPunchWindupUntil = 0;
      existingMonster.bottomBigPunchTargetId = null;
      existingMonster.bottomNextPunchAt = now + (isBigHit ? monsterPlantBigHitCooldownMs : monsterPlantHitCooldownMs);
      if (isBigHit) existingMonster.bottomLastBigHitAt = now;
    }

    io.to(roomCode).emit("monsterPunch", {
      playerId: player.id,
      x: monsterCenterX,
      y: victimData.faceY,
      from: side,
      bigHit: Boolean(isBigHit)
    });

    return true;
  }

  function resolveBigHitWindup(side) {
    const startKey = side === "top" ? "topBigPunchWindupStart" : "bottomBigPunchWindupStart";
    const untilKey = side === "top" ? "topBigPunchWindupUntil" : "bottomBigPunchWindupUntil";
    const targetKey = side === "top" ? "topBigPunchTargetId" : "bottomBigPunchTargetId";
    const nextKey = side === "top" ? "topNextPunchAt" : "bottomNextPunchAt";

    const windupUntil = existingMonster[untilKey] || 0;
    if (windupUntil <= 0 || now < windupUntil) return false;

    const targetId = existingMonster[targetKey];
    let selected = null;
    if (targetId) {
      const locked = alivePlayers.find(p => p.id === targetId);
      if (locked) {
        const lockData = selectVictimForSide(side, 8);
        if (lockData && lockData.player.id === locked.id) {
          selected = lockData;
        }
      }
    }

    if (!selected) {
      selected = selectVictimForSide(side, 8);
    }

    const hitLanded = performMonsterPunch(side, selected, true);
    if (!hitLanded) {
      existingMonster[startKey] = 0;
      existingMonster[untilKey] = 0;
      existingMonster[targetKey] = null;
      existingMonster[nextKey] = now + Math.max(850, monsterPunchCooldownMs);
    }
    return hitLanded;
  }

  function maybeStartOrApplyHit(side) {
    const nextKey = side === "top" ? "topNextPunchAt" : "bottomNextPunchAt";
    const startKey = side === "top" ? "topBigPunchWindupStart" : "bottomBigPunchWindupStart";
    const untilKey = side === "top" ? "topBigPunchWindupUntil" : "bottomBigPunchWindupUntil";
    const targetKey = side === "top" ? "topBigPunchTargetId" : "bottomBigPunchTargetId";
    const bigLastKey = side === "top" ? "topLastBigHitAt" : "bottomLastBigHitAt";
    const faceY = side === "top" ? topFaceY : bottomFaceY;

    if ((existingMonster[untilKey] || 0) > 0) {
      resolveBigHitWindup(side);
      return;
    }

    if (now < (existingMonster[nextKey] || 0)) return;

    const victimData = selectVictimForSide(side, 0);
    if (!victimData) return;

    const bigReadyByTime = now - (existingMonster[bigLastKey] || 0) >= monsterBigHitMinIntervalMs;
    const canPrimeBigHit = bigReadyByTime && Math.random() < monsterBigHitChance;

    if (canPrimeBigHit) {
      existingMonster[startKey] = now;
      existingMonster[untilKey] = now + monsterBigHitWindupMs;
      existingMonster[targetKey] = victimData.player.id;
      existingMonster[nextKey] = existingMonster[untilKey] + Math.max(200, Math.round(monsterPunchCooldownMs * 0.35));
      if (side === "top") {
        existingMonster.topPunchReach = Math.max(existingMonster.topPunchReach || monsterArmReachMin, monsterArmReachMin + 10);
      } else {
        existingMonster.bottomPunchReach = Math.max(existingMonster.bottomPunchReach || monsterArmReachMin, monsterArmReachMin + 10);
      }
      io.to(roomCode).emit("monsterBigHitWindup", {
        from: side,
        x: monsterCenterX,
        y: faceY,
        durationMs: monsterBigHitWindupMs
      });
      return;
    }

    performMonsterPunch(side, victimData, false);
  }

  maybeStartOrApplyHit("top");
  maybeStartOrApplyHit("bottom");
}

const { updateCurse, checkCurseTransfer } = createCurseSystem({
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
});
const roundLifecycle = createRoundLifecycleSystem({
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
});

const {
  setLoopHooks,
  updateGhosts,
  updateSpeedRamp,
  startRoundForRoom,
  endRound,
  checkForRoundEnd
} = roundLifecycle;

const startGameLoop = createStartGameLoop(rooms, {
  updateSpeedRamp,
  updateWind,
  updatePlayerPhysics,
  updateBotAI,
  updateGhosts,
  updateCurse,
  checkCurseTransfer,
  applyPlayerCollisions,
  updateMonster,
  updateObstacles,
  updateGoldenTarget,
  updatePickups,
  applyObstacleDeaths,
  updateSurvivalScoring,
  broadcastGameState,
  checkForRoundEnd
});

setLoopHooks({
  startGameLoop,
  drainWaitingQueue
});

registerSocketHandlers(io, {
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
});

server.listen(PORT, () => {
  console.log(`Bird Royale server running on port ${PORT}`);
});