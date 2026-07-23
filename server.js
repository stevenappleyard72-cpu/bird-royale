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

const victimKnockback = 45;
const attackerRecoil = 15;

const shieldDuration = 6000;
const shieldPickupSize = 28;
const maxPickups = 1;
const pickupSpawnInterval = 7000;

const shockwavePickupSize = 28;
const shockwaveRadius = 300;       // server units — covers most of the arena
const shockwavePushStrength = 98;  // knockback applied to nearby birds

const ramBoostDuration = 5000;
const ramBoostPickupSize = 28;
const ramBoostKnockbackMultiplier = 2.5; // victim flies much further
const ramBoostRecoilMultiplier = 0.4;    // attacker barely bounces back

// ── Cursed Ball and Chain ──────────────────────────────────────────────────
const curseBallSize              = 20;    // server units (diameter)
const curseSpawnInterval         = 22000; // ms after despawn before respawning
const curseChaseAcceleration     = 0.06;  // steering force per tick at 1× speed
const curseMaxSpeed              = 1.8;   // terminal speed (server units/tick at 1×)
const curseTargetSwitchCooldown  = 1200;  // ms between beam-intercept switches
const curseBeamInterceptDist     = birdSize * 0.65; // how close to beam counts as crossing
const curseExtraGravity          = 0.10;  // extra gravity on carrier per tick
const curseKnockbackBonus        = 0.30;  // 30 % more knockback received while cursed
// ──────────────────────────────────────────────────────────────────────────

const monsterSpawnInterval = 10000;  // ms between monster spawns (from despawn of last)
const monsterChaseSpeed = 0.45;      // vertical units per tick at 1x speed — slow but unnerving
const monsterMinGap = 115;           // minimum gap the monster must preserve while tracking

const BOT_ID = "__bot__";
const BOT_NAME = "Bot";

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
  return (room.gameSpeed || 10) / 10;
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
  room.players[BOT_ID] = {
    id: BOT_ID,
    name: BOT_NAME,
    colour: playerColours[playerCount % playerColours.length],
    x: 70 + playerCount * 55,
    y: 220,
    velocityX: 0,
    velocityY: 0,
    diveBurst: 0,
    alive: true,
    score: 0,
    shieldExpiry: null,
    ramBoostExpiry: null
  };
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

function createObstacle(x) {
  let topHeight = randomNumber(50, 150);
  let bottomHeight = randomNumber(50, 150);

  while (topHeight + bottomHeight > gameHeight / 2) {
    topHeight = randomNumber(50, 150);
    bottomHeight = randomNumber(50, 150);
  }

  return {
    id: Math.random().toString(36).slice(2, 9),
    x,
    width: obstacleWidth,
    topHeight,
    bottomHeight,
    isMonster: false
  };
}

function createInitialObstacles() {
  const obstacles = [];

  for (let i = 0; i < targetObstacleCount; i++) {
    obstacles.push(
      createObstacle((gameWidth - obstacleWidth) + i * obstacleSpacing)
    );
  }

  return obstacles;
}

function getGameState(roomCode) {
  const room = rooms[roomCode];

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
        shielded: p.shieldExpiry !== null && now < p.shieldExpiry,
        ramBoosted: p.ramBoostExpiry !== null && now < p.ramBoostExpiry
      };
    }),
    obstacles: room.obstacles,
    obstaclesPassed: room.obstaclesPassed,
    pickups: room.pickups || [],
    spectatorCount: Object.keys(room.spectators || {}).length,
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

  room.players[socket.id] = {
    id: socket.id,
    name: playerName,
    colour: playerColours[playerCount % playerColours.length],
    x: 70 + playerCount * 55,
    y: 220,
    velocityX: 0,
    velocityY: 0,
    diveBurst: 0,
    alive: true,
    score: 0,
    shieldExpiry: null,
    ramBoostExpiry: null
  };

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
    players[i].shieldExpiry = null;
    players[i].ramBoostExpiry = null;
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
  const speedMultiplier = getSpeedMultiplier(room);

  if (direction === "up") {
    player.velocityY = flapStrength;
  }

  if (direction === "left") {
    player.velocityY = sideFlapStrength;
    player.velocityX -= horizontalPush;
  }

  if (direction === "right") {
    player.velocityY = sideFlapStrength;
    player.velocityX += horizontalPush;
  }

  if (direction === "down") {
  player.velocityY = Math.max(player.velocityY, 10);
  }
}

function updatePlayerPhysics(room) {
  const speedMultiplier = getSpeedMultiplier(room);
  const players = Object.values(room.players);

  for (const player of players) {
    if (!player.alive) continue;

    const extraGravity = (room.curse && room.curse.state === 'attached' && room.curse.carrierId === player.id)
      ? curseExtraGravity : 0;
    player.velocityY += (gravity + extraGravity) * speedMultiplier;
    player.y += (player.velocityY + player.diveBurst) * speedMultiplier;
    player.diveBurst *= diveBurstDecay;

    if (player.diveBurst < diveBurstMinimum) {
      player.diveBurst = 0;
    }

    player.x += player.velocityX * speedMultiplier;
    player.velocityX *= horizontalDrag;

    keepPlayerInsideArena(player);
  }
}

function updateObstacles(room) {
  const speedMultiplier = getSpeedMultiplier(room);

  for (const obstacle of room.obstacles) {
    obstacle.x -= obstacleSpeed * speedMultiplier;
  }

  while (room.obstacles.length > 0 && room.obstacles[0].x < -obstacleWidth) {
    room.obstacles.shift();
    room.obstaclesPassed++;

    const lastObstacle = room.obstacles[room.obstacles.length - 1];
    room.obstacles.push(createObstacle(lastObstacle.x + obstacleSpacing));
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

function applyObstacleDeaths(room) {
  const players = Object.values(room.players);
  const now = Date.now();

  for (const player of players) {
    if (!player.alive) continue;

    const shielded = player.shieldExpiry !== null && now < player.shieldExpiry;

    if (playerHitsBoundary(player)) {
      if (!shielded) player.alive = false;
      continue;
    }

    for (const obstacle of room.obstacles) {
      if (playerHitsObstacle(player, obstacle)) {
        if (!shielded) {
          player.alive = false;
        }
        break;
      }
    }
  }
}

function applyPlayerCollisions(room, roomCode) {
  const players = Object.values(room.players).filter(player => player.alive);
  const now = Date.now();

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];

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

        const knockbackMult = attackerRamBoosted ? ramBoostKnockbackMultiplier : 1;
        const recoilMult    = attackerRamBoosted ? ramBoostRecoilMultiplier    : 1;

        if (!victimShielded) {
          const cursedVictimMult = (room.curse && room.curse.state === 'attached' && room.curse.carrierId === victim.id)
            ? (1 + curseKnockbackBonus) : 1;
          victim.x += directionX * victimKnockback * knockbackMult * cursedVictimMult;
          victim.y += directionY * victimKnockback * knockbackMult * cursedVictimMult;
          victim.velocityX += directionX * 5 * knockbackMult * cursedVictimMult;
          victim.velocityY += directionY * 5 * knockbackMult * cursedVictimMult;
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

function updatePickups(room, roomCode) {
  const speedMultiplier = getSpeedMultiplier(room);
  const now = Date.now();

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
        } else if (pickup.type === "ramboost") {
          player.ramBoostExpiry = now + ramBoostDuration;
        } else if (pickup.type === "shockwave") {
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
              other.x += nx * shockwavePushStrength * falloff;
              other.y += ny * shockwavePushStrength * falloff;
              other.velocityX += nx * shockwavePushStrength * falloff * 0.25;
              other.velocityY += ny * shockwavePushStrength * falloff * 0.25;
              keepPlayerInsideArena(other);
            }
          }
          io.to(roomCode).emit("shockwaveTriggered", {
            x: collectorCX,
            y: collectorCY
          });
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

  if (room.pickups.length < maxPickups && now - room.lastPickupSpawn > pickupSpawnInterval) {
    const roll = Math.random();
    let nextPickup;
    if (roll < 0.33) {
      nextPickup = createShieldPickup(room);
    } else if (roll < 0.67) {
      nextPickup = createShockwavePickup(room);
    } else {
      nextPickup = createRamBoostPickup(room);
    }
    room.pickups.push(nextPickup);
    room.lastPickupSpawn = now;
  }
}

function updateMonster(room, roomCode) {
  const now = Date.now();

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
  const step = monsterChaseSpeed * speedMultiplier;

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
      room.curse.velocityX += (dx / dist) * curseChaseAcceleration * speedMultiplier;
      room.curse.velocityY += (dy / dist) * curseChaseAcceleration * speedMultiplier;
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
  if (!room.curse && now - room.lastCurseSpawn > curseSpawnInterval) {
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

  room.started = false;

  // Clear curse immediately — round is over, show clean state in final broadcast
  room.curse = null;

  if (room.gameLoop) {
    clearInterval(room.gameLoop);
    room.gameLoop = null;
  }

  if (winner) {
    winner.score++;
  }

  const matchWinner = winner && winner.score >= room.targetScore ? winner : null;

  // Track hourly leaderboard stats (bot excluded)
  if (winner && winner.id !== BOT_ID) {
    recordHourlyStat(winner.name, "roundWins");
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
    roundWinner: winner || null,
    matchWinner,
    targetScore: room.targetScore,
    players: getPlayersInRoom(roomCode),
    obstacles: room.obstacles,
    obstaclesPassed: room.obstaclesPassed
  });
}

function checkForRoundEnd(roomCode) {
  const room = rooms[roomCode];

  if (!room || !room.started) return;

  const alivePlayers = getAlivePlayers(room);

  if (alivePlayers.length <= 1) {
    // First time detecting end condition, start victory timer to show explosions
    if (!room.victoryTimer) {
      room.victoryTimer = setTimeout(() => {
        endRound(roomCode, alivePlayers[0] || null);
        room.victoryTimer = null;
      }, 600);  // Match explosion animation duration
    }
  }
}

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

    updatePlayerPhysics(activeRoom);
    updateBotAI(activeRoom);
    updateCurse(activeRoom, roomCode);
    checkCurseTransfer(activeRoom, roomCode);
    applyPlayerCollisions(activeRoom, roomCode);
    updateMonster(activeRoom, roomCode);
    updateObstacles(activeRoom);
    updatePickups(activeRoom, roomCode);
    applyObstacleDeaths(activeRoom);
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
      lastPickupSpawn: 0,
      lastMonsterSpawn: 0,
      curse: null,
      lastCurseSpawn: 0
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
    const playerCount = Object.keys(room.players).length;
    if (playerCount === 1) {
      addBotToRoom(roomCode);
    }
    resetPlayersForRound(room);

    room.obstacles = createInitialObstacles();
    room.obstaclesPassed = 0;
    room.lastMonsterSpawn = Date.now(); // delay first monster by one full interval
    room.curse = null;                   // clear any lingering curse from previous round
    room.lastCurseSpawn = Date.now();   // first curse spawns after curseSpawnInterval

    io.to(roomCode).emit("gameStarting", getGameState(roomCode));

    setTimeout(() => {
      if (!rooms[roomCode] || rooms[roomCode].started) return;

      rooms[roomCode].started = true;
      io.to(roomCode).emit("gameStarted", getGameState(roomCode));
      startGameLoop(roomCode);
      drainWaitingQueue(roomCode);
    }, 4000);
  });

  socket.on("requestRematch", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.started) return;

    // Admit waiting spectators as players
    for (const specId in room.spectators) {
      const spec = room.spectators[specId];
      const playerCount = Object.keys(room.players).length;
      room.players[specId] = {
        id: specId,
        name: spec.name,
        colour: playerColours[playerCount % playerColours.length],
        x: 70 + playerCount * 55,
        y: 220,
        velocityX: 0,
        velocityY: 0,
        diveBurst: 0,
        alive: true,
        score: 0,
        shieldExpiry: null,
        ramBoostExpiry: null
      };
    }
    room.spectators = {};

    // Reset all scores for the rematch
    for (const player of Object.values(room.players)) {
      player.score = 0;
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