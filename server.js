const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const rooms = {};

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function getPlayersInRoom(roomCode) {
  if (!rooms[roomCode]) {
    return [];
  }

  return Object.values(rooms[roomCode].players);
}

io.on("connection", (socket) => {
  socket.on("createGame", ({ playerName, roomCode }) => {
    rooms[roomCode] = {
      hostId: socket.id,
      players: {}
    };

    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      name: playerName
    };

    socket.join(roomCode);

    io.to(roomCode).emit("roomUpdated", {
      roomCode,
      players: getPlayersInRoom(roomCode)
    });
  });

  socket.on("joinGame", ({ playerName, roomCode }) => {
    if (!rooms[roomCode]) {
      socket.emit("joinError", "Game code not found.");
      return;
    }

    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      name: playerName
    };

    socket.join(roomCode);

    io.to(roomCode).emit("roomUpdated", {
      roomCode,
      players: getPlayersInRoom(roomCode)
    });
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      if (rooms[roomCode].players[socket.id]) {
        delete rooms[roomCode].players[socket.id];

        io.to(roomCode).emit("roomUpdated", {
          roomCode,
          players: getPlayersInRoom(roomCode)
        });

        if (Object.keys(rooms[roomCode].players).length === 0) {
          delete rooms[roomCode];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bird Royale server running on port ${PORT}`);
});