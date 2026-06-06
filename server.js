const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const rooms = {};

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

function getPlayersInRoom(roomCode) {
  if (!rooms[roomCode]) return [];
  return Object.values(rooms[roomCode].players);
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

    plan.push({
      topPercent,
      bottomPercent
    });
  }

  return plan;
}

function randomNumber(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
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
    alive: true
  };

  socket.join(roomCode);
}

io.on("connection", (socket) => {
  socket.on("createGame", ({ playerName, roomCode }) => {
    rooms[roomCode] = {
      hostId: socket.id,
      players: {},
      started: false,
      obstaclePlan: []
    };

    addPlayerToRoom(socket, roomCode, playerName);

    io.to(roomCode).emit("roomUpdated", {
      roomCode,
      hostId: rooms[roomCode].hostId,
      players: getPlayersInRoom(roomCode)
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
      players: getPlayersInRoom(roomCode)
    });
  });

  socket.on("requestStartGame", ({ roomCode }) => {
    const room = rooms[roomCode];

    if (!room) return;

    if (socket.id !== room.hostId) {
      socket.emit("joinError", "Only the game creator can start the game.");
      return;
    }

    room.started = true;
    room.obstaclePlan = generateObstaclePlan(100);

    io.to(roomCode).emit("gameStarting", {
      obstaclePlan: room.obstaclePlan
    });
  });

  socket.on("playerState", ({ roomCode, x, y }) => {
    const room = rooms[roomCode];

    if (!room || !room.players[socket.id]) return;

    room.players[socket.id].x = x;
    room.players[socket.id].y = y;

    socket.to(roomCode).emit("playerMoved", {
      id: socket.id,
      x,
      y
    });
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];

      if (room.players[socket.id]) {
        delete room.players[socket.id];

        io.to(roomCode).emit("roomUpdated", {
          roomCode,
          hostId: room.hostId,
          players: getPlayersInRoom(roomCode)
        });

        if (Object.keys(room.players).length === 0) {
          delete rooms[roomCode];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bird Royale server running on port ${PORT}`);
});