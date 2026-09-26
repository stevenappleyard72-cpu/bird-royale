const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = {};

const playerColours = ["gold", "dodgerblue", "tomato", "limegreen", "violet", "orange"];
const MAX_PLAYERS = playerColours.length;

const birdSize = 40;
const gameWidth = 420;
const gameHeight = 500;

const playerMaxHealth = 100;
const playerHealthRegenPerSecond = 7;
const playerHealthRegenDelay = 1300;

const roundDurationMs = 85000;
const suddenDeathLeadInMs = 20000;
const suddenDeathStartMs = roundDurationMs - suddenDeathLeadInMs;

const obstaclePassBasePoints = 7;
const obstaclePassComboBonusCap = 8;
const obstaclePassSuddenDeathBonus = 3;
const obstacleNearMissPoints = 1;
const obstacleNearMissThreshold = 8;
const survivalTickMs = 3500;
const survivalTickPoints = 4;
const roundWinnerBonusPoints = 12;
const suddenDeathWinnerBonusPoints = 8;

const obstacleDamage = 22;
const obstacleDamageSuddenDeath = 30;
const obstacleDamageCooldownMs = 500;
const collisionToObstacleWindowMs = 1500;
const collisionForceObstacleBonus = 6;
const collisionForceObstacleKoBonus = 10;

const collisionPointSteal = 3;
const collisionPointStealBonus = 3;

const bountyMinPoints = 18;
const bountyMinLead = 6;
const bountyHitBonus = 2;
const bountyCrashBonus = 4;

const crownPickupSize = 34;
const crownPickupPoints = 16;
const crownSuddenDeathBonusPoints = 10;
const crownPickupHeal = 22;

const goldenTargetSize = 30;
const goldenTargetSpawnInterval = 10000;
const goldenTargetBasePoints = 14;
const goldenTargetSuddenDeathBonus = 6;
const goldenTargetTravelSpeed = 3.4;
const goldenTargetVerticalSpeed = 1.35;

const feverWindowMs = 4200;
const feverDurationMs = 5000;
const feverBonusPoints = 2;
const feverFlapMultiplier = 1.08;
const feverPushMultiplier = 1.12;

const gravity = 0.45;
const flapStrength = -7.8;
const sideFlapStrength = -6.4;
const horizontalPush = 4.8;
const horizontalDrag = 0.92;

const diveBurstStart = 20;
const diveBurstDecay = 0.45;
const diveBurstMinimum = 0.15;

const obstacleWidth = 40;
const obstacleSpacing = 170;
const obstacleSpeed = 2;
const targetObstacleCount = 4;

const victimKnockback = 65;
const attackerRecoil = 15;

const shieldDuration = 6000;
const shieldPickupSize = 28;
const maxPickups = 3;
const pickupSpawnInterval = 4000;

const shockwavePickupSize = 28;
const shockwaveRadius = 300;       // server units — covers most of the arena
const shockwavePushStrength = 98;  // knockback applied to nearby birds

const ramBoostDuration = 5000;
const ramBoostPickupSize = 28;
const ramBoostKnockbackMultiplier = 2.5; // victim flies much further
const ramBoostRecoilMultiplier = 0.4;    // attacker barely bounces back

// ── Ghost Mode ────────────────────────────────────────────────────────────
const GHOST_SPOOK_RADIUS   = 110;  // server units — radius of a ghost spook
const GHOST_SPOOK_FORCE    = 35;   // knockback applied to nearby birds
const GHOST_SPOOK_COOLDOWN = 2500; // ms between ghost spook uses
// ─────────────────────────────────────────────────────────────────────────

// ── Cursed Ball and Chain ──────────────────────────────────────────────────
const curseBallSize              = 20;    // server units (diameter)
const curseSpawnInterval         = 13000; // ms after despawn before respawning
const curseChaseAcceleration     = 0.06;  // steering force per tick at 1× speed
const curseMaxSpeed              = 1.8;   // terminal speed (server units/tick at 1×)
const curseTargetSwitchCooldown  = 1200;  // ms between beam-intercept switches
const curseBeamInterceptDist     = birdSize * 0.65; // how close to beam counts as crossing
const curseExtraGravity          = 0.10;  // extra gravity on carrier per tick
const curseKnockbackBonus        = 0.30;  // 30 % more knockback received while cursed
// ──────────────────────────────────────────────────────────────────────────

const monsterSpawnInterval = 5200;   // ms between monster spawns (from despawn of last)
const monsterChaseSpeed = 0.58;      // vertical units per tick at 1x speed — threatening but dodgeable
const monsterMinGap = 115;           // minimum gap the monster must preserve while tracking
const monsterPunchRange = 74;
const monsterPunchCooldownMs = 850;
const monsterPunchKnockback = 44;
const monsterPunchDamage = 12;
const monsterPunchVictimGraceMs = 950;
const monsterArmReachMin = 26;
const monsterArmReachMax = 92;

const windGustIntervalMs = 11000;
const windGustDurationMs = 2800;
const windGustForceMin = 0.028;
const windGustForceMax = 0.058;

const BOT_ID = "__bot__";
const BOT_NAME = "Bot";
const roundWinRule = "WIN: LAST BIRD STANDING";

const roundMutators = {
  standard: {
    id: "standard",
    name: "Classic Skies",
    description: "Balanced arena flow.",
    speedMult: 1,
    gapTighten: 0,
    collisionMult: 1,
    pickupSpawnMult: 1,
    goldenSpawnMult: 1,
    curseSpawnMult: 1,
    curseChaseMult: 1,
    monsterChaseMult: 1
  },
  turbo: {
    id: "turbo",
    name: "Turbo Draft",
    description: "Everything moves faster. Commit to lines.",
    speedMult: 1.1,
    gapTighten: 8,
    collisionMult: 1.05,
    pickupSpawnMult: 0.9,
    goldenSpawnMult: 0.85,
    curseSpawnMult: 0.85,
    curseChaseMult: 1.06,
    monsterChaseMult: 1.08
  },
  squeeze: {
    id: "squeeze",
    name: "Tight Squeeze",
    description: "Narrow gaps, cleaner flight required.",
    speedMult: 1.04,
    gapTighten: 14,
    collisionMult: 0.96,
    pickupSpawnMult: 1,
    goldenSpawnMult: 1,
    curseSpawnMult: 1,
    curseChaseMult: 1,
    monsterChaseMult: 1.08
  },
  bruiser: {
    id: "bruiser",
    name: "Bumper Birds",
    description: "Hits launch harder and steals matter more.",
    speedMult: 1,
    gapTighten: 0,
    collisionMult: 1.2,
    pickupSpawnMult: 0.92,
    goldenSpawnMult: 0.95,
    curseSpawnMult: 1,
    curseChaseMult: 1,
    monsterChaseMult: 1
  },
  treasure: {
    id: "treasure",
    name: "Treasure Storm",
    description: "High-value targets appear more often.",
    speedMult: 1,
    gapTighten: 0,
    collisionMult: 1,
    pickupSpawnMult: 0.8,
    goldenSpawnMult: 0.7,
    curseSpawnMult: 1.08,
    curseChaseMult: 0.96,
    monsterChaseMult: 1
  }
};
const rotatingMutatorPool = ["turbo", "squeeze", "bruiser", "treasure"];

const pointPowerThresholds = [24, 52, 85];
const pointPowerDurationMs = [3000, 4200, 5800];
const pointPowerFlapMultiplier = [1.06, 1.12, 1.2];
const pointPowerPushMultiplier = [1.08, 1.16, 1.24];
const pointPowerHeal = [8, 12, 18];
const tier3ClutchImmunityMs = 1500;
const clutchKnockbackResistance = 0.25;

const grassDepth = 28;
const vineDepth = 24;

// ─── Leaderboard ──────────────────────────────────────────────────────────────
const LEADERBOARD_FILE = path.join(__dirname, "leaderboard.json");
const MAX_NAME_LENGTH = 20;

function loadHallOfFame() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load leaderboard:", e.message);
  }
  return {};
}

function saveHallOfFame() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(hallOfFame, null, 2));
  } catch (e) {
    console.error("Failed to save leaderboard:", e.message);
  }
}

let hallOfFame = loadHallOfFame();  // { [name]: { points, bestMatchWins, bestRoundWins } }
let hourlyStats = {};               // { [name]: { matchWins, roundWins } }
let activeNames = {};               // { [nameLower]: socketId }
let hourlyResetTime = Date.now() + 3600000;
let waitingQueue = {};              // { [socketId]: { name } } — sockets waiting for any open game

function getLeaderboardData() {
  const hourly = Object.entries(hourlyStats)
    .map(([name, s]) => ({ name, matchWins: s.matchWins, roundWins: s.roundWins }))
    .sort((a, b) => b.matchWins - a.matchWins || b.roundWins - a.roundWins)
    .slice(0, 10);

  const hof = Object.entries(hallOfFame)
    .map(([name, d]) => ({ name, points: d.points, bestMatchWins: d.bestMatchWins, bestRoundWins: d.bestRoundWins }))
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
    const maxMatchWins = Math.max(...entries.map(([, s]) => s.matchWins));
    if (maxMatchWins > 0) {
      entries
        .filter(([, s]) => s.matchWins === maxMatchWins)
        .forEach(([name, stats]) => {
          if (!hallOfFame[name]) hallOfFame[name] = { points: 0, bestMatchWins: 0, bestRoundWins: 0 };
          hallOfFame[name].points++;
          if (stats.matchWins > hallOfFame[name].bestMatchWins ||
              (stats.matchWins === hallOfFame[name].bestMatchWins && stats.roundWins > hallOfFame[name].bestRoundWins)) {
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

setInterval(resetHourlyLeaderboard, 3600000);

// Drain waiting queue into a newly-started room
function drainWaitingQueue(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  for (const [socketId, entry] of Object.entries(waitingQueue)) {
    const realPlayers = Object.keys(room.players).filter(id => id !== BOT_ID).length;
    const totalOccupants = realPlayers + Object.keys(room.spectators || {}).length;
    if (totalOccupants >= MAX_PLAYERS) break;

    const sock = io.sockets.sockets.get(socketId);
    if (!sock) { delete waitingQueue[socketId]; continue; }

    room.spectators[socketId] = { id: socketId, name: entry.name };
    sock.join(roomCode);
    sock.emit("joinedAsSpectator", getGameState(roomCode));
    delete waitingQueue[socketId];
  }
}

// Drain waiting queue into a lobby that hasn't started yet (as real players)
function drainWaitingQueueToLobby(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.started) return;

  for (const [socketId, entry] of Object.entries(waitingQueue)) {
    const playerCount = Object.keys(room.players).filter(id => id !== BOT_ID).length;
    if (playerCount >= MAX_PLAYERS) break;

    const sock = io.sockets.sockets.get(socketId);
    if (!sock) { delete waitingQueue[socketId]; continue; }

    addPlayerToRoom(sock, roomCode, entry.name);
    delete waitingQueue[socketId];
  }

  io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
}

function validateAndRegisterName(socket, playerName) {
  const trimmed = (playerName || "").trim().slice(0, MAX_NAME_LENGTH);
  if (trimmed.length < 2) return { error: "Name must be at least 2 characters." };
  const nameLower = trimmed.toLowerCase();
  if (nameLower === "bot") return { error: '"Bot" is a reserved name.' };
  if (activeNames[nameLower] && activeNames[nameLower] !== socket.id) {
    return { error: `The name "${trimmed}" is already used by an active player.` };
  }
  // Clear any previous name registered to this socket (they may have renamed)
  for (const [key, id] of Object.entries(activeNames)) {
    if (id === socket.id) { delete activeNames[key]; break; }
  }
  activeNames[nameLower] = socket.id;
  return { name: trimmed };
}
// ─────────────────────────────────────────────────────────────────────────

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

function getSpeedMultiplier(room) {
  const base = (room.gameSpeed || 10) / 10;
  const mutator = roundMutators[(room && room.currentMutatorId) || "standard"] || roundMutators.standard;
  const mutatorSpeed = mutator.speedMult || 1;
  return isSuddenDeath(room) ? base * 1.2 * mutatorSpeed : base * mutatorSpeed;
}

function pickRoundMutator(room) {
  if (!room) return "standard";
  if (!room.roundCounter || room.roundCounter <= 1) return "standard";

  const choices = rotatingMutatorPool.filter(id => id !== room.lastMutatorId);
  const pool = choices.length > 0 ? choices : rotatingMutatorPool;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
    topPunchStart: 0,
    topPunchUntil: 0,
    bottomPunchStart: 0,
    bottomPunchUntil: 0,
    topPunchReach: monsterArmReachMin,
    bottomPunchReach: monsterArmReachMin,
    lastMonsterPunchAt: 0
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
  if (player.x < 0) {
    player.x = 0;
    player.velocityX = 0;
  }

  if (player.x > gameWidth - birdSize) {
    player.x = gameWidth - birdSize;
    player.velocityX = 0;
  }

  if (player.y < 0) {
    player.y = 0;
  }

  if (player.y > gameHeight - birdSize) {
    player.y = gameHeight - birdSize;
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
      chosen.topPunchStart = 0;
      chosen.topPunchUntil = 0;
      chosen.bottomPunchStart = 0;
      chosen.bottomPunchUntil = 0;
      chosen.topPunchReach = monsterArmReachMin;
      chosen.bottomPunchReach = monsterArmReachMin;
      chosen.lastMonsterPunchAt = 0;
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

  if (now - (existingMonster.lastMonsterPunchAt || 0) < monsterPunchCooldownMs) {
    return;
  }

  for (const player of alivePlayers) {
    if (now - (player.lastMonsterPunchTime || 0) < monsterPunchVictimGraceMs) continue;

    const playerCenterX = player.x + birdSize / 2;
    const playerCenterY = player.y + birdSize / 2;
    const closeX = Math.abs(playerCenterX - monsterCenterX) <= (obstacleWidth / 2 + monsterPunchRange + 12);
    if (!closeX) continue;

    const topDist = Math.abs(playerCenterY - topFaceY);
    const bottomDist = Math.abs(playerCenterY - bottomFaceY);
    const punchFromTop = topDist <= bottomDist;
    const faceY = punchFromTop ? topFaceY : bottomFaceY;
    if (Math.abs(playerCenterY - faceY) > monsterPunchRange + 6) continue;

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

    const horizontalDir = playerCenterX >= monsterCenterX ? 1 : -1;
    const strengthMult = damageBlocked ? 0.55 : 1;
    player.velocityX += horizontalDir * monsterPunchKnockback * 0.56 * strengthMult;
    player.velocityY += (punchFromTop ? 1 : -1) * monsterPunchKnockback * 0.4 * strengthMult;
    keepPlayerInsideArena(player);

    if (!damageBlocked) {
      const punchDamage = isSuddenDeath(room) ? monsterPunchDamage + 2 : monsterPunchDamage;
      dealDamage(player, punchDamage, room, now);
      ensureRoundStats(room, player.id).monsterJabsTaken += 1;
      player.lastObstacleDamageTime = now;
    }

    player.lastMonsterPunchTime = now;

    existingMonster.lastMonsterPunchAt = now;
    const reach = Math.max(
      monsterArmReachMin,
      Math.min(monsterArmReachMax, Math.round(Math.abs(playerCenterY - faceY) + 16))
    );
    if (punchFromTop) {
      existingMonster.topPunchStart = now;
      existingMonster.topPunchUntil = now + 260;
      existingMonster.topPunchReach = reach;
    } else {
      existingMonster.bottomPunchStart = now;
      existingMonster.bottomPunchUntil = now + 260;
      existingMonster.bottomPunchReach = reach;
    }

    io.to(roomCode).emit("monsterPunch", {
      playerId: player.id,
      x: monsterCenterX,
      y: faceY,
      from: punchFromTop ? "top" : "bottom"
    });
    break;
  }
}

// ── Cursed Ball and Chain helpers ──────────────────────────────────────────────

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
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.001) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Returns true if any obstacle's solid section blocks the straight line between two points
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

  // ── Attached: follow carrier, detect death ─────────────────────────────────
  if (room.curse && room.curse.state === 'attached') {
    const carrier = room.players[room.curse.carrierId];
    if (!carrier || !carrier.alive) {
      room.curse = null;
      room.lastCurseSpawn = now;
      io.to(roomCode).emit('curseDespawned', { reason: 'death' });
      return;
    }
    // Keep server position synced to carrier for clients
    room.curse.x = carrier.x;
    room.curse.y = carrier.y + birdSize;
    return;
  }

  // ── Roaming: chase, beam checks, collision ─────────────────────────────────
  if (room.curse && room.curse.state === 'roaming') {
    // Refresh target if current one disappeared or died
    if (!room.curse.targetId || !room.players[room.curse.targetId] || !room.players[room.curse.targetId].alive) {
      room.curse.targetId = findNearestAlivePlayerId(room, room.curse.x, room.curse.y);
      if (!room.curse.targetId) {
        room.curse = null;
        room.lastCurseSpawn = now;
        io.to(roomCode).emit('curseDespawned', { reason: 'notarget' });
        return;
      }
    }

    const target    = room.players[room.curse.targetId];
    const targetCX  = target.x + birdSize / 2;
    const targetCY  = target.y + birdSize / 2;
    const curseCX   = room.curse.x + curseBallSize / 2;
    const curseCY   = room.curse.y + curseBallSize / 2;

    // If a column now sits between curse and target → break lock, despawn
    if (curseBeamBlocked(curseCX, curseCY, targetCX, targetCY, room.obstacles)) {
      room.curse = null;
      room.lastCurseSpawn = now;
      io.to(roomCode).emit('curseDespawned', { reason: 'blocked' });
      return;
    }

    // Any non-target player crossing the beam steals the lock
    if (now - room.curse.lastTargetSwitch > curseTargetSwitchCooldown) {
      for (const p of Object.values(room.players)) {
        if (!p.alive || p.id === room.curse.targetId) continue;
        const dist = pointDistToSegment(
          p.x + birdSize / 2, p.y + birdSize / 2,
          curseCX, curseCY, targetCX, targetCY
        );
        if (dist < curseBeamInterceptDist) {
          room.curse.targetId      = p.id;
          room.curse.lastTargetSwitch = now;
          io.to(roomCode).emit('curseTargetChanged', { targetId: p.id });
          break;
        }
      }
    }

    // Steer toward current target
    const dx   = targetCX - curseCX;
    const dy   = targetCY - curseCY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      room.curse.velocityX += (dx / dist) * curseChaseAcceleration * speedMultiplier * curseChaseMult;
      room.curse.velocityY += (dy / dist) * curseChaseAcceleration * speedMultiplier * curseChaseMult;
    }

    // Cap speed
    const speed = Math.sqrt(room.curse.velocityX ** 2 + room.curse.velocityY ** 2);
    if (speed > curseMaxSpeed * speedMultiplier) {
      room.curse.velocityX = (room.curse.velocityX / speed) * curseMaxSpeed * speedMultiplier;
      room.curse.velocityY = (room.curse.velocityY / speed) * curseMaxSpeed * speedMultiplier;
    }

    room.curse.x += room.curse.velocityX;
    room.curse.y += room.curse.velocityY;

    // Clamp inside visible arena (allow entering from right edge)
    room.curse.x = Math.max(-curseBallSize, Math.min(gameWidth, room.curse.x));
    room.curse.y = Math.max(vineDepth, Math.min(gameHeight - grassDepth - curseBallSize, room.curse.y));

    // Check collision with alive players
    for (const p of Object.values(room.players)) {
      if (!p.alive) continue;
      const colDist = Math.hypot(
        (p.x + birdSize / 2) - (room.curse.x + curseBallSize / 2),
        (p.y + birdSize / 2) - (room.curse.y + curseBallSize / 2)
      );
      if (colDist < (birdSize / 2 + curseBallSize / 2)) {
        const hasActivePowerup =
          (p.shieldExpiry   !== null && now < p.shieldExpiry) ||
          (p.ramBoostExpiry !== null && now < p.ramBoostExpiry);
        if (hasActivePowerup) {
          // Powerup sacrificed to destroy the roaming curse
          p.shieldExpiry   = null;
          p.ramBoostExpiry = null;
          room.curse = null;
          room.lastCurseSpawn = now;
          io.to(roomCode).emit('curseDestroyedByPowerup', { playerId: p.id });
        } else {
          room.curse.state     = 'attached';
          room.curse.carrierId = p.id;
          room.curse.targetId  = null;
          room.curse.x         = p.x;
          room.curse.y         = p.y + birdSize;
          io.to(roomCode).emit('curseAttached', { carrierId: p.id });
        }
        return;
      }
    }
    return;
  }

  // ── No curse: check spawn cooldown ────────────────────────────────────────
  if (!room.curse && now - room.lastCurseSpawn > curseSpawnWindow) {
    if (getAlivePlayers(room).length < 2) return;   // need 2+ players to be meaningful
    const spawnY = randomNumber(vineDepth + curseBallSize, gameHeight - grassDepth - curseBallSize * 2);
    room.curse = {
      state:     'roaming',
      x:         gameWidth + curseBallSize,
      y:         spawnY,
      velocityX: -0.6,
      velocityY: 0,
      targetId:  null,
      carrierId: null,
      lastTargetSwitch: now - curseTargetSwitchCooldown  // allow targeting immediately
    };
    room.curse.targetId = findNearestAlivePlayerId(room, room.curse.x, room.curse.y);
    if (!room.curse.targetId) { room.curse = null; return; }
    io.to(roomCode).emit('curseSpawned', { targetId: room.curse.targetId });
  }
}

// Stomp transfer: cursed carrier above another bird and diving → pass the curse
function checkCurseTransfer(room, roomCode) {
  if (!room.curse || room.curse.state !== 'attached') return;
  const carrier = room.players[room.curse.carrierId];
  if (!carrier || !carrier.alive) return;

  for (const p of Object.values(room.players)) {
    if (!p.alive || p.id === room.curse.carrierId) continue;

    const dx = (carrier.x + birdSize / 2) - (p.x + birdSize / 2);
    const dy = (carrier.y + birdSize / 2) - (p.y + birdSize / 2);
    if (Math.sqrt(dx * dx + dy * dy) >= birdSize) continue;

    // Stomp: carrier center is above victim center (dy < 0) and moving downward.
    // dy < -birdSize * 0.15 ensures "clearly above" even mid-overlap.
    // velocityY > 0 confirms a downward trajectory — no strict angle requirement
    // so side-dives with downward velocity still count, as the spec intended.
    const isAbove    = dy < -(birdSize * 0.15);
    const movingDown = carrier.velocityY > 0.8;

    if (isAbove && movingDown) {
      const fromId = room.curse.carrierId;
      room.curse.carrierId = p.id;
      room.curse.x = p.x;
      room.curse.y = p.y + birdSize;
      io.to(roomCode).emit('curseTransferred', { fromId, toId: p.id });
      return;
    }
  }
}

function endRound(roomCode, winner) {
  const room = rooms[roomCode];

  if (!room) return;

  const resolvedWinner = winner || getRoundWinner(room);
  const winReason = getRoundWinReason(room, resolvedWinner);

  room.started = false;

  // Clear curse immediately — round is over, show clean state in final broadcast
  room.curse = null;

  if (room.gameLoop) {
    clearInterval(room.gameLoop);
    room.gameLoop = null;
  }

  if (resolvedWinner) {
    awardPoints(resolvedWinner, roundWinnerBonusPoints + (isSuddenDeath(room) ? suddenDeathWinnerBonusPoints : 0), room, roomCode);
    resolvedWinner.score++;
  }

  const matchWinner = resolvedWinner && resolvedWinner.score >= room.targetScore ? resolvedWinner : null;
  const roundHighlights = buildRoundHighlights(room);

  // Track hourly leaderboard stats (bot excluded)
  if (resolvedWinner && resolvedWinner.id !== BOT_ID) {
    recordHourlyStat(resolvedWinner.name, "roundWins");
  }
  if (matchWinner && matchWinner.id !== BOT_ID) {
    recordHourlyStat(matchWinner.name, "matchWins");
    io.emit("leaderboardUpdate", getLeaderboardData());
  }

  // When the whole match ends, notify waiting spectators they can now join
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

  // Auto-restart next round after a short pause (unless the match just ended)
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
    // First time detecting end condition, start victory timer to show explosions
    if (!room.victoryTimer) {
      room.victoryTimer = setTimeout(() => {
        endRound(roomCode, getRoundWinner(room));
        room.victoryTimer = null;
      }, phase === "suddenDeath" ? 600 : 350);
    }
  }
}

// ── Ghost physics update ───────────────────────────────────────────────────
function updateGhosts(room) {
  const speedMultiplier = getSpeedMultiplier(room);
  for (const player of Object.values(room.players)) {
    if (player.alive || player.id === BOT_ID) continue;
    player.ghostVY = (player.ghostVY || 0) + gravity * speedMultiplier * 0.75;
    player.ghostY  = (player.ghostY  || gameHeight / 2) + player.ghostVY * speedMultiplier;
    player.ghostX  = (player.ghostX  || gameWidth  / 2) + (player.ghostVX || 0) * speedMultiplier;
    player.ghostVX = (player.ghostVX || 0) * horizontalDrag;
    // Clamp inside arena
    player.ghostX = Math.max(0, Math.min(gameWidth  - birdSize, player.ghostX));
    player.ghostY = Math.max(vineDepth, Math.min(gameHeight - birdSize - grassDepth, player.ghostY));
  }
}

// ── Speed ramp: gradually doubles base speed over 50s ─────────────────────
function updateSpeedRamp(room) {
  const startTime = room.roundLiveStartTime || room.roundStartTime;
  if (!startTime || !room.baseGameSpeed) return;
  const elapsed    = (Date.now() - startTime) / 1000;
  const rampFactor = Math.min(elapsed / 50, 1.0);
  const maxRamp    = Math.min(room.baseGameSpeed, 15); // cap bonus at +15 units
  room.gameSpeed   = room.baseGameSpeed + maxRamp * rampFactor;
}

// ── Shared round-start logic (used by host button AND auto-restart) ────────
function startRoundForRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.started) return;

  room.roomCode = roomCode;

  const playerCount = Object.keys(room.players).length;
  if (playerCount === 1) {
    addBotToRoom(roomCode);
  }

  resetPlayersForRound(room);
  room.roundStartTime  = Date.now();       // set first so createObstacle can use it
  room.roundCounter = (room.roundCounter || 0) + 1;
  room.currentMutatorId = pickRoundMutator(room);
  room.lastMutatorId = room.currentMutatorId;
  room.roundLiveStartTime = null;
  room.roundEndTime = room.roundStartTime + roundDurationMs;
  room.roundStats = {};
  room.baseGameSpeed   = room.gameSpeed;   // snapshot for speed ramp
  room.obstacles       = createInitialObstacles(room);
  room.obstaclesPassed = 0;
  room.pickups         = [];
  room.goldenTarget    = null;
  room.lastGoldenTargetSpawn = Date.now();
  room.lastPickupSpawn = 0;
  room.lastMonsterSpawn = Date.now();
  room.wind = { active: false, direction: 1, strength: 0, endAt: 0 };
  room.lastWindGustAt = Date.now();
  room.curse           = null;
  room.lastCurseSpawn  = Date.now();

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
    startGameLoop(roomCode);
    drainWaitingQueue(roomCode);
  }, 4000);
}
// ──────────────────────────────────────────────────────────────────────────

function startGameLoop(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.gameLoop) {
    clearInterval(room.gameLoop);
  }

  room.gameLoop = setInterval(() => {
    const activeRoom = rooms[roomCode];

    if (!activeRoom || !activeRoom.started) {
      clearInterval(room.gameLoop);
      return;
    }

    updateSpeedRamp(activeRoom);
    updateWind(activeRoom, roomCode);
    updatePlayerPhysics(activeRoom);
    updateBotAI(activeRoom);
    updateGhosts(activeRoom);
    updateCurse(activeRoom, roomCode);
    checkCurseTransfer(activeRoom, roomCode);
    applyPlayerCollisions(activeRoom, roomCode);
    updateMonster(activeRoom, roomCode);
    updateObstacles(activeRoom, roomCode);
    updateGoldenTarget(activeRoom, roomCode);
    updatePickups(activeRoom, roomCode);
    applyObstacleDeaths(activeRoom, roomCode);
    updateSurvivalScoring(activeRoom);
    broadcastGameState(roomCode);
    checkForRoundEnd(roomCode);
  }, 1000 / 60);
}

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
      // Mid-game join: become a spectator until the match ends
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

    // Cancel any pending auto-restart so we don't double-start
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

    // Cancel any pending auto-restart
    if (room.autoRestartTimer) {
      clearTimeout(room.autoRestartTimer);
      room.autoRestartTimer = null;
    }

    // Admit waiting spectators as players (with ghost fields)
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

    // Reset all scores for the rematch
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

    // Remove bot if real players now fill the room
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

    // Priority 1: a lobby that hasn't started yet and has room for another player
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

    // Priority 2: a running room that has spectator capacity
    const openRoom = Object.entries(rooms).find(([, room]) => {
      if (!room.started) return false;
      const realPlayers = Object.keys(room.players).filter(id => id !== BOT_ID).length;
      const totalOccupants = realPlayers + Object.keys(room.spectators || {}).length;
      return totalOccupants < MAX_PLAYERS;
    });

    if (!openRoom) {
      // No game available — hold in queue and keep name registered
      waitingQueue[socket.id] = { name: nameCheck.name };
      socket.emit("quickJoinQueued");
      return;
    }

    const [roomCode, room] = openRoom;
    room.spectators[socket.id] = { id: socket.id, name: nameCheck.name };
    socket.join(roomCode);
    socket.emit("joinedAsSpectator", getGameState(roomCode));
  });

  socket.on("cancelQuickJoin", () => {
    if (waitingQueue[socket.id]) {
      delete waitingQueue[socket.id];
      for (const [key, id] of Object.entries(activeNames)) {
        if (id === socket.id) { delete activeNames[key]; break; }
      }
    }
  });

  socket.on("playerInput", ({ roomCode, direction }) => {
    const room = rooms[roomCode];

    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];

    if (!room.started || !player.alive) return;

    applyInput(player, direction, room);
  });

  // Ghost input: movement and spook for dead players
  socket.on("ghostInput", ({ roomCode, direction }) => {
    const room = rooms[roomCode];
    if (!room || !room.players[socket.id]) return;
    const player = room.players[socket.id];
    if (player.alive || !room.started) return;
    const now = Date.now();

    if (direction === "spook") {
      if (now - (player.ghostLastSpook || 0) < GHOST_SPOOK_COOLDOWN) return;
      player.ghostLastSpook = now;
      const spookCX = (player.ghostX || gameWidth  / 2) + birdSize / 2;
      const spookCY = (player.ghostY || gameHeight / 2) + birdSize / 2;
      for (const other of Object.values(room.players)) {
        if (!other.alive) continue;
        const dx   = (other.x + birdSize / 2) - spookCX;
        const dy   = (other.y + birdSize / 2) - spookCY;
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

    // Ghost directional movement
    if (direction === "up")    { player.ghostVY = flapStrength; }
    if (direction === "left")  { player.ghostVY = sideFlapStrength; player.ghostVX = (player.ghostVX || 0) - horizontalPush; }
    if (direction === "right") { player.ghostVY = sideFlapStrength; player.ghostVX = (player.ghostVX || 0) + horizontalPush; }
    if (direction === "up-left") { player.ghostVY = flapStrength * 0.92; player.ghostVX = (player.ghostVX || 0) - horizontalPush * 0.82; }
    if (direction === "up-right") { player.ghostVY = flapStrength * 0.92; player.ghostVX = (player.ghostVX || 0) + horizontalPush * 0.82; }
    if (direction === "down-left") { player.ghostVY = Math.max(player.ghostVY || 0, 6.2); player.ghostVX = (player.ghostVX || 0) - horizontalPush * 0.82; }
    if (direction === "down-right") { player.ghostVY = Math.max(player.ghostVY || 0, 6.2); player.ghostVX = (player.ghostVX || 0) + horizontalPush * 0.82; }
  });

  socket.on("disconnect", () => {
    // Free this player's name so others (or themselves on reconnect) can claim it
    delete waitingQueue[socket.id];  // also remove from quick-join queue if waiting
    for (const [nameLower, id] of Object.entries(activeNames)) {
      if (id === socket.id) { delete activeNames[nameLower]; break; }
    }

    for (const roomCode in rooms) {
      const room = rooms[roomCode];

      // Remove from spectators if they were spectating
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

        // Only send roomUpdated (lobby-reset event) when the game isn't running.
        // During a live game, roomUpdated resets gameRunning = false on all clients,
        // making surviving players unable to send input. The continuous gameState
        // broadcast is sufficient to reflect the updated player list mid-game.
        if (!room.started) {
          io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
        }

        // Clean up curse if the carrier disconnected mid-game
        if (room.curse && room.curse.carrierId === socket.id) {
          room.curse = null;
          room.lastCurseSpawn = Date.now();
          io.to(roomCode).emit('curseDespawned', { reason: 'death' });
        }

        broadcastGameState(roomCode);
        checkForRoundEnd(roomCode);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bird Royale server running on port ${PORT}`);
});