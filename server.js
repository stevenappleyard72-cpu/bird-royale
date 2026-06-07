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

const diveBurstStart = 14;

const diveBurstDecay = 0.55;

const diveBurstMinimum = 0.15;

const obstacleWidth = 40;
const obstacleSpacing = 170;
const obstacleSpeed = 2;
const targetObstacleCount = 4;

const victimKnockback = 45;
const attackerRecoil = 15;

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
    players: getPlayersInRoom(roomCode),
    obstacles: room.obstacles,
    obstaclesPassed: room.obstaclesPassed
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
    score: 0
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
    player.diveBurst = diveBurstStart;
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
  return player.y <= 0 || player.y >= gameHeight - birdSize;
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

function applyPlayerCollisions(room) {
  const players = Object.values(room.players).filter(player => player.alive);

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

        victim.x += directionX * victimKnockback;
        victim.y += directionY * victimKnockback;

        attacker.x -= directionX * attackerRecoil;
        attacker.y -= directionY * attackerRecoil;

        victim.velocityX += directionX * 5;
        victim.velocityY += directionY * 5;

        attacker.velocityX -= directionX * 2;
        attacker.velocityY -= directionY * 2;

        keepPlayerInsideArena(victim);
        keepPlayerInsideArena(attacker);
      }
    }
  }
}

function getAlivePlayers(room) {
  return Object.values(room.players).filter(player => player.alive);
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
    applyPlayerCollisions(activeRoom);
    updateObstacles(activeRoom);
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
      targetScore: clampTargetScore(targetScore)
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
    if (playerCount < 2) {
      socket.emit("joinError", "You need at least 2 players to start the round.");
      return;
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