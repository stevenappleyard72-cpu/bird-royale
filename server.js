const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const rooms = {};

const GAME_WIDTH = 420;
const GAME_HEIGHT = 500;
const BIRD_SIZE = 40;

const GRAVITY = 0.45;
const FLAP_STRENGTH = -7.8;
const SIDE_FLAP_STRENGTH = -6.4;
const HORIZONTAL_PUSH = 4.8;
const HORIZONTAL_DRAG = 0.92;

const DIVE_AMOUNT = 45;
const DIVE_RECOVERY_DELAY = 140;

const OBSTACLE_WIDTH = 40;
const OBSTACLE_SPACING = 170;
const OBSTACLE_SPEED = 2;
const TARGET_OBSTACLE_COUNT = 4;

const VICTIM_KNOCKBACK = 45;
const ATTACKER_RECOIL = 15;
const COLLISION_COOLDOWN_MS = 250;

const COUNTDOWN_MS = 3500;

const playerColours = [
  "gold",
  "dodgerblue",
  "tomato",
  "limegreen",
  "violet",
  "orange"
];

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function randomNumber(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function getPlayersInRoom(roomCode) {
  if (!rooms[roomCode]) return [];
  return Object.values(rooms[roomCode].players);
}

function publicRoomState(roomCode) {
  const room = rooms[roomCode];

  return {
    roomCode,
    hostId: room.hostId,
    status: room.status,
    players: getPlayersInRoom(roomCode)
  };
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
    alive: true,
    lastCollisionAt: 0
  };

  socket.join(roomCode);
}

function resetPlayersForMatch(room) {
  const players = Object.values(room.players);

  for (let i = 0; i < players.length; i++) {
    players[i].x = 70 + i * 55;
    players[i].y = 220;
    players[i].velocityX = 0;
    players[i].velocityY = 0;
    players[i].alive = true;
    players[i].lastCollisionAt = 0;
  }
}

function createObstacle(xPosition) {
  let topHeight = randomNumber(50, 150);
  let bottomHeight = randomNumber(50, 150);

  while (topHeight + bottomHeight > GAME_HEIGHT / 2) {
    topHeight = randomNumber(50, 150);
    bottomHeight = randomNumber(50, 150);
  }

  return {
    x: xPosition,
    width: OBSTACLE_WIDTH,
    topHeight,
    bottomHeight
  };
}

function createInitialObstacles() {
  const obstacles = [];

  for (let i = 0; i < TARGET_OBSTACLE_COUNT; i++) {
    obstacles.push(
      createObstacle((GAME_WIDTH - OBSTACLE_WIDTH) + i * OBSTACLE_SPACING)
    );
  }

  return obstacles;
}

function applyInput(player, direction) {
  if (!player.alive) return;

  if (direction === "up") {
    player.velocityY = FLAP_STRENGTH;
  }

  if (direction === "left") {
    player.velocityY = SIDE_FLAP_STRENGTH;
    player.velocityX -= HORIZONTAL_PUSH;
  }

  if (direction === "right") {
    player.velocityY = SIDE_FLAP_STRENGTH;
    player.velocityX += HORIZONTAL_PUSH;
  }

  if (direction === "down") {
    player.y += DIVE_AMOUNT;
    player.velocityY = 2;

    setTimeout(() => {
      if (player.alive) {
        player.velocityY = FLAP_STRENGTH;
      }
    }, DIVE_RECOVERY_DELAY);
  }
}

function updatePlayerPhysics(room) {
  const players = Object.values(room.players);

  for (const player of players) {
    if (!player.alive) continue;

    player.velocityY += GRAVITY;
    player.y += player.velocityY;

    player.x += player.velocityX;
    player.velocityX *= HORIZONTAL_DRAG;

    keepPlayerInsideArena(player);
  }
}

function keepPlayerInsideArena(player) {
  if (player.x < 0) {
    player.x = 0;
    player.velocityX = 0;
  }

  if (player.x > GAME_WIDTH - BIRD_SIZE) {
    player.x = GAME_WIDTH - BIRD_SIZE;
    player.velocityX = 0;
  }
}

function updateObstacles(room) {
  for (const obstacle of room.obstacles) {
    obstacle.x -= OBSTACLE_SPEED;
  }

  while (room.obstacles.length > 0 && room.obstacles[0].x < -OBSTACLE_WIDTH) {
    room.obstacles.shift();
    room.obstaclesPassed++;

    const lastObstacle = room.obstacles[room.obstacles.length - 1];
    room.obstacles.push(createObstacle(lastObstacle.x + OBSTACLE_SPACING));
  }
}

function playerHitsBoundary(player) {
  return player.y <= 0 || player.y >= GAME_HEIGHT - BIRD_SIZE;
}

function playerHitsObstacle(player, obstacle) {
  const birdLeft = player.x;
  const birdRight = player.x + BIRD_SIZE;
  const birdTop = player.y;
  const birdBottom = player.y + BIRD_SIZE;

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
    birdBottom > GAME_HEIGHT - obstacle.bottomHeight;

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
  const now = Date.now();
  const players = Object.values(room.players).filter(player => player.alive);

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];

      if (
        now - a.lastCollisionAt < COLLISION_COOLDOWN_MS ||
        now - b.lastCollisionAt < COLLISION_COOLDOWN_MS
      ) {
        continue;
      }

      const aCenterX = a.x + BIRD_SIZE / 2;
      const aCenterY = a.y + BIRD_SIZE / 2;
      const bCenterX = b.x + BIRD_SIZE / 2;
      const bCenterY = b.y + BIRD_SIZE / 2;

      const dx = bCenterX - aCenterX;
      const dy = bCenterY - aCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 0 && distance < BIRD_SIZE) {
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

        victim.x += directionX * VICTIM_KNOCKBACK;
        victim.y += directionY * VICTIM_KNOCKBACK;

        attacker.x -= directionX * ATTACKER_RECOIL;
        attacker.y -= directionY * ATTACKER_RECOIL;

        victim.velocityX += directionX * 5;
        victim.velocityY += directionY * 5;

        attacker.velocityX -= directionX * 2;
        attacker.velocityY -= directionY * 2;

        keepPlayerInsideArena(victim);
        keepPlayerInsideArena(attacker);

        attacker.lastCollisionAt = now;
        victim.lastCollisionAt = now;
      }
    }
  }
}

function getAlivePlayers(room) {
  return Object.values(room.players).filter(player => player.alive);
}

function checkForGameEnd(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.status !== "running") return;

  const alivePlayers = getAlivePlayers(room);

  if (alivePlayers.length <= 1) {
    room.status = "ended";

    if (room.gameLoop) {
      clearInterval(room.gameLoop);
      room.gameLoop = null;
    }

    io.to(roomCode).emit("gameState", getGameState(roomCode));

    io.to(roomCode).emit("gameEnded", {
      winner: alivePlayers[0] || null,
      obstaclesPassed: room.obstaclesPassed
    });
  }
}

function getGameState(roomCode) {
  const room = rooms[roomCode];

  return {
    status: room.status,
    players: getPlayersInRoom(roomCode),
    obstacles: room.obstacles,
    obstaclesPassed: room.obstaclesPassed
  };
}

function broadcastGameState(roomCode) {
  if (!rooms[roomCode]) return;

  io.to(roomCode).emit("gameState", getGameState(roomCode));
}

function startGameLoop(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.gameLoop) {
    clearInterval(room.gameLoop);
  }

  room.gameLoop = setInterval(() => {
    const activeRoom = rooms[roomCode];

    if (!activeRoom || activeRoom.status !== "running") {
      clearInterval(room.gameLoop);
      return;
    }

    updatePlayerPhysics(activeRoom);
    applyPlayerCollisions(activeRoom);
    updateObstacles(activeRoom);
    applyObstacleDeaths(activeRoom);
    broadcastGameState(roomCode);
    checkForGameEnd(roomCode);
  }, 1000 / 60);
}

io.on("connection", (socket) => {
  socket.on("createGame", ({ playerName, roomCode }) => {
    rooms[roomCode] = {
      hostId: socket.id,
      players: {},
      status: "waiting",
      obstacles: [],
      obstaclesPassed: 0,
      gameLoop: null
    };

    addPlayerToRoom(socket, roomCode, playerName);

    io.to(roomCode).emit("roomUpdated", publicRoomState(roomCode));
  });

  socket.on("joinGame", ({ playerName, roomCode }) => {
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("joinError", "Game code not found.");
      return;
    }

    if (room.status !== "waiting") {
      socket.emit("joinError", "This game has already started.");
      return;
    }

    addPlayerToRoom(socket, roomCode, playerName);

    io.to(roomCode).emit("roomUpdated", publicRoomState(roomCode));
  });

  socket.on("requestStartGame", ({ roomCode }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (socket.id !== room.hostId) {
      socket.emit("joinError", "Only the game creator can start the game.");
      return;
    }

    if (room.status !== "waiting") return;

    resetPlayersForMatch(room);
    room.obstacles = createInitialObstacles();
    room.obstaclesPassed = 0;
    room.status = "countdown";

    const startAt = Date.now() + COUNTDOWN_MS;

    io.to(roomCode).emit("countdownStarted", {
      startAt,
      initialState: getGameState(roomCode)
    });

    setTimeout(() => {
      if (!rooms[roomCode] || rooms[roomCode].status !== "countdown") {
        return;
      }

      rooms[roomCode].status = "running";
      io.to(roomCode).emit("gameStarted", getGameState(roomCode));
      startGameLoop(roomCode);
    }, COUNTDOWN_MS);
  });

  socket.on("playerInput", ({ roomCode, direction }) => {
    const room = rooms[roomCode];

    if (!room || room.status !== "running") return;

    const player = room.players[socket.id];

    if (!player || !player.alive) return;

    applyInput(player, direction);
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];

      if (room.players[socket.id]) {
        delete room.players[socket.id];

        if (Object.keys(room.players).length === 0) {
          if (room.gameLoop) {
            clearInterval(room.gameLoop);
          }

          delete rooms[roomCode];
          return;
        }

        io.to(roomCode).emit("roomUpdated", publicRoomState(roomCode));
        broadcastGameState(roomCode);
        checkForGameEnd(roomCode);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bird Royale server running on port ${PORT}`);
});