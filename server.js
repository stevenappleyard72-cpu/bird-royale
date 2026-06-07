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

const diveAmount = 45;
const diveRecoveryDelay = 140;

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

function getSpeedMultiplier(room) {
  return (room.gameSpeed || 10) / 10;
}

function randomNumber(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function generateObstaclePlan(count) {
  const plan = [];

  for (let i = 0; i < count; i++) {
    let topPercent = randomNumber(10, 30) / 100;
    let bottomPercent = randomNumber(10, 30) / 100;

    while (topPercent + bottomPercent > 0.5) {
      topPercent = randomNumber(10, 30) / 100;
      bottomPercent = randomNumber(10, 30) / 100;
    }

    plan.push({ topPercent, bottomPercent });
  }

  return plan;
}

function getPlayersInRoom(roomCode) {
  if (!rooms[roomCode]) return [];
  return Object.values(rooms[roomCode].players);
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
    alive: true
  };

  socket.join(roomCode);
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
  player.y += diveAmount * speedMultiplier;
  player.velocityY = 2;
}
}

function updatePlayerPhysics(room) {
  const speedMultiplier = getSpeedMultiplier(room);
  const players = Object.values(room.players);

  for (const player of players) {
    if (!player.alive) continue;

    player.velocityY += gravity * speedMultiplier;
    player.y += player.velocityY * speedMultiplier;

    player.x += player.velocityX * speedMultiplier;
    player.velocityX *= horizontalDrag;

    keepPlayerInsideArena(player);
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

function broadcastPlayerStates(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  io.to(roomCode).emit("playersUpdated", {
    players: getPlayersInRoom(roomCode)
  });
}

function startGameLoop(roomCode) {
  const room = rooms[roomCode];

  if (!room) return;

  if (room.gameLoop) {
    clearInterval(room.gameLoop);
  }

  room.gameLoop = setInterval(() => {
    if (!rooms[roomCode] || !rooms[roomCode].started) {
      clearInterval(room.gameLoop);
      return;
    }

    updatePlayerPhysics(room);
    applyPlayerCollisions(room);
    broadcastPlayerStates(roomCode);
  }, 1000 / 60);
}

io.on("connection", (socket) => {
  socket.on("createGame", ({ playerName, roomCode, gameSpeed }) => {
    rooms[roomCode] = {
      hostId: socket.id,
      players: {},
      started: false,
      obstaclePlan: [],
      gameLoop: null,
      gameSpeed: clampGameSpeed(gameSpeed)
    };

    addPlayerToRoom(socket, roomCode, playerName);

    io.to(roomCode).emit("roomUpdated", {
      roomCode,
      hostId: rooms[roomCode].hostId,
      players: getPlayersInRoom(roomCode),
      gameSpeed: rooms[roomCode].gameSpeed
    });
  });

  socket.on("joinGame", ({ playerName, roomCode }) => {
    if (!rooms[roomCode]) {
      socket.emit("joinError", "Game code not found.");
      return;
    }

    if (rooms[roomCode].started) {
      socket.emit("joinError", "This game has already started.");
      return;
    }

    addPlayerToRoom(socket, roomCode, playerName);

    io.to(roomCode).emit("roomUpdated", {
      roomCode,
      hostId: rooms[roomCode].hostId,
      players: getPlayersInRoom(roomCode),
      gameSpeed: rooms[roomCode].gameSpeed
    });
  });

  socket.on("requestStartGame", ({ roomCode }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (socket.id !== room.hostId) {
      socket.emit("joinError", "Only the game creator can start the game.");
      return;
    }

room.obstaclePlan = generateObstaclePlan(100);

io.to(roomCode).emit("gameStarting", {
  obstaclePlan: room.obstaclePlan,
  gameSpeed: room.gameSpeed
});

setTimeout(() => {
  if (!rooms[roomCode]) {
    return;
  }

  rooms[roomCode].started = true;
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

        io.to(roomCode).emit("roomUpdated", {
          roomCode,
          hostId: room.hostId,
          players: getPlayersInRoom(roomCode),
          gameSpeed: room.gameSpeed
        });

        if (Object.keys(room.players).length === 0) {
          if (room.gameLoop) {
            clearInterval(room.gameLoop);
          }

          delete rooms[roomCode];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bird Royale server running on port ${PORT}`);
});