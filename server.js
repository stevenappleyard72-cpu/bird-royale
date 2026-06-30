const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = {};

const playerColours = ["gold", "dodgerblue", "tomato", "limegreen", "violet", "orange"];

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

const BOT_ID = "__bot__";
const BOT_NAME = "Bot";

const grassDepth = 28;
const vineDepth = 24;

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
    shieldExpiry: null
  };
}

function updateBotAI(room) {
  const bot = room.players[BOT_ID];
  if (!bot || !bot.alive) return;

  // ~5 decisions per second with slight jitter, matching a casual human
  const now = Date.now();
  if (now - (room.botLastInput || 0) < 170 + Math.random() * 60) return;

  const speedMultiplier = getSpeedMultiplier(room);

  // Simulate the bot's Y trajectory forward for `ticks` steps using actual physics.
  // Returns the centre-Y of the bird at that point.
  function predictCenterY(startY, startVY, ticks) {
    let y = startY;
    let vY = startVY;
    for (let t = 0; t < ticks; t++) {
      vY += gravity * speedMultiplier;
      y  += vY   * speedMultiplier;
      // Clamp at arena walls so simulation doesn't fly off to infinity
      if (y < vineDepth)                        { y = vineDepth;                        vY = 0; }
      if (y > gameHeight - birdSize - grassDepth) { y = gameHeight - birdSize - grassDepth; vY = 0; }
    }
    return y + birdSize / 2;
  }

  // Next obstacle whose right edge hasn't passed the bird's left edge yet
  const next = room.obstacles.find(o => o.x + o.width > bot.x);

  let action = null;

  // ── Hard safety overrides ───────────────────────────────────────────────
  if (bot.y >= gameHeight - birdSize - 40) {
    // Too close to floor — flap regardless
    action = "up";
  } else if (bot.y < vineDepth + 12 && bot.velocityY < 0) {
    // Ceiling — stop flapping, let gravity pull back down
    action = null;
  } else if (next) {
    // ── Predictive gap-threading ──────────────────────────────────────────
    const gapTop    = next.topHeight;
    const gapBottom = gameHeight - next.bottomHeight;
    const gapCenter = (gapTop + gapBottom) / 2;
    const gapSize   = gapBottom - gapTop;

    // Safe target band: keep birdSize clearance from each wall
    const safeTop    = gapTop    + birdSize * 0.5 + 8;
    const safeBottom = gapBottom - birdSize * 0.5 - 8;

    // Ticks until the obstacle's left face reaches the bird's right edge
    const distToFace  = next.x - (bot.x + birdSize);
    const ticksToFace = Math.max(0, Math.round(distToFace / (obstacleSpeed * speedMultiplier)));

    const predictedNow  = predictCenterY(bot.y, bot.velocityY, ticksToFace);
    const predictedFlap = predictCenterY(bot.y, flapStrength,  ticksToFace);

    if (predictedNow > safeBottom) {
      // Will arrive below the safe zone — flap if it helps (or if it's the best option)
      if (predictedFlap < predictedNow) {
        action = "up";
      }
    } else if (predictedNow < safeTop) {
      // Will arrive above the safe zone — hold off, gravity is enough
      action = null;
    } else {
      // On track through the gap — bias toward centre to give headroom
      if (predictedNow > gapCenter + gapSize * 0.15) {
        action = "up";
      }
    }
  } else {
    // ── No obstacle in view — hover in the middle third ──────────────────
    const centerY = bot.y + birdSize / 2;
    if (centerY > gameHeight * 0.62 || bot.velocityY > 3.5) {
      action = "up";
    }
  }

  if (action) {
    applyInput(bot, action, room);
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
    x,
    width: obstacleWidth,
    topHeight,
    bottomHeight
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
      return { ...p, shielded: p.shieldExpiry !== null && now < p.shieldExpiry };
    }),
    obstacles: room.obstacles,
    obstaclesPassed: room.obstaclesPassed,
    pickups: room.pickups || []
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
    shieldExpiry: null
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

    player.velocityY += gravity * speedMultiplier;
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

  for (const player of players) {
    if (!player.alive) continue;

    if (playerHitsBoundary(player)) {
      player.alive = false;
      continue;
    }

    for (const obstacle of room.obstacles) {
      if (playerHitsObstacle(player, obstacle)) {
        player.alive = false;
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

        if (victimShielded || attackerShielded) {
          io.to(roomCode).emit("shieldBlock", {});
        }

        if (!victimShielded) {
          victim.x += directionX * victimKnockback;
          victim.y += directionY * victimKnockback;
          victim.velocityX += directionX * 5;
          victim.velocityY += directionY * 5;
          keepPlayerInsideArena(victim);
        }

        if (!attackerShielded) {
          attacker.x -= directionX * attackerRecoil;
          attacker.y -= directionY * attackerRecoil;
          attacker.velocityX -= directionX * 2;
          attacker.velocityY -= directionY * 2;
          keepPlayerInsideArena(attacker);
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
      if (pickupOverlapsPlayer(player, room.pickups[i])) {
        player.shieldExpiry = now + shieldDuration;
        room.pickups.splice(i, 1);
        io.to(roomCode).emit("pickupCollected", { playerId: player.id, type: "shield" });
      }
    }
  }

  for (const player of Object.values(room.players)) {
    if (player.shieldExpiry !== null && now > player.shieldExpiry) {
      player.shieldExpiry = null;
    }
  }

  if (room.pickups.length < maxPickups && now - room.lastPickupSpawn > pickupSpawnInterval) {
    room.pickups.push(createShieldPickup(room));
    room.lastPickupSpawn = now;
  }
}

function endRound(roomCode, winner) {
  const room = rooms[roomCode];

  if (!room) return;

  room.started = false;

  if (room.gameLoop) {
    clearInterval(room.gameLoop);
    room.gameLoop = null;
  }

  if (winner) {
    winner.score++;
  }

  const matchWinner = winner && winner.score >= room.targetScore ? winner : null;

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
    applyPlayerCollisions(activeRoom, roomCode);
    updateObstacles(activeRoom);
    updatePickups(activeRoom, roomCode);
    applyObstacleDeaths(activeRoom);
    broadcastGameState(roomCode);
    checkForRoundEnd(roomCode);
  }, 1000 / 60);
}

io.on("connection", (socket) => {
  socket.on("createGame", ({ playerName, roomCode, gameSpeed, targetScore }) => {
    rooms[roomCode] = {
      hostId: socket.id,
      players: {},
      started: false,
      obstacles: [],
      obstaclesPassed: 0,
      gameLoop: null,
      gameSpeed: clampGameSpeed(gameSpeed),
      targetScore: clampTargetScore(targetScore),
      pickups: [],
      lastPickupSpawn: 0
    };

    addPlayerToRoom(socket, roomCode, playerName);

    io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
  });

  socket.on("joinGame", ({ playerName, roomCode }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("joinError", "Game code not found.");
      return;
    }

    if (room.started) {
      socket.emit("joinError", "This round has already started.");
      return;
    }

    addPlayerToRoom(socket, roomCode, playerName);

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

    io.to(roomCode).emit("gameStarting", getGameState(roomCode));

    setTimeout(() => {
      if (!rooms[roomCode] || rooms[roomCode].started) return;

      rooms[roomCode].started = true;
      io.to(roomCode).emit("gameStarted", getGameState(roomCode));
      startGameLoop(roomCode);
    }, 4000);
  });

  socket.on("playerInput", ({ roomCode, direction }) => {
    const room = rooms[roomCode];

    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];

    if (!room.started || !player.alive) return;

    applyInput(player, direction, room);
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];

      if (room.players[socket.id]) {
        delete room.players[socket.id];

        if (Object.keys(room.players).length === 0) {
          if (room.gameLoop) clearInterval(room.gameLoop);
          if (room.victoryTimer) clearTimeout(room.victoryTimer);
          delete rooms[roomCode];
          return;
        }

        io.to(roomCode).emit("roomUpdated", getGameState(roomCode));
        broadcastGameState(roomCode);
        checkForRoundEnd(roomCode);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bird Royale server running on port ${PORT}`);
});